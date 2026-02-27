import { BrowserSession, closeBrowser, interJobDelay, launchBrowser, checkLogin, performDecoyAction } from '../browser';
import { getRuntimeAccountProfiles, isMultiAccountRuntimeEnabled, RuntimeAccountProfile } from '../accountManager';
import { config } from '../config';
import { pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import { logError, logInfo, logWarn } from '../telemetry/logger';
import { JobType } from '../types/domain';
import { WorkerContext } from '../workers/context';
import { processAcceptanceJob } from '../workers/acceptanceWorker';
import { processInviteJob } from '../workers/inviteWorker';
import { processMessageJob } from '../workers/messageWorker';
import { processHygieneJob } from '../workers/hygieneWorker';
import { ChallengeDetectedError } from '../workers/errors';
import { transitionLead } from './leadStateService';
import {
    createJobAttempt,
    getAutomationPauseState,
    getRuntimeFlag,
    incrementDailyStat,
    lockNextQueuedJob,
    markJobRetryOrDeadLetter,
    markJobSucceeded,
    parseJobPayload,
    pushOutboxEvent,
} from './repositories';

export interface RunJobsOptions {
    localDate: string;
    allowedTypes: JobType[];
    dryRun: boolean;
}

function retryDelayMs(attempt: number): number {
    const jitter = Math.floor(Math.random() * 250);
    return config.retryBaseMs * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
}

async function rotateSessionWithLoginCheck(
    session: BrowserSession,
    workerContext: WorkerContext,
    reason: string,
    account: RuntimeAccountProfile,
): Promise<BrowserSession | null> {
    await logInfo('job_runner.session_rotate.start', { reason, accountId: account.id });
    await closeBrowser(session);

    const rotated = await launchBrowser({
        sessionDir: account.sessionDir,
        proxy: account.proxy,
    });
    const loggedIn = await checkLogin(rotated.page);
    if (!loggedIn) {
        await closeBrowser(rotated);
        await quarantineAccount('LOGIN_MISSING', {
            message: 'Sessione non autenticata su LinkedIn dopo rotazione proxy/sessione',
            reason,
            accountId: account.id,
        });
        return null;
    }

    workerContext.session = rotated;
    await logInfo('job_runner.session_rotate.ok', { reason, accountId: account.id });
    return rotated;
}

async function runQueuedJobsForAccount(
    options: RunJobsOptions,
    account: RuntimeAccountProfile,
    includeLegacyDefaultQueue: boolean
): Promise<void> {
    let session = await launchBrowser({
        sessionDir: account.sessionDir,
        proxy: account.proxy,
    });
    let sessionClosed = false;
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            await quarantineAccount('LOGIN_MISSING', {
                message: 'Sessione non autenticata su LinkedIn',
                accountId: account.id,
            });
            return;
        }

        const workerContext: WorkerContext = {
            session,
            dryRun: options.dryRun,
            localDate: options.localDate,
            accountId: account.id,
        };
        let consecutiveFailures = 0;
        let processedOnCurrentSession = 0;
        const rotateEveryJobs = config.proxyRotateEveryJobs;
        const rotateEveryMinutes = config.proxyRotateEveryMinutes;
        const rotateEveryMs = rotateEveryMinutes > 0 ? rotateEveryMinutes * 60_000 : 0;
        let sessionStartedAtMs = Date.now();

        while (true) {
            const pauseState = await getAutomationPauseState();
            if (pauseState.paused) {
                await logWarn('job_runner.skipped_paused', {
                    accountId: account.id,
                    reason: pauseState.reason,
                    pausedUntil: pauseState.pausedUntil,
                    remainingSeconds: pauseState.remainingSeconds,
                });
                break;
            }

            const job = await lockNextQueuedJob(options.allowedTypes, account.id, includeLegacyDefaultQueue);
            if (!job) break;

            await logInfo('job.started', {
                jobId: job.id,
                type: job.type,
                attempt: job.attempts + 1,
                accountId: account.id,
                jobAccountId: job.account_id,
            });

            try {
                // Azioni diversive (Decoy) per mascherare pattern del bot (20% probabilità)
                if (Math.random() < 0.20) {
                    await performDecoyAction(session.page);
                }

                if (job.type === 'INVITE') {
                    const parsed = parseJobPayload<{ leadId: number; localDate: string }>(job);
                    await processInviteJob(parsed.payload, workerContext);
                } else if (job.type === 'ACCEPTANCE_CHECK') {
                    const parsed = parseJobPayload<{ leadId: number }>(job);
                    await processAcceptanceJob(parsed.payload, workerContext);
                } else if (job.type === 'MESSAGE') {
                    const parsed = parseJobPayload<{ leadId: number; acceptedAtDate: string }>(job);
                    await processMessageJob(parsed.payload, workerContext);
                } else if (job.type === 'HYGIENE') {
                    const parsed = parseJobPayload<{ accountId: string }>(job);
                    await processHygieneJob(parsed.payload, workerContext);
                }

                await markJobSucceeded(job.id);
                await createJobAttempt(job.id, true, null, null, null);
                await pushOutboxEvent(
                    'job.succeeded',
                    { jobId: job.id, type: job.type, dryRun: options.dryRun, accountId: account.id },
                    `job.succeeded:${job.id}:${job.type}`
                );
                consecutiveFailures = 0;

                // Pausa umana tra un job e il successivo (anti-burst)
                await interJobDelay(session.page);
                processedOnCurrentSession += 1;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const attempts = job.attempts + 1;

                await createJobAttempt(job.id, false, error instanceof Error ? error.name : 'UNKNOWN_ERROR', message, null);
                await incrementDailyStat(options.localDate, 'run_errors');

                if (error instanceof ChallengeDetectedError) {
                    await incrementDailyStat(options.localDate, 'challenges_count');
                    await quarantineAccount('CHALLENGE_DETECTED', {
                        jobId: job.id,
                        jobType: job.type,
                        message,
                        accountId: account.id,
                    });
                    await markJobRetryOrDeadLetter(job.id, attempts, attempts, 0, message);
                    await logError('job.challenge_detected', { jobId: job.id, type: job.type, message, accountId: account.id });
                    break;
                }

                processedOnCurrentSession += 1;

                const nextDelay = retryDelayMs(attempts);
                const status = await markJobRetryOrDeadLetter(job.id, attempts, job.max_attempts, nextDelay, message);
                await pushOutboxEvent(
                    'job.failed',
                    {
                        jobId: job.id,
                        type: job.type,
                        attempts,
                        status,
                        error: message,
                        accountId: account.id,
                    },
                    `job.failed:${job.id}:${attempts}`
                );

                if (status === 'DEAD_LETTER' && (job.type === 'INVITE' || job.type === 'MESSAGE' || job.type === 'ACCEPTANCE_CHECK')) {
                    try {
                        const parsed = parseJobPayload<{ leadId?: number }>(job);
                        if (parsed.payload.leadId) {
                            await transitionLead(parsed.payload.leadId, 'REVIEW_REQUIRED', `job_dead_letter_${job.type.toLowerCase()}`);
                            await logWarn('job.dead_letter.lead_review_required', { jobId: job.id, leadId: parsed.payload.leadId, type: job.type });
                        }
                    } catch {
                        // ignore if payload cannot be parsed
                    }
                }

                await logWarn('job.failed', {
                    jobId: job.id,
                    type: job.type,
                    status,
                    attempts,
                    message,
                    accountId: account.id,
                });

                consecutiveFailures += 1;
                if (consecutiveFailures >= config.maxConsecutiveJobFailures) {
                    await pauseAutomation(
                        'CONSECUTIVE_JOB_FAILURES',
                        {
                            threshold: config.maxConsecutiveJobFailures,
                            consecutiveFailures,
                            lastJobId: job.id,
                            lastJobType: job.type,
                            lastError: message,
                            accountId: account.id,
                        },
                        config.autoPauseMinutesOnFailureBurst
                    );
                    await logWarn('job_runner.paused.failure_burst', {
                        threshold: config.maxConsecutiveJobFailures,
                        consecutiveFailures,
                        pauseMinutes: config.autoPauseMinutesOnFailureBurst,
                        accountId: account.id,
                    });
                    break;
                }
            }

            const rotateReasons: string[] = [];
            if (rotateEveryJobs > 0 && processedOnCurrentSession >= rotateEveryJobs) {
                rotateReasons.push(`threshold_${rotateEveryJobs}_jobs`);
            }
            if (rotateEveryMs > 0 && Date.now() - sessionStartedAtMs >= rotateEveryMs) {
                rotateReasons.push(`threshold_${rotateEveryMinutes}_minutes`);
            }

            if (rotateReasons.length > 0) {
                const rotated = await rotateSessionWithLoginCheck(
                    session,
                    workerContext,
                    rotateReasons.join('+'),
                    account
                );
                if (!rotated) {
                    sessionClosed = true;
                    return;
                }
                session = rotated;
                processedOnCurrentSession = 0;
                sessionStartedAtMs = Date.now();
            }
        }
    } finally {
        if (!sessionClosed) {
            await closeBrowser(session);
        }
    }
}

export async function runQueuedJobs(options: RunJobsOptions): Promise<void> {
    const quarantineFlag = await getRuntimeFlag('account_quarantine');
    if (quarantineFlag === 'true') {
        await logWarn('job_runner.skipped_quarantine', { reason: 'account_quarantine=true' });
        return;
    }

    const accounts = getRuntimeAccountProfiles();
    for (let index = 0; index < accounts.length; index++) {
        const account = accounts[index];
        const includeLegacyDefaultQueue = isMultiAccountRuntimeEnabled() && index === 0 && account.id !== 'default';
        await logInfo('job_runner.account.start', {
            accountId: account.id,
            includeLegacyDefaultQueue,
            sessionDir: account.sessionDir,
        });

        await runQueuedJobsForAccount(options, account, includeLegacyDefaultQueue);

        await logInfo('job_runner.account.done', { accountId: account.id });
        const latestQuarantineFlag = await getRuntimeFlag('account_quarantine');
        if (latestQuarantineFlag === 'true') {
            break;
        }
    }
}
