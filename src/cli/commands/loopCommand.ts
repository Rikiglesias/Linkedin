/**
 * loopCommand.ts — Comando run-loop e autopilot
 *
 * Gestisce il ciclo principale di automazione con lock distribuito,
 * site-check automatico, salesnav sync, enrichment, dead letter worker.
 */

import { randomUUID } from 'crypto';
import { config, getEffectiveLoopIntervalMs, getHourInTimezone, getLocalDateString, isWorkingHour } from '../../config';
import { sleep } from '../../utils/async';
import { launchBrowser, closeBrowser as closeBrowserSession } from '../../browser';
import { checkSessionFreshness } from '../../browser/sessionCookieMonitor';
import {
    acquireRuntimeLock,
    getDailyStatsSnapshot,
    getGlobalKPIData,
    getRuntimeFlag,
    heartbeatRuntimeLock,
    recoverStuckJobs,
    releaseRuntimeLock,
    setRuntimeFlag,
    setAutomationPause,
    clearAutomationPause as clearPauseState,
    startCampaignRun,
    finishCampaignRun,
} from '../../core/repositories';
import { runDoctor } from '../../core/doctor';
import { runWorkflow } from '../../core/orchestrator';
import { dispatchReadyCampaignSteps } from '../../core/campaignEngine';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
// warmupSession rimosso da qui — ora integrato nel jobRunner (A.1a)
import { runSiteCheck } from '../../core/audit';
import { runCompanyEnrichmentBatch } from '../../core/companyEnrichment';
import { runRandomLinkedinActivity } from '../../workers/randomActivityWorker';
import { runRampUpWorker } from '../../workers/rampUpWorker';
import { runDeadLetterWorker } from '../../workers/deadLetterWorker';
import { runSelectorLearner } from '../../selectors/learner';
import { backupDatabase } from '../../db';
import { runControlPlaneSync } from '../../cloud/controlPlaneSync';
import { startTelegramListener } from '../../cloud/telegramListener';
import { markTelegramCommandProcessed, pollPendingTelegramCommand } from '../../cloud/supabaseDataClient';
import { getRuntimeAccountProfiles, setOverrideAccountId } from '../../accountManager';
import { RunStatus } from '../../types/domain';
import {
    getOptionValue,
    hasOption,
    parseIntStrict,
    parseWorkflow,
    getWorkflowValue,
    getPositionalArgs,
} from '../cliParser';
import { pluginRegistry } from '../../plugins/pluginLoader';
import { resolveCorrelationId, runWithCorrelationId } from '../../telemetry/correlation';
import { processTelegramImportCommand } from '../../cloud/telegramAiImporter';
import { sendTelegramAlert } from '../../telemetry/alerts';
import { LoopSubTask, LoopCycleContext, runLoopCycle } from '../../core/loopOrchestrator';
import { onConfigReload, startConfigWatcher, stopConfigWatcher } from '../../config/hotReload';

// ─── Costanti lock ────────────────────────────────────────────────────────────

let _workflowRunnerLockKey = 'workflow.runner';
function getWorkflowRunnerLockKey(): string { return _workflowRunnerLockKey; }
const WORKFLOW_RUNNER_MIN_TTL_SECONDS = 120;
const WORKFLOW_RUNNER_HEARTBEAT_MS = 30_000;
const AUTO_SITE_CHECK_LAST_RUN_KEY = 'site_check.last_run_at';
const SALESNAV_LAST_SYNC_KEY = 'salesnav.last_sync_at';
const SELECTOR_LEARNER_LAST_RUN_KEY = 'selector_learner.last_run_date';

// ─── Tipi locali ──────────────────────────────────────────────────────────────

interface LoopDoctorGate {
    proceed: boolean;
    reason: string;
}

interface AutoSiteCheckDecision {
    shouldRun: boolean;
    reason: string;
    hoursSinceLastRun: number | null;
}

interface SalesNavSyncDecision {
    shouldRun: boolean;
    reason: string;
    hoursSinceLastRun: number | null;
}

// ─── Helper lock ──────────────────────────────────────────────────────────────

function createLockOwnerId(command: string): string {
    const suffix = randomUUID().split('-')[0];
    return `${command}:${process.pid}:${suffix}`;
}

function computeWorkflowLockTtlSeconds(intervalMs: number): number {
    return Math.max(WORKFLOW_RUNNER_MIN_TTL_SECONDS, Math.ceil(intervalMs / 1000) + 120);
}

async function acquireWorkflowRunnerLock(
    command: string,
    ttlSeconds: number,
    metadata: Record<string, unknown>,
): Promise<string> {
    const ownerId = createLockOwnerId(command);
    const result = await acquireRuntimeLock(getWorkflowRunnerLockKey(), ownerId, ttlSeconds, metadata);
    if (!result.acquired) {
        const holder = result.lock;
        throw new Error(
            `[LOCK] Runner già attivo.owner = ${holder?.owner_id ?? 'unknown'} heartbeat = ${holder?.heartbeat_at ?? 'n/a'} expires = ${holder?.expires_at ?? 'n/a'} `,
        );
    }
    console.log(`[LOCK] acquired key = ${getWorkflowRunnerLockKey()} owner = ${ownerId} ttl = ${ttlSeconds} s`);
    return ownerId;
}

