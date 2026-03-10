import {
    BrowserSession,
    closeBrowser,
    interJobDelay,
    launchBrowser,
    checkLogin,
    probeLinkedInStatus,
    performDecoyBurst,
    performBrowserGC,
} from '../browser';
import { recordSuccessfulAuth, checkSessionFreshness } from '../browser/sessionCookieMonitor';
import {
    updateAccountBackpressure,
    getAccountBackpressureLevel,
    computeBackpressureBatchSize,
} from '../sync/backpressure';
import { getRuntimeAccountProfiles, isMultiAccountRuntimeEnabled, RuntimeAccountProfile } from '../accountManager';
import { config } from '../config';
import { handleChallengeDetected, pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import { logError, logInfo, logWarn } from '../telemetry/logger';
import { sendTelegramAlert } from '../telemetry/alerts';
import { randomInt } from '../utils/random';
import { retryDelayMs } from '../utils/async';
import { JobType } from '../types/domain';
import { WorkerContext } from '../workers/context';
import { processAcceptanceJob } from '../workers/acceptanceWorker';
import { processInviteJob } from '../workers/inviteWorker';
import { processMessageJob } from '../workers/messageWorker';
import { processHygieneJob } from '../workers/hygieneWorker';
import { processInteractionJob } from '../workers/interactionWorker';
import { processEnrichmentJob } from '../workers/enrichmentWorker';
import { ChallengeDetectedError, resolveWorkerRetryPolicy, RetryableWorkerError } from '../workers/errors';
import { runFollowUpWorker } from '../workers/followUpWorker';
import { createAndPublishPost, PostCreatorOptions } from '../workers/postCreatorWorker';
import { WorkerExecutionResult, workerResult } from '../workers/result';
import { transitionLead } from './leadStateService';
import { advanceLeadCampaign, failLeadCampaign } from './campaignEngine';
import {
    createJobAttempt,
    getDailyStat,
    getAutomationPauseState,
    getRuntimeFlag,
    incrementDailyStat,
    lockNextQueuedJob,
    markJobRetryOrDeadLetter,
    markJobSucceeded,
    parseJobPayload,
    pushOutboxEvent,
    recordAccountHealthSnapshot,
} from './repositories';

export interface RunJobsOptions {
    localDate: string;
    allowedTypes: JobType[];
    dryRun: boolean;
}

interface AccountRunHealthMetrics {
    processed: number;
    failed: number;
    challenges: number;
    deadLetters: number;
    startedAtMs: number;
}


function evaluateAccountHealth(metrics: AccountRunHealthMetrics): {
    health: 'GREEN' | 'YELLOW' | 'RED';
    reason: string | null;
    failureRate: number;
} {
    const failureRate = metrics.processed > 0 ? metrics.failed / metrics.processed : 0;

    if (metrics.challenges > 0 || failureRate >= config.accountHealthCriticalFailureRate) {
        return {
            health: 'RED',
            reason: metrics.challenges > 0 ? 'challenge_detected' : 'failure_rate_critical',
            failureRate,
        };
    }
    if (metrics.deadLetters > 0 || failureRate >= config.accountHealthWarnFailureRate) {
        return {
            health: 'YELLOW',
            reason: metrics.deadLetters > 0 ? 'dead_letters_present' : 'failure_rate_warn',
            failureRate,
        };
    }
    return {
        health: 'GREEN',
        reason: null,
        failureRate,
    };
}

async function persistAccountHealth(
    account: RuntimeAccountProfile,
    options: RunJobsOptions,
    metrics: AccountRunHealthMetrics,
): Promise<void> {
    const health = evaluateAccountHealth(metrics);
    const durationMs = Date.now() - metrics.startedAtMs;
    await recordAccountHealthSnapshot({
        accountId: account.id,
        queueProcessed: metrics.processed,
        queueFailed: metrics.failed,
        challenges: metrics.challenges,
        deadLetters: metrics.deadLetters,
        health: health.health,
        reason: health.reason,
        metadata: {
            localDate: options.localDate,
            dryRun: options.dryRun,
            durationMs,
            failureRate: Number.parseFloat(health.failureRate.toFixed(4)),
        },
    });

    if (!options.dryRun && metrics.processed >= config.accountHealthAlertMinProcessed && health.health !== 'GREEN') {
        await sendTelegramAlert(
            `Account: ${account.id}\nHealth: ${health.health}\nReason: ${health.reason ?? 'n/a'}\nProcessed: ${metrics.processed}\nFailed: ${metrics.failed}\nChallenges: ${metrics.challenges}\nDeadLetters: ${metrics.deadLetters}`,
            'Account Health Alert',
            health.health === 'RED' ? 'critical' : 'warn',
        );
    }
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
        forceDesktop: true,
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
    includeLegacyDefaultQueue: boolean,
): Promise<void> {
    const accountHealthMetrics: AccountRunHealthMetrics = {
        processed: 0,
        failed: 0,
        challenges: 0,
        deadLetters: 0,
        startedAtMs: Date.now(),
    };
    let session = await launchBrowser({
        sessionDir: account.sessionDir,
        proxy: account.proxy,
        preferredProxyType: config.proxyMobilePriorityEnabled ? 'mobile' : undefined,
        forceDesktop: true,
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

        const freshness = checkSessionFreshness(account.sessionDir, config.sessionCookieMaxAgeDays);
        if (freshness.needsRotation) {
            await logWarn('session_cookie.stale', {
                accountId: account.id,
                sessionAgeDays: freshness.sessionAgeDays,
                maxAgeDays: freshness.maxAgeDays,
                lastVerifiedAt: freshness.lastVerifiedAt,
            });
            await pauseAutomation(
                'SESSION_COOKIE_STALE',
                {
                    accountId: account.id,
                    sessionAgeDays: freshness.sessionAgeDays,
                    recommendation: 'Re-autenticarsi manualmente o eseguire rotazione cookie via API.',
                },
                60,
            );
        }

        recordSuccessfulAuth(account.sessionDir, account.id);

        // ── LinkedIn API monitoring passivo: probe proattivo prima dei job ──
        // Verifica che LinkedIn non sia già in stato degradato (429, challenge, slow)
        // prima di consumare il budget giornaliero con job destinati a fallire.
        const probe = await probeLinkedInStatus(session.page);
        await logInfo('job_runner.linkedin_probe', {
            accountId: account.id,
            ok: probe.ok,
            responseTimeMs: probe.responseTimeMs,
            reason: probe.reason,
        });
        if (!probe.ok) {
            if (probe.reason === 'HTTP_429_RATE_LIMITED') {
                await pauseAutomation('LINKEDIN_PRE_THROTTLED', {
                    accountId: account.id,
                    responseTimeMs: probe.responseTimeMs,
                    message: 'LinkedIn ha risposto 429 alla probe iniziale — sessione già rate-limited.',
                }, config.autoPauseMinutesOnFailureBurst ?? 60);
                return;
            }
            if (probe.reason === 'SESSION_EXPIRED') {
                await quarantineAccount('LOGIN_MISSING', {
                    accountId: account.id,
                    message: 'Sessione LinkedIn scaduta rilevata dalla probe pre-sessione.',
                });
                return;
            }
            if (probe.challengeDetected) {
                await handleChallengeDetected({
                    source: 'linkedin_probe_pre_session',
                    accountId: account.id,
                });
                return;
            }
            // SLOW_RESPONSE o PROBE_ERROR: log warning ma procedi con cautela
            await logWarn('job_runner.linkedin_probe.degraded', {
                accountId: account.id,
                reason: probe.reason,
                responseTimeMs: probe.responseTimeMs,
            });
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
        let nextCoffeeBreakAt = randomInt(
            config.behaviorCoffeeBreakMinIntervalJobs,
            config.behaviorCoffeeBreakMaxIntervalJobs,
        );
        const rotateEveryJobs = config.proxyRotateEveryJobs;
        const rotateEveryMinutes = config.proxyRotateEveryMinutes;
        const rotateEveryMs = rotateEveryMinutes > 0 ? rotateEveryMinutes * 60_000 : 0;
        const accountBpLevel = await getAccountBackpressureLevel(account.id);
        const maxJobsPerRun = Math.max(1, computeBackpressureBatchSize(config.accountMaxJobsPerRun, accountBpLevel));
        let sessionStartedAtMs = Date.now();
        let processedThisRun = 0;

        while (true) {
            if (processedThisRun >= maxJobsPerRun) {
                await logInfo('job_runner.account.fairness_quota_reached', {
                    accountId: account.id,
                    processedThisRun,
                    maxJobsPerRun,
                });
                break;
            }

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

            const throttleSignal = session.httpThrottler.getThrottleSignal();
            if (throttleSignal.shouldPause) {
                await logWarn('job_runner.http_throttle.pause', {
                    accountId: account.id,
                    ratio: throttleSignal.ratio,
                    currentAvgMs: throttleSignal.currentAvgMs,
                    baselineMs: throttleSignal.baselineMs,
                });
                await pauseAutomation(
                    'HTTP_RESPONSE_TIME_CRITICAL',
                    {
                        accountId: account.id,
                        ratio: throttleSignal.ratio,
                        currentAvgMs: throttleSignal.currentAvgMs,
                        baselineMs: throttleSignal.baselineMs,
                    },
                    15,
                );
                break;
            }
            if (throttleSignal.shouldSlow) {
                const extraDelayMs = 3000 + Math.floor(Math.random() * 5000);
                await logInfo('job_runner.http_throttle.slow', {
                    accountId: account.id,
                    ratio: throttleSignal.ratio,
                    extraDelayMs,
                });
                await new Promise((r) => setTimeout(r, extraDelayMs));
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
                } else if (job.type === 'INTERACTION') {
                    const parsed = parseJobPayload<{
                        leadId: number;
                        actionType: 'VIEW_PROFILE' | 'LIKE_POST' | 'FOLLOW';
                        campaignStateId?: number;
                    }>(job);
                    executionResult = await processInteractionJob(parsed.payload, workerContext);
                } else if (job.type === 'ENRICHMENT') {
                    const parsed = parseJobPayload<{ leadId: number; campaignStateId?: number }>(job);
                    executionResult = await processEnrichmentJob(parsed.payload, workerContext);
                } else if (job.type === 'POST_CREATION') {
                    const parsed = parseJobPayload<{ accountId: string; topic?: string; tone?: string }>(job);
                    const postResult = await createAndPublishPost(session.page, {
                        accountId: parsed.payload.accountId,
                        topic: parsed.payload.topic,
                        tone: parsed.payload.tone as PostCreatorOptions['tone'],
                        dryRun: options.dryRun,
                    });
                    executionResult = workerResult(
                        postResult.published ? 1 : 0,
                        postResult.error ? [{ message: postResult.error }] : [],
                    );
                } else {
                    const _exhaustive: never = job.type;
                    throw new RetryableWorkerError(
                        `Tipo job non riconosciuto: ${_exhaustive as string}`,
                        'UNKNOWN_JOB_TYPE',
                    );
                }

                processedCurrentJob = true;

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
                        'WORKER_REPORTED_FAILURE',
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
                    `${hasWorkerWarnings ? 'job.succeeded_with_errors' : 'job.succeeded'}:${job.id}:${job.type}`,
                );
                consecutiveFailures = 0;

                // ── Campaign state advance ───────────────────────────────
                // Se il job era parte di una Drip Campaign, avanza lo stato leadcampaign
                // non-blocking: non blocca la pipeline se fallisce
                try {
                    const maybeCampaignPayload = parseJobPayload<{ campaignStateId?: number }>(job);
                    if (typeof maybeCampaignPayload.payload.campaignStateId === 'number') {
                        await advanceLeadCampaign(maybeCampaignPayload.payload.campaignStateId);
                    }
                } catch {
                    // Ignora errori nella campaign engine — non impatta la job run principale
                }

                // Pausa umana tra un job e il successivo (anti-burst)
                await interJobDelay(session.page);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const attempts = job.attempts + 1;

                const isAcceptancePending =
                    error instanceof RetryableWorkerError && error.code === 'ACCEPTANCE_PENDING';

                if (!isAcceptancePending) {
                    accountHealthMetrics.failed += 1;
                    await incrementDailyStat(options.localDate, 'run_errors');
                }

                await createJobAttempt(
                    job.id,
                    false,
                    error instanceof Error ? error.name : 'UNKNOWN_ERROR',
                    message,
                    null,
                );

                if (error instanceof ChallengeDetectedError) {
                    accountHealthMetrics.challenges += 1;
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
                    await logError('job.challenge_detected', {
                        jobId: job.id,
                        type: job.type,
                        message,
                        accountId: account.id,
                    });
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

                const retryPolicy = resolveWorkerRetryPolicy(error, job.max_attempts, config.retryBaseMs);
                const effectiveMaxAttempts = Math.max(1, Math.min(job.max_attempts, retryPolicy.maxAttempts));
                const nextDelay = retryPolicy.retryable
                    ? retryPolicy.fixedDelay
                        ? retryPolicy.baseDelayMs + Math.floor(Math.random() * 250)
                        : retryDelayMs(attempts, retryPolicy.baseDelayMs)
                    : 0;

                const status = await markJobRetryOrDeadLetter(
                    job.id,
                    attempts,
                    effectiveMaxAttempts,
                    nextDelay,
                    message,
                );
                await pushOutboxEvent(
                    'job.failed',
                    {
                        jobId: job.id,
                        type: job.type,
                        attempts,
                        maxAttempts: effectiveMaxAttempts,
                        status,
                        error: message,
                        retryPolicy,
                        accountId: account.id,
                    },
                    `job.failed:${job.id}:${attempts}`,
                );

                if (
                    status === 'DEAD_LETTER' &&
                    (job.type === 'INVITE' || job.type === 'MESSAGE' || job.type === 'ACCEPTANCE_CHECK')
                ) {
                    accountHealthMetrics.deadLetters += 1;
                    try {
                        const parsed = parseJobPayload<{ leadId?: number }>(job);
                        if (parsed.payload.leadId) {
                            await transitionLead(
                                parsed.payload.leadId,
                                'REVIEW_REQUIRED',
                                `job_dead_letter_${job.type.toLowerCase()}`,
                            );
                            await logWarn('job.dead_letter.lead_review_required', {
                                jobId: job.id,
                                leadId: parsed.payload.leadId,
                                type: job.type,
                            });
                        }
                    } catch {
                        // ignore if payload cannot be parsed
                    }
                }

                // ── Campaign state fail ──────────────────────────────────
                // Dead-letter su qualsiasi job con campaignStateId → marca la campagna come ERROR
                if (status === 'DEAD_LETTER') {
                    try {
                        const maybeCampaignPayload = parseJobPayload<{ campaignStateId?: number }>(job);
                        if (typeof maybeCampaignPayload.payload.campaignStateId === 'number') {
                            await failLeadCampaign(maybeCampaignPayload.payload.campaignStateId, message);
                        }
                    } catch {
                        // Non-bloccante
                    }
                }

                await logWarn('job.failed', {
                    jobId: job.id,
                    type: job.type,
                    status,
                    attempts,
                    maxAttempts: effectiveMaxAttempts,
                    message,
                    retryPolicy,
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
                        config.autoPauseMinutesOnFailureBurst,
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
                processedThisRun += 1;
                accountHealthMetrics.processed += 1;
                jobsSinceDecoy += 1;
                jobsSinceCoffeeBreak += 1;
            }

            if (!options.dryRun && jobsSinceCoffeeBreak >= nextCoffeeBreakAt) {
                const coffeeBreakMs =
                    randomInt(
                        Math.max(60, config.behaviorCoffeeBreakMinSec),
                        Math.max(config.behaviorCoffeeBreakMinSec, config.behaviorCoffeeBreakMaxSec),
                    ) * 1000;
                await logInfo('job_runner.coffee_break.start', {
                    accountId: account.id,
                    jobsSinceCoffeeBreak,
                    nextCoffeeBreakAt,
                    coffeeBreakMs,
                });
                await session.page.waitForTimeout(coffeeBreakMs);
                jobsSinceCoffeeBreak = 0;
                nextCoffeeBreakAt = randomInt(
                    config.behaviorCoffeeBreakMinIntervalJobs,
                    config.behaviorCoffeeBreakMaxIntervalJobs,
                );
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
            if (Date.now() - sessionStartedAtMs >= 60 * 60 * 1000) {
                // 60 minutes
                rotateReasons.push('memory_protection_60_min');
            }

            if (rotateReasons.length > 0) {
                const rotated = await rotateSessionWithLoginCheck(
                    session,
                    workerContext,
                    rotateReasons.join('+'),
                    account,
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
                const followUpsSentSoFar = await getDailyStat(options.localDate, 'follow_ups_sent');
                const followUpResult = await runFollowUpWorker(followUpContext, followUpsSentSoFar);
                await logInfo('job_runner.follow_up_phase_done', {
                    accountId: account.id,
                    success: followUpResult.success,
                    processedCount: followUpResult.processedCount,
                    errorsCount: followUpResult.errors.length,
                    dailySentSoFar: followUpsSentSoFar,
                });
            } catch (err: unknown) {
                if (err instanceof ChallengeDetectedError) {
                    accountHealthMetrics.challenges += 1;
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
        await persistAccountHealth(account, options, accountHealthMetrics).catch(() => null);
        await updateAccountBackpressure(account.id, {
            sent: accountHealthMetrics.processed,
            failed: accountHealthMetrics.failed,
            permanentFailures: accountHealthMetrics.deadLetters,
        }).catch(() => null);
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
        const includeLegacyDefaultQueue =
            config.accountLegacyDefaultQueueFallback &&
            isMultiAccountRuntimeEnabled() &&
            index === 0 &&
            account.id !== 'default';
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
