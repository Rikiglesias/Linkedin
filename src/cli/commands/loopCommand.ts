/**
 * loopCommand.ts — Comando run-loop e autopilot
 *
 * Gestisce il ciclo principale di automazione con lock distribuito,
 * site-check automatico, salesnav sync, enrichment, dead letter worker.
 */

import { randomUUID } from 'crypto';
import { config, getLocalDateString } from '../../config';
import { launchBrowser, closeBrowser as closeBrowserSession } from '../../browser';
import {
    acquireRuntimeLock,
    getDailyStatsSnapshot,
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
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import { warmupSession } from '../../core/sessionWarmer';
import { runSiteCheck } from '../../core/audit';
import { runCompanyEnrichmentBatch } from '../../core/companyEnrichment';
import { runRandomLinkedinActivity } from '../../workers/randomActivityWorker';
import { runDeadLetterWorker } from '../../workers/deadLetterWorker';
import { backupDatabase } from '../../db';
import { startTelegramListener } from '../../cloud/telegramListener';
import { markTelegramCommandProcessed, pollPendingTelegramCommand } from '../../cloud/supabaseDataClient';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { RunStatus } from '../../types/domain';
import { getOptionValue, hasOption, parseIntStrict, parseWorkflow, getWorkflowValue, getPositionalArgs } from '../cliParser';

// ─── Costanti lock ────────────────────────────────────────────────────────────

const WORKFLOW_RUNNER_LOCK_KEY = 'workflow.runner';
const WORKFLOW_RUNNER_MIN_TTL_SECONDS = 120;
const WORKFLOW_RUNNER_HEARTBEAT_MS = 30_000;
const AUTO_SITE_CHECK_LAST_RUN_KEY = 'site_check.last_run_at';
const SALESNAV_LAST_SYNC_KEY = 'salesnav.last_sync_at';

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLockOwnerId(command: string): string {
    const suffix = randomUUID().split('-')[0];
    return `${command}:${process.pid}:${suffix} `;
}

function computeWorkflowLockTtlSeconds(intervalMs: number): number {
    return Math.max(WORKFLOW_RUNNER_MIN_TTL_SECONDS, Math.ceil(intervalMs / 1000) + 120);
}

async function acquireWorkflowRunnerLock(command: string, ttlSeconds: number, metadata: Record<string, unknown>): Promise<string> {
    const ownerId = createLockOwnerId(command);
    const result = await acquireRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY, ownerId, ttlSeconds, metadata);
    if (!result.acquired) {
        const holder = result.lock;
        throw new Error(
            `[LOCK] Runner già attivo.owner = ${holder?.owner_id ?? 'unknown'} heartbeat = ${holder?.heartbeat_at ?? 'n/a'} expires = ${holder?.expires_at ?? 'n/a'} `
        );
    }
    console.log(`[LOCK] acquired key = ${WORKFLOW_RUNNER_LOCK_KEY} owner = ${ownerId} ttl = ${ttlSeconds} s`);
    return ownerId;
}

async function heartbeatWorkflowRunnerLock(ownerId: string, ttlSeconds: number): Promise<void> {
    const ok = await heartbeatRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY, ownerId, ttlSeconds);
    if (!ok) {
        throw new Error('[LOCK] Runtime lock perso durante l\'esecuzione.');
    }
}