async function heartbeatWorkflowRunnerLock(ownerId: string, ttlSeconds: number): Promise<void> {
    const ok = await heartbeatRuntimeLock(getWorkflowRunnerLockKey(), ownerId, ttlSeconds);
    if (!ok) {
        throw new Error("[LOCK] Runtime lock perso durante l'esecuzione.");
    }
}

async function releaseWorkflowRunnerLock(ownerId: string): Promise<void> {
    const released = await releaseRuntimeLock(getWorkflowRunnerLockKey(), ownerId);
    console.log(`[LOCK] released key = ${getWorkflowRunnerLockKey()} owner = ${ownerId} released = ${released} `);
}

async function sleepWithLockHeartbeat(totalMs: number, ownerId: string, ttlSeconds: number): Promise<void> {
    let remaining = Math.max(0, totalMs);
    while (remaining > 0) {
        const chunk = Math.min(WORKFLOW_RUNNER_HEARTBEAT_MS, remaining);
        await sleep(chunk);
        remaining -= chunk;
        if (remaining > 0) {
            await heartbeatWorkflowRunnerLock(ownerId, ttlSeconds);
        }
    }
}

// ─── Decision evaluators ──────────────────────────────────────────────────────

async function evaluateAutoSiteCheckDecision(dryRun: boolean): Promise<AutoSiteCheckDecision> {
    if (dryRun) {
        return { shouldRun: false, reason: 'dry_run', hoursSinceLastRun: null };
    }
    if (!config.autoSiteCheckEnabled) {
        return { shouldRun: false, reason: 'auto_site_check_disabled', hoursSinceLastRun: null };
    }

    const lastRunRaw = await getRuntimeFlag(AUTO_SITE_CHECK_LAST_RUN_KEY);
    if (!lastRunRaw) {
        return { shouldRun: true, reason: 'never_run', hoursSinceLastRun: null };
    }

    const parsedMs = Date.parse(lastRunRaw);
    if (!Number.isFinite(parsedMs)) {
        return { shouldRun: true, reason: 'invalid_last_run', hoursSinceLastRun: null };
    }

    const elapsedHours = (Date.now() - parsedMs) / (1000 * 60 * 60);
    if (elapsedHours >= config.autoSiteCheckIntervalHours) {
        return {
            shouldRun: true,
            reason: 'interval_elapsed',
            hoursSinceLastRun: Number.parseFloat(elapsedHours.toFixed(2)),
        };
    }

    return {
        shouldRun: false,
        reason: 'interval_not_elapsed',
        hoursSinceLastRun: Number.parseFloat(elapsedHours.toFixed(2)),
    };
}

async function evaluateSalesNavSyncDecision(dryRun: boolean): Promise<SalesNavSyncDecision> {
    if (dryRun) {
        return { shouldRun: false, reason: 'dry_run', hoursSinceLastRun: null };
    }
    if (!config.salesNavSyncEnabled) {
        return { shouldRun: false, reason: 'salesnav_sync_disabled', hoursSinceLastRun: null };
    }

    const lastRunRaw = await getRuntimeFlag(SALESNAV_LAST_SYNC_KEY);
    if (!lastRunRaw) {
        return { shouldRun: true, reason: 'never_run', hoursSinceLastRun: null };
    }

    const parsedMs = Date.parse(lastRunRaw);
    if (!Number.isFinite(parsedMs)) {
        return { shouldRun: true, reason: 'invalid_last_run', hoursSinceLastRun: null };
    }

    const elapsedHours = (Date.now() - parsedMs) / (1000 * 60 * 60);
    if (elapsedHours >= config.salesNavSyncIntervalHours) {
        return {
            shouldRun: true,
            reason: 'interval_elapsed',
            hoursSinceLastRun: Number.parseFloat(elapsedHours.toFixed(2)),
        };
    }

    return {
        shouldRun: false,
        reason: 'interval_not_elapsed',
        hoursSinceLastRun: Number.parseFloat(elapsedHours.toFixed(2)),
    };
}

async function evaluateLoopDoctorGate(dryRun: boolean): Promise<LoopDoctorGate> {
    if (dryRun) {
        return { proceed: true, reason: 'dry_run' };
    }

    const report = await runDoctor();
    const syncOk = !report.sync.enabled || report.sync.configured;
    if (!report.sessionLoginOk) {
        return { proceed: false, reason: 'doctor_login_missing' };
    }
    if (report.quarantine) {
        return { proceed: false, reason: 'doctor_quarantine_active' };
    }
    if (!syncOk) {
        return { proceed: false, reason: 'doctor_sync_not_configured' };
    }
    if (!report.compliance.ok) {
        return { proceed: false, reason: 'doctor_compliance_violation' };
    }
    return { proceed: true, reason: 'doctor_ok' };
}

