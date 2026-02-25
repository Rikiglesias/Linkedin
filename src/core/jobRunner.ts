import { closeBrowser, interJobDelay, launchBrowser, checkLogin } from '../browser';
import { config } from '../config';
import { pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import { logError, logInfo, logWarn } from '../telemetry/logger';
import { JobType } from '../types/domain';
import { WorkerContext } from '../workers/context';
import { processAcceptanceJob } from '../workers/acceptanceWorker';
import { processInviteJob } from '../workers/inviteWorker';
import { processMessageJob } from '../workers/messageWorker';
import { ChallengeDetectedError } from '../workers/errors';
import {
    createJobAttempt,
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

export async function runQueuedJobs(options: RunJobsOptions): Promise<void> {
    const quarantineFlag = await getRuntimeFlag('account_quarantine');
    if (quarantineFlag === 'true') {
        await logWarn('job_runner.skipped_quarantine', { reason: 'account_quarantine=true' });
        return;
    }

    const session = await launchBrowser();
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            await quarantineAccount('LOGIN_MISSING', { message: 'Sessione non autenticata su LinkedIn' });
            return;
        }

        const workerContext: WorkerContext = {
            session,
            dryRun: options.dryRun,
            localDate: options.localDate,
        };
        let consecutiveFailures = 0;

        while (true) {
            const job = await lockNextQueuedJob(options.allowedTypes);
            if (!job) break;

            await logInfo('job.started', {
                jobId: job.id,
                type: job.type,
                attempt: job.attempts + 1,
            });

            try {
                if (job.type === 'INVITE') {
                    const parsed = parseJobPayload<{ leadId: number; localDate: string }>(job);
                    await processInviteJob(parsed.payload, workerContext);
                } else if (job.type === 'ACCEPTANCE_CHECK') {
                    const parsed = parseJobPayload<{ leadId: number }>(job);
                    await processAcceptanceJob(parsed.payload, workerContext);
                } else if (job.type === 'MESSAGE') {
                    const parsed = parseJobPayload<{ leadId: number; acceptedAtDate: string }>(job);
                    await processMessageJob(parsed.payload, workerContext);
                }

                await markJobSucceeded(job.id);
                await createJobAttempt(job.id, true, null, null, null);
                await pushOutboxEvent(
                    'job.succeeded',
                    { jobId: job.id, type: job.type, dryRun: options.dryRun },
                    `job.succeeded:${job.id}:${job.type}`
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
                    await quarantineAccount('CHALLENGE_DETECTED', {
                        jobId: job.id,
                        jobType: job.type,
                        message,
                    });
                    await markJobRetryOrDeadLetter(job.id, attempts, attempts, 0, message);
                    await logError('job.challenge_detected', { jobId: job.id, type: job.type, message });
                    break;
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
                    },
                    `job.failed:${job.id}:${attempts}`
                );

                await logWarn('job.failed', {
                    jobId: job.id,
                    type: job.type,
                    status,
                    attempts,
                    message,
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
                        },
                        config.autoPauseMinutesOnFailureBurst
                    );
                    await logWarn('job_runner.paused.failure_burst', {
                        threshold: config.maxConsecutiveJobFailures,
                        consecutiveFailures,
                        pauseMinutes: config.autoPauseMinutesOnFailureBurst,
                    });
                    break;
                }
            }
        }
    } finally {
        await closeBrowser(session);
    }
}
