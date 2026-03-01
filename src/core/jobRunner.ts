import { BrowserSession, closeBrowser, interJobDelay, launchBrowser, checkLogin, performDecoyBurst, performBrowserGC } from '../browser';
import { getRuntimeAccountProfiles, isMultiAccountRuntimeEnabled, RuntimeAccountProfile } from '../accountManager';
import { config } from '../config';
import { handleChallengeDetected, pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import { logError, logInfo, logWarn } from '../telemetry/logger';
import { JobType } from '../types/domain';
import { WorkerContext } from '../workers/context';
import { processAcceptanceJob } from '../workers/acceptanceWorker';
import { processInviteJob } from '../workers/inviteWorker';
import { processMessageJob } from '../workers/messageWorker';
import { processHygieneJob } from '../workers/hygieneWorker';
import { ChallengeDetectedError, RetryableWorkerError } from '../workers/errors';
import { runFollowUpWorker } from '../workers/followUpWorker';
import { WorkerExecutionResult, workerResult } from '../workers/result';
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

function randomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
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
        preferredProxyType: config.proxyMobilePriorityEnabled ? 'mobile' : undefined,
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
        preferredProxyType: config.proxyMobilePriorityEnabled ? 'mobile' : undefined,
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
        let jobsSinceDecoy = 0;
        let jobsSinceCoffeeBreak = 0;
        let nextDecoyAt = randomInt(config.behaviorDecoyMinIntervalJobs, config.behaviorDecoyMaxIntervalJobs);
        let nextCoffeeBreakAt = randomInt(config.behaviorCoffeeBreakMinIntervalJobs, config.behaviorCoffeeBreakMaxIntervalJobs);
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

            if (!options.dryRun && jobsSinceDecoy >= nextDecoyAt) {
                await logInfo('job_runner.decoy_burst.start', {
                    accountId: account.id,
                    jobsSinceDecoy,
                    nextDecoyAt,
                });
                await performDecoyBurst(session.page);
                jobsSinceDecoy = 0;
                nextDecoyAt = randomInt(config.behaviorDecoyMinIntervalJobs, config.behaviorDecoyMaxIntervalJobs);
            }

            await logInfo('job.started', {
                jobId: job.id,
                type: job.type,
                attempt: job.attempts + 1,
                accountId: account.id,
                jobAccountId: job.account_id,
            });

            let processedCurrentJob = false;
            try {
                processedCurrentJob = true;

                let executionResult: WorkerExecutionResult = workerResult(0);
                if (job.type === 'INVITE') {
                    const parsed = parseJobPayload<{ leadId: number; localDate: string }>(job);
                    executionResult = await processInviteJob(parsed.payload, workerContext);
                } else if (job.type === 'ACCEPTANCE_CHECK') {
                    const parsed = parseJobPayload<{ leadId: number }>(job);
                    executionResult = await processAcceptanceJob(parsed.payload, workerContext);
                } else if (job.type === 'MESSAGE') {
                    const parsed = parseJobPayload<{ leadId: number; acceptedAtDate: string }>(job);
                    executionResult = await processMessageJob(parsed.payload, workerContext);
                } else if (job.type === 'HYGIENE') {
                    const parsed = parseJobPayload<{ accountId: string }>(job);
                    executionResult = await processHygieneJob(parsed.payload, workerContext);
                }

                await logInfo('job.worker_result', {
                    jobId: job.id,
                    type: job.type,
                    accountId: account.id,
                    success: executionResult.success,
                    processedCount: executionResult.processedCount,
                    errorsCount: executionResult.errors.length,
                });
                if (executionResult.errors.length > 0) {
                    await logWarn('job.worker_result.errors', {
                        jobId: job.id,
                        type: job.type,
                        accountId: account.id,
                        errors: executionResult.errors.slice(0, 5),
                    });
                }

                const hasWorkerWarnings = !executionResult.success && executionResult.errors.length > 0;
                if (!executionResult.success && executionResult.processedCount === 0) {
                    const firstError = executionResult.errors[0]?.message ?? 'worker_reported_failure';
                    throw new RetryableWorkerError(
                        `Worker result non-success (processedCount=0): ${firstError}`,
                        'WORKER_REPORTED_FAILURE'
                    );
                }

                await markJobSucceeded(job.id);
                await createJobAttempt(job.id, true, null, null, null);
                await pushOutboxEvent(
                    hasWorkerWarnings ? 'job.succeeded_with_errors' : 'job.succeeded',
                    {
                        jobId: job.id,
                        type: job.type,
                        dryRun: options.dryRun,
                        accountId: account.id,
                        processedCount: executionResult.processedCount,
                        errorsCount: executionResult.errors.length,
                    },
                    `${hasWorkerWarnings ? 'job.succeeded_with_errors' : 'job.succeeded'}:${job.id}:${job.type}`
                );
                consecutiveFailures = 0;

                // Pausa umana tra un job e il successivo (anti-burst)
                await interJobDelay(session.page);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const attempts = job.attempts + 1;

                await createJobAttempt(job.id, false, error instanceof Error ? error.name : 'UNKNOWN_ERROR', message, null);
                await incrementDailyStat(options.localDate, 'run_errors');

                if (error instanceof ChallengeDetectedError) {
                    await incrementDailyStat(options.localDate, 'challenges_count');
                    let challengeLeadId: number | undefined;
                    if (job.type === 'INVITE' || job.type === 'MESSAGE' || job.type === 'ACCEPTANCE_CHECK') {
                        try {
                            const parsed = parseJobPayload<{ leadId?: number }>(job);
                            if (typeof parsed.payload.leadId === 'number') {
                                challengeLeadId = parsed.payload.leadId;
                            }
                        } catch {
                            // ignore payload parsing issues during challenge flow
                        }
                    }
                    await handleChallengeDetected({
                        source: 'job_runner',
                        accountId: account.id,
                        leadId: challengeLeadId,
                        jobId: job.id,
                        jobType: job.type,
                        message,
                        extra: {
                            statusBeforeFailure: job.status,
                        },
                    });
                    await markJobRetryOrDeadLetter(job.id, attempts, attempts, 0, message);
                    await logError('job.challenge_detected', { jobId: job.id, type: job.type, message, accountId: account.id });
                    break;
                }

                if (error instanceof RetryableWorkerError && error.code === 'WEEKLY_LIMIT_REACHED') {
                    await quarantineAccount('WEEKLY_LIMIT_REACHED', {
                        jobId: job.id,
                        jobType: job.type,
                        message,
                        accountId: account.id,
                    });
                }

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

            if (processedCurrentJob) {
                processedOnCurrentSession += 1;
                jobsSinceDecoy += 1;
                jobsSinceCoffeeBreak += 1;
            }

            if (!options.dryRun && jobsSinceCoffeeBreak >= nextCoffeeBreakAt) {
                const coffeeBreakMs = randomInt(
                    Math.max(60, config.behaviorCoffeeBreakMinSec),
                    Math.max(config.behaviorCoffeeBreakMinSec, config.behaviorCoffeeBreakMaxSec)
                ) * 1000;
                await logInfo('job_runner.coffee_break.start', {
                    accountId: account.id,
                    jobsSinceCoffeeBreak,
                    nextCoffeeBreakAt,
                    coffeeBreakMs,
                });
                await session.page.waitForTimeout(coffeeBreakMs);
                jobsSinceCoffeeBreak = 0;
                nextCoffeeBreakAt = randomInt(config.behaviorCoffeeBreakMinIntervalJobs, config.behaviorCoffeeBreakMaxIntervalJobs);
            }

            const rotateReasons: string[] = [];
            if (rotateEveryJobs > 0 && processedOnCurrentSession >= rotateEveryJobs) {
                rotateReasons.push(`threshold_${rotateEveryJobs}_jobs`);
            }
            if (rotateEveryMs > 0 && Date.now() - sessionStartedAtMs >= rotateEveryMs) {
                rotateReasons.push(`threshold_${rotateEveryMinutes}_minutes`);
            }

            // Memory Leak Protection (Hard Limits to prevent Zombie Chromium and Heap explosion)
            if (processedOnCurrentSession >= 500) {
                rotateReasons.push('memory_protection_500_jobs');
            }
            if (Date.now() - sessionStartedAtMs >= 60 * 60 * 1000) { // 60 minutes
                rotateReasons.push('memory_protection_60_min');
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
            } else if (processedOnCurrentSession > 0 && processedOnCurrentSession % 10 === 0) {
                // Collect garbage proactively to prevent browser bloating
                await performBrowserGC(session);
            }
        }

        // ── Follow-up Phase ─────────────────────────────────────────────────
        // Eseguito una volta sola dopo i job normali, con la stessa sessione aperta.
        // Non bloccante: errori non propagano e non compromettono la run principale.
        if (!sessionClosed) {
            const followUpContext: WorkerContext = {
                session,
                dryRun: options.dryRun,
                localDate: options.localDate,
                accountId: account.id,
            };
            try {
                const followUpResult = await runFollowUpWorker(followUpContext);
                await logInfo('job_runner.follow_up_phase_done', {
                    accountId: account.id,
                    success: followUpResult.success,
                    processedCount: followUpResult.processedCount,
                    errorsCount: followUpResult.errors.length,
                });
            } catch (err: unknown) {
                if (err instanceof ChallengeDetectedError) {
                    await incrementDailyStat(options.localDate, 'challenges_count');
                    await handleChallengeDetected({
                        source: 'follow_up_worker',
                        accountId: account.id,
                        message: err.message,
                        extra: {
                            phase: 'follow_up',
                        },
                    });
                    await logWarn('job_runner.follow_up_phase_challenge', {
                        accountId: account.id,
                        error: err.message,
                    });
                    return;
                }
                await logWarn('job_runner.follow_up_phase_error', {
                    accountId: account.id,
                    error: err instanceof Error ? err.message : String(err),
                });
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