async function processCloudCommands(): Promise<void> {
    const activeProfiles = getRuntimeAccountProfiles();
    for (const profile of activeProfiles) {
        try {
            const cmd = await pollPendingTelegramCommand(profile.id);
            if (!cmd) continue;

            console.log(
                `[CLOUD] Comando ricevuto: ${cmd.command} args: ${cmd.args || 'nessuno'} (account: ${profile.id})`,
            );

            if (cmd.command === 'pausa' || cmd.command === 'pause') {
                const minutes = cmd.args && /^[0-9]+$/.test(cmd.args) ? parseInt(cmd.args, 10) : null;
                await setAutomationPause(minutes || null, 'TELEGRAM_COMMAND');
                console.log(
                    `[CLOUD] Automazione globale in pausa ${minutes ? 'per ' + minutes + ' min' : 'indefinitamente'}.`,
                );
            } else if (cmd.command === 'riprendi' || cmd.command === 'resume') {
                await clearPauseState();
                console.log(`[CLOUD] Automazione globale ripresa.`);
            } else if (cmd.command === 'restart') {
                console.warn('[CLOUD] Restart comandato. Uscita 0...');
                process.exit(0);
            } else if (cmd.command === 'importa') {
                console.log(`[CLOUD] Esecuzione AI Exctractor Worker per URL: ${cmd.args}`);
                void processTelegramImportCommand(profile.id, cmd.args || '');
            } else if (cmd.command === 'funnel' || cmd.command === 'status') {
                const kpi = await getGlobalKPIData();
                let statusText = `📊 **Stato Automa e Funnel (${profile.id})**\n\n`;
                statusText += `**Campagne Attive:** ${kpi.activeCampaigns}\n`;
                statusText += `**Leads Totali:** ${kpi.totalLeads}\n`;
                statusText += `**Accettazioni (7gg):** ${kpi.totalAcceptances7d}\n\n`;
                statusText += `*Dettaglio Stato:*\n`;
                for (const [s, c] of Object.entries(kpi.statusCounts)) {
                    statusText += `- ${s}: ${c}\n`;
                }
                statusText += `\n_Automa in Background in Esecuzione_`;
                await sendTelegramAlert(statusText, 'Report Direzionale', 'info');
            }

            await markTelegramCommandProcessed(cmd.id);
        } catch (e) {
            console.error(`[CLOUD] Errore elaborazione comando per account ${profile.id}:`, e);
        }
    }
}

// ─── Sub-task registry builder ────────────────────────────────────────────────

interface LoopSubTaskBuildContext {
    workflow: string;
    lockOwnerId: string | null;
    lockTtlSeconds: number;
    profilesDiscoveredRef: { count: number };
    accountOverride?: string | null;
}

