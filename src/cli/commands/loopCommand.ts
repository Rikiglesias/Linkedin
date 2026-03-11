/**
 * loopCommand.ts — Comando run-loop e autopilot
 *
 * Gestisce il ciclo principale di automazione con lock distribuito,
 * site-check automatico, salesnav sync, enrichment, dead letter worker.
 */

import { randomUUID } from 'crypto';
import { config, getEffectiveLoopIntervalMs, getLocalDateString } from '../../config';
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
import { warmupSession } from '../../core/sessionWarmer';
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
import { recordSessionPattern } from '../../risk/sessionMemory';
import { startConfigWatcher, stopConfigWatcher } from '../../config/hotReload';

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

    // 6. Auto site-check + warmup session
    tasks.push({
        name: 'auto_site_check',
        shouldRun: async (ctx) => {
            const decision = await evaluateAutoSiteCheckDecision(ctx.dryRun);
            return decision.shouldRun;
        },
        execute: async (ctx) => {
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

            if (!ctx.dryRun) {
                try {
                    const warmupSessionInstance = await launchBrowser({ headless: config.headless, forceDesktop: true });
                    try {
                        await warmupSession(warmupSessionInstance.page);
                    } finally {
                        await closeBrowserSession(warmupSessionInstance);
                    }
                } catch (e) {
                    console.log('[LOOP] Errore Session Warmer (non fatale):', e);
                }
            }
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

    // 13b. Session warmup (pre-workflow) — anti-ban: simula attività organica
    // PRIMA di qualsiasi azione operativa. Un umano prima scorre il feed,
    // controlla notifiche, ecc. Senza warmup il bot sembra bot.
    tasks.push({
        name: 'session_warmup',
        shouldRun: (ctx) => {
            if (ctx.dryRun) return false;
            const w = buildCtx.workflow;
            return w === 'all' || w === 'invite' || w === 'message';
        },
        execute: async () => {
            const { getSessionWindow } = await import('../../core/sessionWarmer');
            const window = getSessionWindow();
            if (window === 'gap') return;
            try {
                const session = await launchBrowser({ headless: config.headless, forceDesktop: true });
                try {
                    await warmupSession(session.page);
                } finally {
                    await closeBrowserSession(session);
                }
            } catch (e) {
                console.log('[LOOP] Session warmup non fatale:', e);
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
                accountId: config.salesNavSyncAccountId || undefined,
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

    const maxCycles = cyclesRaw ? Math.max(1, parseIntStrict(cyclesRaw, '--cycles')) : null;
    console.log(
        `[LOOP] start workflow = ${workflow} dryRun = ${dryRun} intervalMs = ${intervalMs} cycles = ${maxCycles ?? 'infinite'} `,
    );

    if (!dryRun) {
        await startTelegramListener().catch((e) => console.error('[TELEGRAM] Errore listener background', e));
        startConfigWatcher();
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

    let cycle = 0;
    try {
        while (true) {
            cycle += 1;
            const started = new Date().toISOString();
            console.log(`[LOOP] cycle = ${cycle} started_at = ${started} `);

            // ── Maintenance window skip (03:00-06:00 locale) ──────────────────
            // LinkedIn fa maintenance notturno e deploy infrastrutturali. Durante
            // questi periodi i selettori possono cambiare e le API sono instabili.
            const currentHour = new Date().getHours();
            if (currentHour >= 3 && currentHour < 6) {
                console.log(`[LOOP] maintenance_window_skip hour=${currentHour} — skipping cycle`);
                await sleepWithLockHeartbeat(15 * 60 * 1000, lockOwnerId ?? '', lockTtlSeconds);
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

                    // Record session pattern for cross-session memory
                    const currentHour = new Date().getHours();
                    const accountId = accountOverride || config.accountProfiles[0]?.id || 'default';
                    await recordSessionPattern(accountId, localDate, {
                        loginHour: cycle === 1 ? currentHour : undefined,
                        logoutHour: currentHour,
                        totalActions: invitesDiff + messagesDiff,
                        inviteCount: invitesDiff,
                        messageCount: messagesDiff,
                        checkCount: 0,
                        challenges: postStats.challengesCount - preStats.challengesCount,
                    }).catch((e) => console.warn('[LOOP] session pattern record failed:', e));
                }
            }

            if (maxCycles !== null && cycle >= maxCycles) {
                console.log(`[LOOP] completed ${cycle} cycle(s).`);
                break;
            }

            const effectiveIntervalMs = getEffectiveLoopIntervalMs(intervalMs);
            console.log(`[LOOP] waiting ${Math.floor(effectiveIntervalMs / 1000)}s before next cycle...`);
            if (lockOwnerId) {
                await sleepWithLockHeartbeat(effectiveIntervalMs, lockOwnerId, lockTtlSeconds);
            } else {
                await sleep(effectiveIntervalMs);
            }
        }
    } finally {
        stopConfigWatcher();
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
