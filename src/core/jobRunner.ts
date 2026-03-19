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
import { recordSuccessfulAuth, checkSessionFreshness, detectSessionCookieAnomaly } from '../browser/sessionCookieMonitor';
import { blockUserInput } from '../browser/humanBehavior';
import { enableWindowClickThrough, disableWindowClickThrough } from '../browser/windowInputBlock';
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
import { broadcast } from '../telemetry/broadcaster';
import { runProxyQualityCheckIfDue } from '../proxyManager';
import { randomInt } from '../utils/random';
import { getSessionHistory, recordSessionPattern } from '../risk/sessionMemory';
import { retryDelayMs } from '../utils/async';
import { JobType } from '../types/domain';
import { WorkerContext, addBreadcrumb, formatBreadcrumbs } from '../workers/context';
import { ChallengeDetectedError, isProxyConnectionError, resolveWorkerRetryPolicy, RetryableWorkerError } from '../workers/errors';
import { runFollowUpWorker } from '../workers/followUpWorker';
import { workerRegistry } from '../workers/registry';
import { transitionLead } from './leadStateService';
import { advanceLeadCampaign, failLeadCampaign } from './campaignEngine';
import {
    createJobAttempt,
    getDailyStat,
    getAutomationPauseState,
    getLeadById,
    getRuntimeFlag,
    setRuntimeFlag,
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
    inviteSuccesses: number;
    messageSuccesses: number;
    checkSuccesses: number;
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
        inviteSuccesses: 0,
        messageSuccesses: 0,
        checkSuccesses: 0,
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
            return;
        }

        recordSuccessfulAuth(account.sessionDir, account.id);

        // M25: Chiudi modali residui al boot (cookie consent, premium upsell, download app).
        // Se un modale è aperto da una sessione precedente, blocca i click sui bottoni target.
        try {
            const { dismissKnownOverlays } = await import('../browser');
            await dismissKnownOverlays(session.page);
        } catch { /* best-effort */ }

        // Blocca input utente per tutta la sessione automatica.
        // Previene click accidentali durante warmup, decoy, e inter-job delay.
        // I navigation context re-iniettano l'overlay dopo ogni page.goto.
        enableWindowClickThrough(session.browser);
        await blockUserInput(session.page);

        // ── Session cookie anomaly detection ──────────────────────────────
        // Rileva se il cookie li_at è cambiato o scomparso senza rotazione esplicita.
        // Segnale di invalidazione server-side o ban imminente.
        const cookieAnomaly = await detectSessionCookieAnomaly(session.page, account.sessionDir);
        if (cookieAnomaly) {
            await sendTelegramAlert(
                `Session cookie anomaly: ${cookieAnomaly.anomaly} (account: ${account.id})`,
                'Session Cookie Alert',
                cookieAnomaly.anomaly === 'COOKIE_MISSING' ? 'critical' : 'warn',
            );
            if (cookieAnomaly.anomaly === 'COOKIE_MISSING') {
                await quarantineAccount('SESSION_COOKIE_MISSING', {
                    accountId: account.id,
                    message: 'Cookie li_at scomparso — possibile ban o invalidazione server-side.',
                });
                return;
            }
            // M24: COOKIE_CHANGED → warning ma NON blocco.
            // LinkedIn ruota li_at ogni ~2 settimane come comportamento normale.
            // Bloccare per un cambio cookie legittimo causerebbe pause inutili.
            // L'hash viene aggiornato in sessionCookieMonitor → non ri-alerta.
            // Solo COOKIE_MISSING (sopra) è critico e blocca.
        }

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

        // ── Session Warmup integrato (A.1a + A.2) ──────────────────────────
        // Il warmup gira nella STESSA sessione browser che processerà i job.
        // Un umano prima scorre feed/notifiche, poi lavora — non apre un browser
        // per scrollare, lo chiude, ne apre un altro per lavorare.
        if (!options.dryRun) {
            try {
                const { warmupSession } = await import('./sessionWarmer');
                // H25: Passa timestamp ultima sessione per warmup condizionale
                const lastSessionFlag = await getRuntimeFlag(`browser_session_started_at:${account.id}`).catch(() => null);
                await warmupSession(session.page, lastSessionFlag);
                await logInfo('job_runner.warmup_integrated', { accountId: account.id });
            } catch (warmupErr) {
                await logWarn('job_runner.warmup_failed', {
                    accountId: account.id,
                    error: warmupErr instanceof Error ? warmupErr.message : String(warmupErr),
                });
                // Non bloccante: se il warmup fallisce, il jobRunner prosegue
            }
        }

        // C.1: Reset proxy failure counter — il proxy funziona in questo ciclo
        await setRuntimeFlag(`proxy_failure_count:${account.id}`, '0').catch(() => null);

        // Proxy quality check pre-batch (non bloccante)
        if (config.proxyQualityCheckEnabled) {
            try {
                const qualityReport = await runProxyQualityCheckIfDue();
                if (qualityReport?.degraded) {
                    await broadcast({
                        level: 'WARNING',
                        title: 'Proxy Quality Degradata',
                        body: `Quality score ${qualityReport.overallScore}/100 (soglia: ${config.proxyQualityMinScore}). Datacenter: ${qualityReport.datacenterCount}/${qualityReport.proxies.length}`,
                    });
                }
            } catch {
                // Non bloccante: se il quality check fallisce, procediamo comunque
            }
        }

        // Pacing factor dalla session memory: dopo challenge recenti → delay più lunghi
        const sessionHistory = await getSessionHistory(account.id, 7);
        const sessionPacingFactor = sessionHistory.pacingFactor;

        const visitedProfilesToday = new Set<string>();
        const { getBehavioralProfile } = await import('../browser/sessionCookieMonitor');
        const behavioralProfile = getBehavioralProfile(account.sessionDir, account.id);
        // NEW-4: Inietta profileMultiplier nel DeviceProfile della page
        // così humanDelay/interJobDelay lo leggono automaticamente via getPageDeviceProfile
        session.deviceProfile.profileMultiplier = behavioralProfile.avgClickDelayMs / 1000;
        const workerContext: WorkerContext = {
            session,
            dryRun: options.dryRun,
            localDate: options.localDate,
            accountId: account.id,
            behavioralProfile,
            visitedProfilesToday,
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

        // ── Session Duration Variance (1.1) ──────────────────────────────
        // Jitterare i limiti di memoria/durata sessione per evitare pattern fissi.
        // Ogni sessione riceve un cap diverso dentro il range configurato.
        const sessionMaxJobs = randomInt(
            config.sessionMemoryProtectionMinJobs,
            config.sessionMemoryProtectionMaxJobs,
        );
        const sessionMaxMs = randomInt(
            config.sessionMemoryProtectionMinMinutes,
            config.sessionMemoryProtectionMaxMinutes,
        ) * 60_000;
        // Wind-down: nell'ultimo X% della sessione, rallenta delay e azioni
        const windDownJobThreshold = Math.floor(sessionMaxJobs * (1 - config.sessionWindDownPct));
        const windDownMsThreshold = Math.floor(sessionMaxMs * (1 - config.sessionWindDownPct));
        let windDownActive = false;
        const listFailureTracker = new Map<string, number>(); // Circuit Breaker Per-Lista (6.6)
        const accountBpLevel = await getAccountBackpressureLevel(account.id);
        let maxJobsPerRun = Math.max(1, computeBackpressureBatchSize(config.accountMaxJobsPerRun, accountBpLevel));
        let consecutiveSlowResponses = 0;
        let batchReducedMidSession = false;
        let sessionStartedAtMs = Date.now();
        await setRuntimeFlag(`browser_session_started_at:${account.id}`, new Date(sessionStartedAtMs).toISOString()).catch(() => null);
        let processedThisRun = 0;
        let lastJa3CheckMs = Date.now(); // C03: periodic JA3 check mid-session
        let lastBudgetRecalcAt = 0; // H24: track processed count at last budget recalc
        let totalActionMs = 0; // A10/A20: delay creep tracking
        let totalDelayMs = 0; // A10/A20: delay creep tracking

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

            // ── Wind-Down Detection (1.1) ─────────────────────────────────
            // Nell'ultimo X% della sessione (per job O per tempo), attiva wind-down:
            // interJobDelay più lento, azioni più caute — simula umano che si stanca.
            const sessionElapsedMs = Date.now() - sessionStartedAtMs;
            if (!windDownActive && (
                processedOnCurrentSession >= windDownJobThreshold ||
                sessionElapsedMs >= windDownMsThreshold
            )) {
                windDownActive = true;
                workerContext.windDownSpeedReduction = config.sessionWindDownSpeedReduction;
                await logInfo('job_runner.wind_down.activated', {
                    accountId: account.id,
                    processedOnCurrentSession,
                    windDownJobThreshold,
                    sessionElapsedMs,
                    windDownMsThreshold,
                    speedReduction: config.sessionWindDownSpeedReduction,
                });
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
                consecutiveSlowResponses += 1;
                const extraDelayMs = 3000 + Math.floor(Math.random() * 5000);
                await logInfo('job_runner.http_throttle.slow', {
                    accountId: account.id,
                    ratio: throttleSignal.ratio,
                    extraDelayMs,
                    consecutiveSlowResponses,
                });
                await new Promise((r) => setTimeout(r, extraDelayMs));

                // Smart Batch Sizing (4.2): 3+ slow consecutivi → terminare sessione
                // LinkedIn sta chiaramente pushback — meglio fermarsi prima del 429.
                if (consecutiveSlowResponses >= 3) {
                    await logWarn('job_runner.smart_batch.session_abort', {
                        accountId: account.id,
                        consecutiveSlowResponses,
                        processedThisRun,
                        maxJobsPerRun,
                        reason: 'consecutive_slow_responses',
                    });
                    break;
                }

                // Prima volta shouldSlow → ridurre batch -30% per rallentare proattivamente
                if (!batchReducedMidSession) {
                    const reducedBatch = Math.max(1, Math.floor(maxJobsPerRun * 0.7));
                    await logInfo('job_runner.smart_batch.reduced', {
                        accountId: account.id,
                        oldMaxJobs: maxJobsPerRun,
                        newMaxJobs: reducedBatch,
                    });
                    maxJobsPerRun = reducedBatch;
                    batchReducedMidSession = true;
                }
            } else {
                // Reset counter se il throttle non è più attivo
                consecutiveSlowResponses = 0;
            }

            // C03: Periodic JA3 check mid-session — se CycleTLS crasha durante la sessione,
            // il bot continua a navigare con fingerprint TLS nativo (rilevabile da LinkedIn).
            // Check ogni 10 minuti, non bloccante: se JA3 non è più attivo → pausa + alert.
            if (config.useJa3Proxy && Date.now() - lastJa3CheckMs >= 10 * 60 * 1000) {
                lastJa3CheckMs = Date.now();
                try {
                    const { validateJa3Configuration } = await import('../proxy/ja3Validator');
                    const ja3Report = await validateJa3Configuration();
                    if (!ja3Report.cycleTlsActive) {
                        await logWarn('job_runner.ja3_mid_session_failed', {
                            accountId: account.id,
                            port: ja3Report.cycleTlsPort,
                        });
                        await pauseAutomation('JA3_PROXY_DEAD_MID_SESSION', {
                            accountId: account.id,
                            message: 'CycleTLS non raggiungibile durante la sessione — fingerprint TLS esposto.',
                        }, 30);
                        break;
                    }
                } catch {
                    // Best-effort: se il check fallisce, procedi
                }
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
            addBreadcrumb(workerContext, `job.start:${job.type}`, `id=${job.id} attempt=${job.attempts + 1}`);

            let processedCurrentJob = false;
            try {
                const processor = workerRegistry.get(job.type);
                if (!processor) {
                    throw new RetryableWorkerError(
                        `Tipo job non riconosciuto: ${job.type}`,
                        'UNKNOWN_JOB_TYPE',
                    );
                }
                const actionStartMs = Date.now(); // A10/A20
                const executionResult = await processor.process(job, workerContext);
                totalActionMs += Date.now() - actionStartMs; // A10/A20

                // CC-5: Solo job con processedCount > 0 contano come "processed".
                // workerResult(0) con success=true indica skip (blacklist, validazione, etc.)
                // e non deve sprecare slot budget.
                processedCurrentJob = executionResult.processedCount > 0;

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
                addBreadcrumb(workerContext, `job.ok:${job.type}`, `id=${job.id}`);
                // C05: Incrementa sessionActionCount per decay navigazione organica
                if (processedCurrentJob) {
                    workerContext.sessionActionCount = (workerContext.sessionActionCount ?? 0) + 1;
                }
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
                // Se il job era parte di una Drip Campaign, avanza lo stato leadcampaign.
                // Non blocca la pipeline, ma logga e marca ERROR per evitare stuck (NEW-8 fix).
                try {
                    const maybeCampaignPayload = parseJobPayload<{ campaignStateId?: number }>(job);
                    if (typeof maybeCampaignPayload.payload.campaignStateId === 'number') {
                        await advanceLeadCampaign(maybeCampaignPayload.payload.campaignStateId);
                    }
                } catch (campaignError) {
                    const campaignMsg = campaignError instanceof Error ? campaignError.message : String(campaignError);
                    await logWarn('job_runner.campaign_advance_failed', {
                        jobId: job.id,
                        type: job.type,
                        accountId: account.id,
                        error: campaignMsg,
                    });
                    // Tenta di marcare il campaign state come ERROR per evitare stuck
                    try {
                        const fallbackPayload = parseJobPayload<{ campaignStateId?: number }>(job);
                        if (typeof fallbackPayload.payload.campaignStateId === 'number') {
                            await failLeadCampaign(fallbackPayload.payload.campaignStateId, campaignMsg);
                        }
                    } catch {
                        // best-effort: se anche failLeadCampaign fallisce, il log sopra traccia il problema
                    }
                }

                // H24: Budget recalc mid-session — ogni 10 job processati, rivaluta il budget.
                // Se il risk score è salito (challenge, throttle), riduce maxJobsPerRun.
                // Il throttler HTTP adatta i DELAY, ma non il VOLUME — questo fix chiude il gap.
                if (processedThisRun - lastBudgetRecalcAt >= 10) {
                    lastBudgetRecalcAt = processedThisRun;
                    try {
                        const currentThrottle = session.httpThrottler.getThrottleSignal();
                        // Se il throttle ratio è > 1.5 (LinkedIn sta rallentando), riduci budget -20%
                        if (currentThrottle.ratio > 1.5 && !batchReducedMidSession) {
                            const newMax = Math.max(1, Math.floor(maxJobsPerRun * 0.8));
                            await logInfo('job_runner.h24_budget_recalc.throttle_reduction', {
                                accountId: account.id,
                                oldMaxJobs: maxJobsPerRun,
                                newMaxJobs: newMax,
                                throttleRatio: currentThrottle.ratio,
                                processedThisRun,
                            });
                            maxJobsPerRun = newMax;
                        }
                    } catch { /* best-effort budget recalc */ }
                }

                // Pausa umana tra un job e il successivo (anti-burst)
                // Feedback loop reattivo: se LinkedIn sta rallentando, il delay aumenta automaticamente
                // Durante il delay, lancia enrichment parallelo (zero traffico LinkedIn)
                // Wind-down: durante l'ultimo X% della sessione, rallenta interJobDelay
                // moltiplicando il delay (pacingFactor < 1 → delay più lungo in interJobDelay)
                const effectivePacingFactor = windDownActive
                    ? sessionPacingFactor / config.sessionWindDownDelayMultiplier
                    : sessionPacingFactor;
                const throttleSignal = session.httpThrottler.getThrottleSignal();
                const delayStartMs = Date.now(); // A10/A20
                await Promise.allSettled([
                    interJobDelay(session.page, throttleSignal, effectivePacingFactor),
                    (async () => {
                        try {
                            const { enrichLeadsParallel } = await import('../integrations/parallelEnricher');
                            await enrichLeadsParallel({ limit: 2, concurrency: 1 });
                        } catch { /* enrichment best-effort, never blocks job flow */ }
                    })(),
                ]);
                totalDelayMs += Date.now() - delayStartMs; // A10/A20
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
                    addBreadcrumb(workerContext, 'CHALLENGE_DETECTED', message.substring(0, 100));
                    await handleChallengeDetected({
                        source: 'job_runner',
                        accountId: account.id,
                        leadId: challengeLeadId,
                        jobId: job.id,
                        jobType: job.type,
                        message,
                        extra: {
                            statusBeforeFailure: job.status,
                            breadcrumbs: formatBreadcrumbs(workerContext),
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

                // ── Proxy failure con escalation cross-ciclo (C.1) ──────────
                // Se il proxy è morto, traccia failure consecutive in runtime_flags.
                // Dopo 3 failure consecutive → pausa INDEFINITA + alert Telegram critico.
                // Prima: loop infinito (pausa 15min → riprova → fallisce → pausa 15min).
                // Dopo: 3 fallimenti → STOP + "cambia proxy".
                if (isProxyConnectionError(error)) {
                    await markJobRetryOrDeadLetter(job.id, attempts, job.max_attempts, retryDelayMs(attempts, config.retryBaseMs), message);

                    const cbKey = `proxy_failure_count:${account.id}`;
                    const prevCount = parseInt(await getRuntimeFlag(cbKey).catch(() => '0') ?? '0', 10);
                    const failCount = (Number.isFinite(prevCount) ? prevCount : 0) + 1;
                    await setRuntimeFlag(cbKey, String(failCount)).catch(() => null);

                    await logWarn('job_runner.proxy_failure.session_abort', {
                        jobId: job.id,
                        type: job.type,
                        accountId: account.id,
                        message,
                        consecutiveProxyFailures: failCount,
                    });

                    if (failCount >= 3) {
                        // Proxy permanentemente morto → pausa indefinita
                        await pauseAutomation(
                            'PROXY_PERMANENTLY_DEAD',
                            { accountId: account.id, consecutiveFailures: failCount, message },
                            7 * 24 * 60, // 7 giorni — l'utente deve fare 'resume' dopo aver fixato il proxy
                        );
                        await sendTelegramAlert(
                            `🚨 Proxy MORTO per account ${account.id}.\n${failCount} fallimenti consecutivi.\n\nAzione richiesta:\n1. Verificare le credenziali proxy\n2. Testare il proxy manualmente\n3. Cambiare proxy nel .env\n4. Eseguire 'bot.ps1 resume' per riprendere`,
                            'Proxy Morto',
                            'critical',
                        ).catch(() => null);
                    } else {
                        await pauseAutomation(
                            'PROXY_CONNECTION_FAILED',
                            { accountId: account.id, jobId: job.id, message, consecutiveFailures: failCount },
                            15,
                        );
                    }
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

                            // Circuit Breaker Per-Lista (6.6 wire): traccia dead letters per lista.
                            // Quando una lista accumula 3+ dead letters in una sessione, attiva CB per 4h.
                            try {
                                const cbLead = await getLeadById(parsed.payload.leadId);
                                if (cbLead?.list_name) {
                                    const prevCount = listFailureTracker.get(cbLead.list_name) ?? 0;
                                    const newCount = prevCount + 1;
                                    listFailureTracker.set(cbLead.list_name, newCount);
                                    if (newCount >= 3) {
                                        const cbExpiry = Date.now() + 4 * 60 * 60 * 1000; // 4 ore
                                        await setRuntimeFlag(`cb::list::${cbLead.list_name}`, String(cbExpiry));
                                        const expiresAt = new Date(cbExpiry).toISOString();
                                        await logWarn('job_runner.circuit_breaker.list_activated', {
                                            accountId: account.id,
                                            listName: cbLead.list_name,
                                            deadLetters: newCount,
                                            expiresAt,
                                        });
                                        // L5: Alert Telegram per visibilità utente
                                        await sendTelegramAlert(
                                            `Circuit Breaker attivato per lista "${cbLead.list_name}".\n${newCount} dead letters in questa sessione.\nLista sospesa fino a ${expiresAt}.\nVerifica selettori e lead di questa lista.`,
                                            'Circuit Breaker Lista',
                                            'warn',
                                        ).catch(() => null);
                                    }
                                }
                            } catch { /* best-effort CB tracking */ }
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

                addBreadcrumb(workerContext, `job.fail:${job.type}`, message.substring(0, 80));
                consecutiveFailures += 1;
                if (consecutiveFailures >= config.maxConsecutiveJobFailures) {
                    // Circuit breaker sessione: forza rotazione browser+fingerprint PRIMA della pausa.
                    // Se LinkedIn ha flaggato questa combinazione IP+fingerprint, riprendere con la
                    // stessa sessione è inutile. La rotazione dà al retry una chance reale di successo.
                    const rotated = await rotateSessionWithLoginCheck(
                        session,
                        workerContext,
                        'circuit_breaker_consecutive_failures',
                        account,
                    );
                    if (rotated) {
                        session = rotated;
                        processedOnCurrentSession = 0;
                        sessionStartedAtMs = Date.now();
                        await setRuntimeFlag(`browser_session_started_at:${account.id}`, new Date(sessionStartedAtMs).toISOString()).catch(() => null);
                    }

                    await pauseAutomation(
                        'CONSECUTIVE_JOB_FAILURES',
                        {
                            threshold: config.maxConsecutiveJobFailures,
                            consecutiveFailures,
                            lastJobId: job.id,
                            lastJobType: job.type,
                            lastError: message,
                            accountId: account.id,
                            sessionRotated: !!rotated,
                        },
                        config.autoPauseMinutesOnFailureBurst,
                    );
                    await logWarn('job_runner.paused.failure_burst', {
                        threshold: config.maxConsecutiveJobFailures,
                        consecutiveFailures,
                        pauseMinutes: config.autoPauseMinutesOnFailureBurst,
                        accountId: account.id,
                        sessionRotated: !!rotated,
                    });
                    break;
                }
            }

            if (processedCurrentJob) {
                processedOnCurrentSession += 1;
                processedThisRun += 1;
                accountHealthMetrics.processed += 1;
                if (job.type === 'INVITE') accountHealthMetrics.inviteSuccesses += 1;
                else if (job.type === 'MESSAGE') accountHealthMetrics.messageSuccesses += 1;
                else if (job.type === 'ACCEPTANCE_CHECK') accountHealthMetrics.checkSuccesses += 1;
                jobsSinceDecoy += 1;
                jobsSinceCoffeeBreak += 1;

                // Progress bar con ETA dinamico (terminale in-place)
                const elapsedSec = Math.floor((Date.now() - accountHealthMetrics.startedAtMs) / 1000);
                const avgSecPerJob = processedThisRun > 0 ? elapsedSec / processedThisRun : 0;
                const remainingJobs = maxJobsPerRun - processedThisRun;
                const etaSec = Math.ceil(avgSecPerJob * remainingJobs);
                const etaMin = Math.floor(etaSec / 60);
                const etaStr = etaMin > 0 ? `~${etaMin}m${etaSec % 60}s` : `~${etaSec}s`;
                const bar = `[${'█'.repeat(Math.min(20, Math.floor((processedThisRun / maxJobsPerRun) * 20)))}${'░'.repeat(Math.max(0, 20 - Math.floor((processedThisRun / maxJobsPerRun) * 20)))}]`;
                process.stdout.write(`\r  ${bar} ${processedThisRun}/${maxJobsPerRun} | I:${accountHealthMetrics.inviteSuccesses} M:${accountHealthMetrics.messageSuccesses} C:${accountHealthMetrics.checkSuccesses} | ETA ${etaStr}   `);

                // Telegram progress: notifica ogni 5 job completati (non bloccante)
                if (processedThisRun > 0 && processedThisRun % 5 === 0) {
                    void sendTelegramAlert(
                        `Progresso: ${processedThisRun}/${maxJobsPerRun} job completati\n` +
                        `Inviti: ${accountHealthMetrics.inviteSuccesses} | Messaggi: ${accountHealthMetrics.messageSuccesses} | Check: ${accountHealthMetrics.checkSuccesses}\n` +
                        `ETA: ${etaStr}`,
                        'Progresso Sessione',
                        'info',
                    ).catch(() => null);
                }
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

            // Memory Leak Protection (Jittered Limits — 1.1)
            if (processedOnCurrentSession >= sessionMaxJobs) {
                rotateReasons.push(`memory_protection_${sessionMaxJobs}_jobs`);
            }
            if (Date.now() - sessionStartedAtMs >= sessionMaxMs) {
                rotateReasons.push(`memory_protection_${Math.round(sessionMaxMs / 60_000)}_min`);
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
                await setRuntimeFlag(`browser_session_started_at:${account.id}`, new Date(sessionStartedAtMs).toISOString()).catch(() => null);
            } else if (processedOnCurrentSession > 0 && processedOnCurrentSession % 10 === 0) {
                // Collect garbage proactively to prevent browser bloating
                await performBrowserGC(session);
            }
        }

        // ── GAP4-C09: Inbox Phase PRIMA del follow-up ─────────────────────
        // Rileva risposte lead PRIMA che il follow-up invii. Senza questo,
        // il follow-up potrebbe spammare chi ha già risposto.
        // Gira nella stessa sessione browser — zero overhead di apertura browser.
        if (!sessionClosed && !options.dryRun) {
            try {
                const { processInboxJob } = await import('../workers/inboxWorker');
                const inboxResult = await processInboxJob({ accountId: account.id }, {
                    session,
                    dryRun: false,
                    localDate: options.localDate,
                    accountId: account.id,
                });
                if (inboxResult.processedCount > 0) {
                    await logInfo('job_runner.inbox_phase_done', {
                        accountId: account.id,
                        processedCount: inboxResult.processedCount,
                    });
                }
            } catch (inboxErr) {
                await logWarn('job_runner.inbox_phase_error', {
                    accountId: account.id,
                    error: inboxErr instanceof Error ? inboxErr.message : String(inboxErr),
                });
                // Non bloccante: se inbox fallisce, follow-up procede comunque
                // (ha il safety net DB via lead_intents + check in-browser)
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

        // A10/A20: Log delay creep ratio a fine sessione.
        // Se delay > 60% del tempo totale → il bot passa più tempo in attesa che in azione.
        const totalSessionMs = Date.now() - sessionStartedAtMs;
        if (totalSessionMs > 0 && accountHealthMetrics.processed > 0) {
            const delayPct = Math.round((totalDelayMs / totalSessionMs) * 100);
            const actionPct = Math.round((totalActionMs / totalSessionMs) * 100);
            const overheadPct = Math.max(0, 100 - delayPct - actionPct);
            await logInfo('job_runner.session_performance', {
                accountId: account.id,
                totalSessionMs,
                totalActionMs,
                totalDelayMs,
                delayPct,
                actionPct,
                overheadPct,
                processed: accountHealthMetrics.processed,
                delayCreepAlert: delayPct > 60,
            });
        }
    } finally {
        // H15: Wind-down SEMPRE — un umano non chiude il browser dalla pagina profilo.
        // Torna al feed, scrolla un po', poi chiude. Il 30% precedente lasciava il 70%
        // delle sessioni chiuse bruscamente dall'ultima azione — pattern rilevabile.
        if (!sessionClosed && !options.dryRun) {
            try {
                await session.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
                await session.page.waitForTimeout(2000 + Math.floor(Math.random() * 4000));
                // Scroll leggero del feed prima di chiudere (simula lettura rapida)
                await session.page.evaluate(() => window.scrollBy({ top: 200 + Math.random() * 300, behavior: 'smooth' })).catch(() => null);
                await session.page.waitForTimeout(1000 + Math.floor(Math.random() * 2000));
            } catch { /* best-effort wind-down */ }
        }
        if (!sessionClosed) {
            disableWindowClickThrough(session.browser);
            await closeBrowser(session);
        }
        await persistAccountHealth(account, options, accountHealthMetrics).catch((e) => {
            void logWarn('job_runner.persist_health_failed', { accountId: account.id, error: e instanceof Error ? e.message : String(e) });
        });
        await updateAccountBackpressure(account.id, {
            sent: accountHealthMetrics.processed,
            failed: accountHealthMetrics.failed,
            permanentFailures: accountHealthMetrics.deadLetters,
        }).catch((e) => {
            void logWarn('job_runner.update_backpressure_failed', { accountId: account.id, error: e instanceof Error ? e.message : String(e) });
        });

        // Record session pattern for cross-session pacing factor learning.
        // Senza questo, getSessionHistory() ritorna sempre vuoto e il pacing
        // factor non si adatta mai alle sessioni passate.
        if (!options.dryRun && accountHealthMetrics.processed > 0) {
            const sessionStartHour = new Date(accountHealthMetrics.startedAtMs).getHours();
            await recordSessionPattern(account.id, options.localDate, {
                loginHour: sessionStartHour,
                logoutHour: new Date().getHours(),
                totalActions: accountHealthMetrics.processed,
                inviteCount: accountHealthMetrics.inviteSuccesses,
                messageCount: accountHealthMetrics.messageSuccesses,
                checkCount: accountHealthMetrics.checkSuccesses,
                challenges: accountHealthMetrics.challenges,
            }).catch((e) => {
                void logWarn('job_runner.record_session_pattern_failed', { accountId: account.id, error: e instanceof Error ? e.message : String(e) });
            });
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

        // Anti-correlazione: delay 2-5 min tra account per evitare che LinkedIn
        // veda due account dallo stesso IP nello stesso minuto (pattern rilevabile).
        if (index < accounts.length - 1) {
            const gapMs = (120 + Math.floor(Math.random() * 180)) * 1000;
            await logInfo('job_runner.inter_account_gap', {
                accountId: account.id,
                nextAccountId: accounts[index + 1]?.id,
                gapMs,
            });
            await new Promise((r) => setTimeout(r, gapMs));
        }
        const latestQuarantineFlag = await getRuntimeFlag('account_quarantine');
        if (latestQuarantineFlag === 'true') {
            break;
        }
    }
}