function buildLoopSubTasks(buildCtx: LoopSubTaskBuildContext): LoopSubTask[] {
    const tasks: LoopSubTask[] = [];

    // 1. Lock heartbeat
    tasks.push({
        name: 'lock_heartbeat',
        shouldRun: () => !!buildCtx.lockOwnerId,
        execute: async () => {
            const owner = buildCtx.lockOwnerId;
            if (owner) {
                await heartbeatWorkflowRunnerLock(owner, buildCtx.lockTtlSeconds);
            }
        },
        onError: 'abort',
    });

    // 2. Cloud commands (Telegram)
    tasks.push({
        name: 'cloud_commands',
        shouldRun: (ctx) => !ctx.dryRun,
        execute: async () => {
            await processCloudCommands();
        },
        onError: 'skip',
    });

    // 3. Control plane sync
    tasks.push({
        name: 'control_plane_sync',
        shouldRun: (ctx) => !ctx.dryRun && config.supabaseControlPlaneEnabled,
        execute: async () => {
            const controlPlane = await runControlPlaneSync();
            if (controlPlane.executed || controlPlane.reason !== 'interval_not_elapsed') {
                console.log('[LOOP] control-plane', {
                    executed: controlPlane.executed,
                    reason: controlPlane.reason,
                    fetched: controlPlane.fetched,
                    applied: controlPlane.applied,
                    hashChanged: controlPlane.hashChanged,
                });
            }
        },
        onError: 'skip',
    });

    // 4. Doctor gate
    tasks.push({
        name: 'doctor_gate',
        shouldRun: () => true,
        execute: async (ctx) => {
            const gate = await evaluateLoopDoctorGate(ctx.dryRun);
            if (!gate.proceed) {
                console.warn(`[LOOP] cycle=${ctx.cycle} skipped reason=${gate.reason}`);
                throw new Error(`doctor_gate:${gate.reason}`);
            }
        },
        onError: 'abort',
    });

    // 5. Session freshness check
    tasks.push({
        name: 'session_freshness',
        shouldRun: (ctx) => !ctx.dryRun,
        execute: async () => {
            for (const account of getRuntimeAccountProfiles()) {
                const freshness = checkSessionFreshness(account.sessionDir);
                if (freshness.needsRotation) {
                    console.warn(
                        `[LOOP] Sessione ${account.id} stale: ${freshness.sessionAgeDays}d (max ${freshness.maxAgeDays}d)`,
                    );
                }
            }
        },
        onError: 'skip',
    });

    // 6. Auto site-check (warmup rimosso — A.1b: ora integrato nel jobRunner)
    tasks.push({
        name: 'auto_site_check',
        shouldRun: async (ctx) => {
            const decision = await evaluateAutoSiteCheckDecision(ctx.dryRun);
            return decision.shouldRun;
        },
        execute: async () => {
            const siteCheckReport = await runSiteCheck({
                limitPerStatus: config.autoSiteCheckLimit,
                autoFix: config.autoSiteCheckFix,
            });
            await setRuntimeFlag(AUTO_SITE_CHECK_LAST_RUN_KEY, new Date().toISOString());
            console.log('[LOOP] auto-site-check', {
                intervalHours: config.autoSiteCheckIntervalHours,
                limitPerStatus: config.autoSiteCheckLimit,
                autoFix: config.autoSiteCheckFix,
                report: siteCheckReport,
            });
        },
        onError: 'skip',
    });

    // 7. SalesNav sync
    tasks.push({
        name: 'salesnav_sync',
        shouldRun: async (ctx) => {
            if (!config.salesNavSyncEnabled) return false;
            if (buildCtx.workflow !== 'all' && buildCtx.workflow !== 'invite') return false;
            const decision = await evaluateSalesNavSyncDecision(ctx.dryRun);
            return decision.shouldRun;
        },
        execute: async (ctx) => {
            const report = await runSalesNavigatorListSync({
                listName: config.salesNavSyncListName,
                listUrl: config.salesNavSyncListUrl || undefined,
                maxPages: config.salesNavSyncMaxPages,
                maxLeadsPerList: config.salesNavSyncLimit,
                dryRun: ctx.dryRun,
                accountId: config.salesNavSyncAccountId || undefined,
            });
            await setRuntimeFlag(SALESNAV_LAST_SYNC_KEY, new Date().toISOString());
            console.log('[LOOP] salesnav-sync', { report });
        },
        onError: 'skip',
    });

    // 8. Auto DB backup (daily, leader only)
    tasks.push({
        name: 'auto_backup',
        shouldRun: async (ctx) => {
            if (ctx.dryRun || !ctx.isLeader) return false;
            const lastRun = await getRuntimeFlag('db_backup.last_run_at');
            return !lastRun || Date.now() - Date.parse(lastRun) > 24 * 60 * 60 * 1000;
        },
        execute: async () => {
            const backupPath = await backupDatabase();
            await setRuntimeFlag('db_backup.last_run_at', new Date().toISOString());
            console.log(`[LOOP] Auto-backup completato: ${backupPath}`);
        },
        onError: 'skip',
    });

    // 8b. SSI scraping (weekly, leader only — alimenta budget dinamico inviti/messaggi)
    tasks.push({
        name: 'ssi_scrape',
        shouldRun: async (ctx) => {
            if (ctx.dryRun || !ctx.isLeader) return false;
            if (!config.ssiDynamicLimitsEnabled) return false;
            const lastRun = await getRuntimeFlag('ssi_scrape.last_run_at');
            return !lastRun || Date.now() - Date.parse(lastRun) > 7 * 24 * 60 * 60 * 1000;
        },
        execute: async () => {
            const { scrapeSsiScore } = await import('../../browser/ssiScraper');
            const ssiAccounts = getRuntimeAccountProfiles();
            const ssiAccount = ssiAccounts[0];
            let session;
            try {
                session = await launchBrowser({ headless: config.headless, forceDesktop: true, sessionDir: ssiAccount?.sessionDir, proxy: ssiAccount?.proxy });
                const result = await scrapeSsiScore(session.page);
                if (result.scraped && result.score !== null) {
                    await setRuntimeFlag(config.ssiStateKey, JSON.stringify({
                        score: result.score,
                        ...result.breakdown,
                        scrapedAt: new Date().toISOString(),
                    }));
                    console.log(`[LOOP] SSI score aggiornato: ${result.score}`);
                } else {
                    console.log(`[LOOP] SSI scrape fallito: ${result.error ?? 'unknown'}`);
                }
                await setRuntimeFlag('ssi_scrape.last_run_at', new Date().toISOString());
            } finally {
                if (session) await closeBrowserSession(session);
            }
        },
        onError: 'skip',
    });

    // 9. Dead Letter Queue (every 6h, leader only)
    tasks.push({
        name: 'dead_letter_queue',
        shouldRun: async (ctx) => {
            if (ctx.dryRun || !ctx.isLeader) return false;
            const lastRun = await getRuntimeFlag('dlq.last_run_at');
            return !lastRun || Date.now() - Date.parse(lastRun) > 6 * 60 * 60 * 1000;
        },
        execute: async () => {
            const result = await runDeadLetterWorker({ batchSize: 200, recycleDelaySec: 43200 });
            await setRuntimeFlag('dlq.last_run_at', new Date().toISOString());
            console.log(`[LOOP] DLQ: processati=${result.processed} riciclati=${result.recycled} archiviati=${result.deadLettered}`);
        },
        onError: 'skip',
    });

    // 10. Privacy cleanup (every 24h, leader only)
    tasks.push({
        name: 'privacy_cleanup',
        shouldRun: async (ctx) => {
            if (ctx.dryRun || !ctx.isLeader) return false;
            const lastRun = await getRuntimeFlag('privacy_cleanup.last_run_at');
            return !lastRun || Date.now() - Date.parse(lastRun) > 24 * 60 * 60 * 1000;
        },
        execute: async () => {
            const { cleanupPrivacyData } = await import('../../core/repositories/system');
            const result = await cleanupPrivacyData(config.retentionDays);
            await setRuntimeFlag('privacy_cleanup.last_run_at', new Date().toISOString());
            console.log(`[LOOP] privacy-cleanup: retentionDays=${config.retentionDays}`, result);
        },
        onError: 'skip',
    });

    // 10b. Daily report automatico (B.1): invia il report giornaliero via Telegram
    // all'ora configurata (config.dailyReportHour), una volta al giorno.
    tasks.push({
        name: 'daily_report',
        shouldRun: async (ctx) => {
            if (ctx.dryRun || !ctx.isLeader) return false;
            if (!config.dailyReportAutoEnabled) return false;
            const currentHour = getHourInTimezone(new Date(), config.timezone);
            if (currentHour < config.dailyReportHour) return false;
            const lastSent = await getRuntimeFlag('daily_report.last_sent_date');
            return lastSent !== ctx.localDate;
        },
        execute: async (ctx) => {
            const { generateAndSendDailyReport } = await import('../../telemetry/dailyReporter');
            const sent = await generateAndSendDailyReport(ctx.localDate);
            if (sent) {
                await setRuntimeFlag('daily_report.last_sent_date', ctx.localDate);
                console.log(`[LOOP] daily-report inviato per ${ctx.localDate}`);
            }
        },
        onError: 'skip',
    });

    // 11. Company enrichment
    tasks.push({
        name: 'company_enrichment',
        shouldRun: () =>
            config.companyEnrichmentEnabled &&
            (buildCtx.workflow === 'all' || buildCtx.workflow === 'invite'),
        execute: async (ctx) => {
            const enrichment = await runCompanyEnrichmentBatch({
                limit: config.companyEnrichmentBatch,
                maxProfilesPerCompany: config.companyEnrichmentMaxProfilesPerCompany,
                dryRun: ctx.dryRun,
            });
            buildCtx.profilesDiscoveredRef.count += enrichment.createdLeads;
            console.log('[LOOP] enrichment', enrichment);
        },
        onError: 'skip',
    });

    // 11. Ramp-up
    tasks.push({
        name: 'ramp_up',
        shouldRun: (ctx) => !ctx.dryRun && config.rampUpEnabled,
        execute: async () => {
            const report = await runRampUpWorker();
            console.log('[LOOP] ramp-up', report);
        },
        onError: 'skip',
    });

    // 12. Selector learner (once daily)
    tasks.push({
        name: 'selector_learner',
        shouldRun: async (ctx) => {
            if (ctx.dryRun) return false;
            const lastRun = await getRuntimeFlag(SELECTOR_LEARNER_LAST_RUN_KEY);
            return lastRun !== ctx.localDate;
        },
        execute: async (ctx) => {
            const report = await runSelectorLearner({ limit: 100, minSuccess: 3 });
            await setRuntimeFlag(SELECTOR_LEARNER_LAST_RUN_KEY, ctx.localDate);
            console.log('[LOOP] selector-learner', report);
        },
        onError: 'skip',
    });

    // 13. Campaign dispatch
    tasks.push({
        name: 'campaign_dispatch',
        shouldRun: (ctx) => !ctx.dryRun,
        execute: async () => {
            const steps = await dispatchReadyCampaignSteps();
            if (steps > 0) {
                console.log(`[LOOP] campagne dispatch: ${steps} step maturati inseriti in coda.`);
            }
        },
        onError: 'skip',
    });

    // 13c. Message pre-build (offline AI batch — riduce tempo browser di ~2-5s/messaggio)
    tasks.push({
        name: 'message_prebuild',
        shouldRun: (ctx) => {
            if (ctx.dryRun) return false;
            const w = buildCtx.workflow;
            return w === 'all' || w === 'message';
        },
        execute: async () => {
            const { runMessagePrebuild } = await import('../../workers/messagePrebuildWorker');
            const report = await runMessagePrebuild(10);
            if (report.generated > 0 || report.expired > 0) {
                console.log('[LOOP] message-prebuild', report);
            }
        },
        onError: 'skip',
    });

    // 13b. Session warmup — RIMOSSO (A.1a): il warmup è ora integrato nel jobRunner
    // (src/core/jobRunner.ts) nella STESSA sessione browser che processerà i job.
    // Prima apriva un browser separato per il warmup, poi lo chiudeva, poi il jobRunner
    // ne apriva un altro — LinkedIn vedeva 2 sessioni separate. Ora è una sessione unica.

    // 13d. C14/R03: Inbox check PRIMA del workflow — rileva risposte lead PRIMA di fare follow-up.
    // Senza questo step, il follow-up worker potrebbe inviare a lead che hanno già risposto
    // perché l'inboxWorker non girava automaticamente (C09). Ora gira ad ogni ciclo.
    tasks.push({
        name: 'inbox_check',
        shouldRun: (ctx) => {
            if (ctx.dryRun) return false;
            const w = buildCtx.workflow;
            return w === 'all' || w === 'message';
        },
        execute: async () => {
            const { processInboxJob } = await import('../../workers/inboxWorker');
            const accounts = getRuntimeAccountProfiles();
            for (const account of accounts) {
                let inboxSession;
                try {
                    inboxSession = await launchBrowser({
                        sessionDir: account.sessionDir,
                        proxy: account.proxy,
                        forceDesktop: true,
                    });
                    const inboxContext: import('../../workers/context').WorkerContext = {
                        session: inboxSession,
                        dryRun: false,
                        localDate: getLocalDateString(),
                        accountId: account.id,
                    };
                    const result = await processInboxJob({ accountId: account.id }, inboxContext);
                    if (result.processedCount > 0) {
                        console.log(`[LOOP] inbox-check: ${result.processedCount} conversazioni processate (account: ${account.id})`);
                    }
                } catch (inboxErr) {
                    console.warn(`[LOOP] inbox-check fallito (account: ${account.id}):`, inboxErr instanceof Error ? inboxErr.message : inboxErr);
                } finally {
                    if (inboxSession) await closeBrowserSession(inboxSession);
                }
            }
        },
        onError: 'skip',
    });

    // 14. Main workflow
    tasks.push({
        name: 'workflow',
        shouldRun: () => true,
        execute: async (ctx) => {
            const cycleCorrelationId = resolveCorrelationId(`loop-${ctx.workflow}-${ctx.cycle}-${randomUUID()}`);
            await runWithCorrelationId(cycleCorrelationId, async () => {
                await runWorkflow({ workflow: ctx.workflow as import('../../core/scheduler').WorkflowSelection, dryRun: ctx.dryRun });
            });
        },
        onError: 'abort',
    });

    // 15. Random activity
    tasks.push({
        name: 'random_activity',
        shouldRun: (ctx) =>
            !ctx.dryRun &&
            pluginRegistry.count === 0 &&
            config.randomActivityEnabled &&
            Math.random() <= config.randomActivityProbability,
        execute: async (ctx) => {
            const report = await runRandomLinkedinActivity({
                accountId: buildCtx.accountOverride || config.salesNavSyncAccountId || undefined,
                maxActions: config.randomActivityMaxActions,
                dryRun: ctx.dryRun,
            });
            console.log('[LOOP] random-activity', report);
        },
        onError: 'skip',
    });

    // 16. Plugin idle
    tasks.push({
        name: 'plugin_idle',
        shouldRun: (ctx) => !ctx.dryRun && pluginRegistry.count > 0,
        execute: async (ctx) => {
            await pluginRegistry.fireIdle({
                cycle: ctx.cycle,
                workflow: ctx.workflow,
                localDate: ctx.localDate,
            });
        },
        onError: 'skip',
    });

    // 17+. Plugin-contributed sub-tasks
    const pluginTasks = pluginRegistry.collectLoopSubTasks();
    for (const pt of pluginTasks) {
        tasks.push({
            name: pt.name,
            shouldRun: (ctx) => pt.shouldRun({ cycle: ctx.cycle, workflow: ctx.workflow, localDate: ctx.localDate }),
            execute: (ctx) => pt.execute({ cycle: ctx.cycle, workflow: ctx.workflow, localDate: ctx.localDate }),
            onError: pt.onError,
        });
    }

    return tasks;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runLoopCommand(args: string[]): Promise<void> {
    // Reset lock key al valore default per evitare stato residuo da chiamate precedenti
    _workflowRunnerLockKey = 'workflow.runner';

    const workflow = parseWorkflow(getWorkflowValue(args));
    const positional = getPositionalArgs(args);
    const workflowTokens = new Set(['invite', 'check', 'message', 'all']);
    const numericPositionals = positional.filter((value) => /^\d+$/.test(value));
    const intervalMsRaw = getOptionValue(args, '--interval-ms');
    const intervalSecRaw = getOptionValue(args, '--interval-sec');
    const cyclesRaw = getOptionValue(args, '--cycles') ?? numericPositionals[1];
    const dryRun =
        hasOption(args, '--dry-run') ||
        positional.some((value) => value.toLowerCase() === 'dry' || value.toLowerCase() === 'dry-run');

    const accountOverride = getOptionValue(args, '--account') || getOptionValue(args, '-a');
    let isLeader = true;
    if (accountOverride) {
        setOverrideAccountId(accountOverride);
        _workflowRunnerLockKey = `workflow.runner:${accountOverride}`;
        const defaultProfileId = config.accountProfiles[0]?.id || 'default';
        isLeader = accountOverride === defaultProfileId;
        console.log(`[LOOP] Account override: ${accountOverride} (Leader: ${isLeader})`);
    }

    let intervalMs = config.workflowLoopIntervalMs;
    if (intervalMsRaw) {
        intervalMs = Math.max(10_000, parseIntStrict(intervalMsRaw, '--interval-ms'));
    } else if (intervalSecRaw) {
        intervalMs = Math.max(10, parseIntStrict(intervalSecRaw, '--interval-sec')) * 1000;
    } else {
        const numericPositional = positional.find((value) => !workflowTokens.has(value) && /^\d+$/.test(value));
        if (numericPositional) {
            intervalMs = Math.max(10, parseIntStrict(numericPositional, 'intervalSec')) * 1000;
        }
    }

    const SAFE_MIN_INTERVAL_MS = 300_000; // 5 minuti — anti-ban: cicli più rapidi sono rischiosi
    if (!dryRun && intervalMs < SAFE_MIN_INTERVAL_MS) {
        console.warn(`[LOOP] Intervallo ${Math.floor(intervalMs / 1000)}s troppo breve — alzato a ${SAFE_MIN_INTERVAL_MS / 1000}s per sicurezza anti-ban`);
        intervalMs = SAFE_MIN_INTERVAL_MS;
    }

    const maxCycles = cyclesRaw ? Math.max(1, parseIntStrict(cyclesRaw, '--cycles')) : null;
    console.log(
        `[LOOP] start workflow = ${workflow} dryRun = ${dryRun} intervalMs = ${intervalMs} cycles = ${maxCycles ?? 'infinite'} `,
    );

    if (!dryRun) {
        await startTelegramListener().catch((e) => console.error('[TELEGRAM] Errore listener background', e));
        startConfigWatcher();
        // CC-24: Quando un cap diminuisce via hot-reload, cancella job in coda in eccesso
        onConfigReload((changedKeys) => { void (async () => {
            if (changedKeys.includes('hardInviteCap') || changedKeys.includes('hardMsgCap')) {
                try {
                    const { cancelExcessQueuedJobs } = await import('../../core/repositories/jobs');
                    const { config: liveConfig } = await import('../../config');
                    if (changedKeys.includes('hardInviteCap')) {
                        const cancelled = await cancelExcessQueuedJobs('INVITE', liveConfig.hardInviteCap);
                        if (cancelled > 0) console.log(`[CONFIG] Cancelled ${cancelled} excess INVITE jobs (new cap: ${liveConfig.hardInviteCap})`);
                    }
                    if (changedKeys.includes('hardMsgCap')) {
                        const cancelled = await cancelExcessQueuedJobs('MESSAGE', liveConfig.hardMsgCap);
                        if (cancelled > 0) console.log(`[CONFIG] Cancelled ${cancelled} excess MESSAGE jobs (new cap: ${liveConfig.hardMsgCap})`);
                    }
                } catch (e) {
                    console.warn('[CONFIG] Failed to cancel excess jobs after cap decrease:', e instanceof Error ? e.message : e);
                }
            }
        })(); });
    }

    const lockTtlSeconds = computeWorkflowLockTtlSeconds(getEffectiveLoopIntervalMs(intervalMs));
    const lockOwnerId = dryRun
        ? null
        : await acquireWorkflowRunnerLock('run-loop', lockTtlSeconds, {
            workflow,
            dryRun,
            intervalMs,
            startedAt: new Date().toISOString(),
        });

    // ── Login jitter: delay random 0-30 min prima del primo ciclo ──────────
    // Evita pattern "login alle 09:00:00 ogni giorno" — un umano varia.
    if (!dryRun) {
        const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
        if (jitterMs > 60_000) {
            const jitterMin = (jitterMs / 60_000).toFixed(1);
            console.log(`[LOOP] Login jitter: attesa ${jitterMin} minuti prima del primo ciclo`);
            await sleepWithLockHeartbeat(jitterMs, lockOwnerId ?? '', lockTtlSeconds);
        }
    }

    // B.3: Alert Telegram avvio bot
    if (!dryRun) {
        const localTime = new Intl.DateTimeFormat('it-IT', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date());
        await sendTelegramAlert(
            `Bot avviato.\nWorkflow: ${workflow}\nOra: ${localTime} (${config.timezone})`,
            'Bot Avviato',
            'info',
        ).catch(() => null);
    }

    let cycle = 0;
    try {
        while (true) {
            cycle += 1;
            const started = new Date().toISOString();
            console.log(`[LOOP] cycle = ${cycle} started_at = ${started} `);

            // ── Working Hours Guard (A.3) ──────────────────────────────────────
            // Se fuori orario lavorativo (config HOUR_START/HOUR_END + timezone),
            // skip l'intero ciclo. Previene attività LinkedIn di notte quando PM2
            // riavvia il bot dopo crash/OOM. Usa config.timezone (non ora locale server).
            if (!dryRun && !isWorkingHour()) {
                console.log(`[LOOP] outside_working_hours — skipping cycle (timezone: ${config.timezone})`);
                // Sleep breve (5 min) per ricontrollare rapidamente quando l'orario rientra
                await sleepWithLockHeartbeat(5 * 60 * 1000, lockOwnerId ?? '', lockTtlSeconds);
                continue;
            }

            let runId: number | null = null;
            let profilesDiscoveredThisRun = 0;
            let runStatus: RunStatus = 'RUNNING';
            const localDate = getLocalDateString();
            const preStats = await getDailyStatsSnapshot(localDate);
            if (!dryRun) {
                runId = await startCampaignRun();
            }

            const profilesDiscoveredRef = { count: 0 };
            const subTasks = buildLoopSubTasks({
                workflow,
                lockOwnerId,
                lockTtlSeconds,
                profilesDiscoveredRef,
                accountOverride,
            });

            try {
                const cycleCtx: LoopCycleContext = { cycle, localDate, workflow, dryRun, isLeader };
                const cycleResult = await runLoopCycle(subTasks, cycleCtx);
                profilesDiscoveredThisRun = profilesDiscoveredRef.count;

                if (!cycleResult.aborted) {
                    runStatus = 'SUCCESS';
                    console.log(`[LOOP] cycle=${cycle} completed tasks=${cycleResult.tasksRun.length} skipped=${cycleResult.tasksSkipped.length} errors=${cycleResult.tasksErrored.length}`);
                } else {
                    console.warn(`[LOOP] cycle=${cycle} aborted at task: ${cycleResult.tasksErrored[cycleResult.tasksErrored.length - 1]?.name}`);
                }
            } catch (error) {
                console.error(`[LOOP] cycle = ${cycle} failed`, error);
                runStatus = 'FAILED';
            } finally {
                if (runId) {
                    const postStats = await getDailyStatsSnapshot(localDate);
                    const invitesDiff = Math.max(0, postStats.invitesSent - preStats.invitesSent);
                    const messagesDiff = Math.max(0, postStats.messagesSent - preStats.messagesSent);
                    const errorsDiff = Math.max(0, postStats.runErrors - preStats.runErrors);

                    await finishCampaignRun(runId, runStatus, {
                        discovered: profilesDiscoveredThisRun,
                        invites: invitesDiff,
                        messages: messagesDiff,
                        errors: errorsDiff,
                    });
                    console.log(`[LOOP] Campaign run ${runId} completed with status ${runStatus}`);
                }
            }

            if (maxCycles !== null && cycle >= maxCycles) {
                console.log(`[LOOP] completed ${cycle} cycle(s).`);
                break;
            }

            // D.1: Jitter ±20% sull'intervallo — un umano non lavora a intervalli precisi
            const baseIntervalMs = getEffectiveLoopIntervalMs(intervalMs);
            const effectiveIntervalMs = Math.floor(baseIntervalMs * (0.8 + Math.random() * 0.4));
            console.log(`[LOOP] waiting ${Math.floor(effectiveIntervalMs / 1000)}s before next cycle...`);
            if (lockOwnerId) {
                await sleepWithLockHeartbeat(effectiveIntervalMs, lockOwnerId, lockTtlSeconds);
            } else {
                await sleep(effectiveIntervalMs);
            }
        }
    } finally {
        stopConfigWatcher();
        // B.3: Alert Telegram spegnimento bot
        if (!dryRun) {
            const stopTime = new Intl.DateTimeFormat('it-IT', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date());
            await sendTelegramAlert(
                `Bot spento dopo ${cycle} cicli.\nOra: ${stopTime} (${config.timezone})`,
                'Bot Spento',
                'info',
            ).catch(() => null);
        }
        if (lockOwnerId) {
            await releaseWorkflowRunnerLock(lockOwnerId);
        }
        console.log(`[LOOP] Sessione terminata dopo ${cycle} cicli.`);
    }
}

export async function runAutopilotCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const intervalRaw = getOptionValue(args, '--interval-sec') ?? positional[0];
    const cyclesRaw = getOptionValue(args, '--cycles') ?? positional[1];
    const intervalArg = intervalRaw ?? String(Math.floor(config.workflowLoopIntervalMs / 1000));
    const forwarded = ['all', intervalArg];
    if (cyclesRaw && /^\d+$/.test(cyclesRaw)) {
        forwarded.push('--cycles', cyclesRaw);
    }
    if (hasOption(args, '--dry-run') || positional.includes('dry') || positional.includes('dry-run')) {
        forwarded.push('--dry-run');
    }
    await runLoopCommand(forwarded);
}

export async function runWorkflowCommand(
    workflow: import('../../core/scheduler').WorkflowSelection,
    dryRun: boolean,
): Promise<void> {
    const runCorrelationId = resolveCorrelationId(`run-${workflow}-${Date.now()}-${randomUUID()}`);
    if (dryRun) {
        await runWithCorrelationId(runCorrelationId, async () => {
            await runWorkflow({ workflow, dryRun: true });
        });
        return;
    }

    const lockTtlSeconds = Math.max(300, config.jobStuckMinutes * 60 + 300);
    const lockOwnerId = await acquireWorkflowRunnerLock('run', lockTtlSeconds, {
        workflow,
        dryRun: false,
        startedAt: new Date().toISOString(),
    });
    try {
        await runWithCorrelationId(runCorrelationId, async () => {
            await runWorkflow({ workflow, dryRun: false });
        });
        await heartbeatWorkflowRunnerLock(lockOwnerId, lockTtlSeconds);
    } finally {
        await releaseWorkflowRunnerLock(lockOwnerId);
    }
}

export { recoverStuckJobs };