async function releaseWorkflowRunnerLock(ownerId: string): Promise<void> {
    const released = await releaseRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY, ownerId);
    console.log(`[LOCK] released key = ${WORKFLOW_RUNNER_LOCK_KEY} owner = ${ownerId} released = ${released} `);
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

            console.log(`[CLOUD] Comando ricevuto: ${cmd.command} args: ${cmd.args || 'nessuno'} (account: ${profile.id})`);

            if (cmd.command === 'pausa' || cmd.command === 'pause') {
                const minutes = cmd.args && /^[0-9]+$/.test(cmd.args) ? parseInt(cmd.args, 10) : null;
                await setAutomationPause(minutes || null, 'TELEGRAM_COMMAND');
                console.log(`[CLOUD] Automazione globale in pausa ${minutes ? 'per ' + minutes + ' min' : 'indefinitamente'}.`);
            } else if (cmd.command === 'riprendi' || cmd.command === 'resume') {
                await clearPauseState();
                console.log(`[CLOUD] Automazione globale ripresa.`);
            } else if (cmd.command === 'restart') {
                console.warn('[CLOUD] Restart comandato. Uscita 0...');
                process.exit(0);
            }

            await markTelegramCommandProcessed(cmd.id);
        } catch (e) {
            console.error(`[CLOUD] Errore elaborazione comando per account ${profile.id}:`, e);
        }
    }
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
    const dryRun = hasOption(args, '--dry-run') || positional.some((value) => value.toLowerCase() === 'dry' || value.toLowerCase() === 'dry-run');

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
    console.log(`[LOOP] start workflow = ${workflow} dryRun = ${dryRun} intervalMs = ${intervalMs} cycles = ${maxCycles ?? 'infinite'} `);

    if (!dryRun) {
        await startTelegramListener().catch(e => console.error('[TELEGRAM] Errore listener background', e));
    }

    const lockTtlSeconds = computeWorkflowLockTtlSeconds(intervalMs);
    const lockOwnerId = dryRun
        ? null
        : await acquireWorkflowRunnerLock('run-loop', lockTtlSeconds, {
            workflow,
            dryRun,
            intervalMs,
            startedAt: new Date().toISOString(),
        });

    try {
        let cycle = 0;
        while (true) {
            cycle += 1;
            const started = new Date().toISOString();
            console.log(`[LOOP] cycle = ${cycle} started_at = ${started} `);

            let runId: number | null = null;
            let profilesDiscoveredThisRun = 0;
            let runStatus: RunStatus = 'RUNNING';
            const localDate = getLocalDateString();
            const preStats = await getDailyStatsSnapshot(localDate);
            if (!dryRun) {
                runId = await startCampaignRun();
            }

            try {
                if (lockOwnerId) {
                    await heartbeatWorkflowRunnerLock(lockOwnerId, lockTtlSeconds);
                }

                if (!dryRun) {
                    await processCloudCommands();
                }

                const doctorGate = await evaluateLoopDoctorGate(dryRun);
                if (!doctorGate.proceed) {
                    console.warn(`[LOOP] cycle = ${cycle} skipped reason = ${doctorGate.reason} `);
                } else {
                    const autoSiteCheck = await evaluateAutoSiteCheckDecision(dryRun);
                    if (autoSiteCheck.shouldRun) {
                        const siteCheckReport = await runSiteCheck({
                            limitPerStatus: config.autoSiteCheckLimit,
                            autoFix: config.autoSiteCheckFix,
                        });
                        await setRuntimeFlag(AUTO_SITE_CHECK_LAST_RUN_KEY, new Date().toISOString());
                        console.log('[LOOP] auto-site-check', {
                            reason: autoSiteCheck.reason,
                            intervalHours: config.autoSiteCheckIntervalHours,
                            limitPerStatus: config.autoSiteCheckLimit,
                            staleDays: config.siteCheckStaleDays,
                            autoFix: config.autoSiteCheckFix,
                            report: siteCheckReport,
                        });

                        if (!dryRun) {
                            try {
                                const warmupSessionInstance = await launchBrowser({ headless: config.headless });
                                try {
                                    await warmupSession(warmupSessionInstance.page);
                                } finally {
                                    await closeBrowserSession(warmupSessionInstance);
                                }
                            } catch (e) {
                                console.log('[LOOP] Errore nel Session Warmer, ignoro (non fatale):', e);
                            }
                        }
                    } else {
                        console.log('[LOOP] auto-site-check skipped', autoSiteCheck);
                    }

                    if (config.salesNavSyncEnabled && (workflow === 'all' || workflow === 'invite')) {
                        const salesNavDecision = await evaluateSalesNavSyncDecision(dryRun);
                        if (salesNavDecision.shouldRun) {
                            const salesNavSyncReport = await runSalesNavigatorListSync({
                                listName: config.salesNavSyncListName,
                                listUrl: config.salesNavSyncListUrl || undefined,
                                maxPages: config.salesNavSyncMaxPages,
                                maxLeadsPerList: config.salesNavSyncLimit,
                                dryRun,
                                accountId: config.salesNavSyncAccountId || undefined,
                            });
                            await setRuntimeFlag(SALESNAV_LAST_SYNC_KEY, new Date().toISOString());
                            console.log('[LOOP] salesnav-sync', {
                                reason: salesNavDecision.reason,
                                intervalHours: config.salesNavSyncIntervalHours,
                                limitPerList: config.salesNavSyncLimit,
                                report: salesNavSyncReport,
                            });
                        } else {
                            console.log('[LOOP] salesnav-sync skipped', salesNavDecision);
                        }
                    }

                    // Auto-Backup Giornaliero SQLite
                    if (!dryRun) {
                        const AUTO_BACKUP_LAST_RUN_KEY = 'db_backup.last_run_at';
                        const backupLastRunRaw = await getRuntimeFlag(AUTO_BACKUP_LAST_RUN_KEY);
                        const shouldRunBackup = !backupLastRunRaw || (Date.now() - Date.parse(backupLastRunRaw)) > 24 * 60 * 60 * 1000;
                        if (shouldRunBackup) {
                            try {
                                const backupPath = await backupDatabase();
                                await setRuntimeFlag(AUTO_BACKUP_LAST_RUN_KEY, new Date().toISOString());
                                console.log(`[LOOP] Auto - backup giornaliero completato: ${backupPath} `);
                            } catch (e) {
                                console.error(`[LOOP] Auto - backup fallito`, e);
                            }
                        }
                    }

                    // Dead Letter Queue Periodico
                    if (!dryRun) {
                        const DLQ_LAST_RUN_KEY = 'dlq.last_run_at';
                        const dlqLastRunRaw = await getRuntimeFlag(DLQ_LAST_RUN_KEY);
                        const shouldRunDlq = !dlqLastRunRaw || (Date.now() - Date.parse(dlqLastRunRaw)) > 6 * 60 * 60 * 1000;
                        if (shouldRunDlq) {
                            try {
                                const dlqResult = await runDeadLetterWorker({ batchSize: 200, recycleDelaySec: 43200 });
                                await setRuntimeFlag(DLQ_LAST_RUN_KEY, new Date().toISOString());
                                console.log(`[LOOP] Dead Letter Worker completato. Processati: ${dlqResult.processed}, Riciclati: ${dlqResult.recycled}, Archiviati: ${dlqResult.deadLettered}`);
                            } catch (e) {
                                console.error('[LOOP] Dead Letter Worker fallito', e);
                            }
                        }
                    }

                    if (config.companyEnrichmentEnabled && (workflow === 'all' || workflow === 'invite')) {
                        const enrichment = await runCompanyEnrichmentBatch({
                            limit: config.companyEnrichmentBatch,
                            maxProfilesPerCompany: config.companyEnrichmentMaxProfilesPerCompany,
                            dryRun,
                        });
                        profilesDiscoveredThisRun += enrichment.createdLeads;
                        console.log('[LOOP] enrichment', enrichment);
                    }
                    await runWorkflow({ workflow, dryRun });

                    if (!dryRun && config.randomActivityEnabled && Math.random() <= config.randomActivityProbability) {
                        const randomActivityReport = await runRandomLinkedinActivity({
                            accountId: config.salesNavSyncAccountId || undefined,
                            maxActions: config.randomActivityMaxActions,
                            dryRun,
                        });
                        console.log('[LOOP] random-activity', randomActivityReport);
                    }

                    runStatus = 'SUCCESS';
                    console.log(`[LOOP] cycle = ${cycle} completed`);
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
                        errors: errorsDiff
                    });
                    console.log(`[LOOP] Campaign run ${runId} completed with status ${runStatus}`);
                }
            }

            if (maxCycles !== null && cycle >= maxCycles) {
                console.log(`[LOOP] completed ${cycle} cycle(s).`);
                break;
            }

            console.log(`[LOOP] waiting ${Math.floor(intervalMs / 1000)}s before next cycle...`);
            if (lockOwnerId) {
                await sleepWithLockHeartbeat(intervalMs, lockOwnerId, lockTtlSeconds);
            } else {
                await sleep(intervalMs);
            }
        }
    } finally {
        if (lockOwnerId) {
            await releaseWorkflowRunnerLock(lockOwnerId);
        }
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

export async function runWorkflowCommand(workflow: import('../../core/scheduler').WorkflowSelection, dryRun: boolean): Promise<void> {
    if (dryRun) {
        await runWorkflow({ workflow, dryRun: true });
        return;
    }

    const lockTtlSeconds = Math.max(300, config.jobStuckMinutes * 60 + 300);
    const lockOwnerId = await acquireWorkflowRunnerLock('run', lockTtlSeconds, {
        workflow,
        dryRun: false,
        startedAt: new Date().toISOString(),
    });
    try {
        await runWorkflow({ workflow, dryRun: false });
        await heartbeatWorkflowRunnerLock(lockOwnerId, lockTtlSeconds);
    } finally {
        await releaseWorkflowRunnerLock(lockOwnerId);
    }
}

export { recoverStuckJobs };
