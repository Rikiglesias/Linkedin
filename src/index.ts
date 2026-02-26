import { closeDatabase, initDatabase, backupDatabase } from './db';
import { config, getLocalDateString } from './config';
import { checkLogin, closeBrowser as closeBrowserSession, detectChallenge, humanDelay, isLoggedIn, launchBrowser } from './browser';
import { randomUUID } from 'crypto';
import { importLeadsFromCSV } from './csvImporter';
import { buildFunnelReport, runSiteCheck } from './core/audit';
import { runCompanyEnrichmentBatch } from './core/companyEnrichment';
import { runWorkflow } from './core/orchestrator';
import { runDoctor } from './core/doctor';
import { runSalesNavigatorListSync } from './core/salesNavigatorSync';
import { reconcileLeadStatus } from './core/leadStateService';
import { warmupSession } from './core/sessionWarmer';
import {
    acquireRuntimeLock,
    cleanupPrivacyData,
    countCompanyTargets,
    getAutomationPauseState,
    getDailyStatsSnapshot,
    getLeadById,
    getJobStatusCounts,
    getSalesNavListByName,
    getRuntimeLock,
    getRuntimeFlag,
    getLeadsWithSalesNavigatorUrls,
    heartbeatRuntimeLock,
    linkLeadToSalesNavList,
    listCompanyTargets,
    listLeadCampaignConfigs,
    listOpenIncidents,
    listSalesNavLists,
    releaseRuntimeLock,
    recoverStuckJobs,
    resolveIncident,
    clearAutomationPause as clearPauseState,
    setAutomationPause,
    setRuntimeFlag,
    upsertSalesNavList,
    updateLeadLinkedinUrl,
    updateLeadCampaignConfig,
} from './core/repositories';
import { setQuarantine } from './risk/incidentManager';
import { getEventSyncStatus, runEventSyncOnce } from './sync/eventSync';
import { WorkflowSelection } from './core/scheduler';
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from './linkedinUrl';
import { Page } from 'playwright';
import { getAccountProfileById, getRuntimeAccountProfiles } from './accountManager';
import { getProxyFailoverChain, getProxyPoolStatus } from './proxyManager';
import { runRandomLinkedinActivity } from './workers/randomActivityWorker';
import { addLeadToSalesNavList, createSalesNavList } from './salesnav/listActions';
import { isOpenAIConfigured } from './ai/openaiClient';
import { startTelegramListener } from './cloud/telegramListener';
import { markTelegramCommandProcessed, pollPendingTelegramCommand } from './cloud/supabaseDataClient';

// Graceful shutdown: chiude DB prima di uscire per non lasciare job RUNNING.
let shuttingDown = false;
function setupGracefulShutdown(): void {
    const handler = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.warn(`[SIGNAL] ${signal} ricevuto — chiusura in corso...`);
        await closeDatabase();
        process.exit(0);
    };
    process.on('SIGINT', () => { void handler('SIGINT'); });
    process.on('SIGTERM', () => { void handler('SIGTERM'); });
}

function getOptionValue(args: string[], optionName: string): string | undefined {
    const index = args.findIndex((value) => value === optionName);
    if (index === -1 || index + 1 >= args.length) {
        return undefined;
    }
    return args[index + 1];
}

function hasOption(args: string[], optionName: string): boolean {
    return args.includes(optionName);
}

function parseWorkflow(input: string | undefined): WorkflowSelection {
    if (input === 'invite' || input === 'check' || input === 'message' || input === 'warmup' || input === 'all') {
        return input;
    }
    return 'all';
}

function parseIntStrict(raw: string, optionName: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Valore non valido per ${optionName}: ${raw} `);
    }
    return parsed;
}

function parseNullableCap(raw: string, optionName: string): number | null {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'none' || normalized === 'null' || normalized === 'off' || normalized === '-1') {
        return null;
    }
    const parsed = parseIntStrict(raw, optionName);
    if (parsed < 0) {
        throw new Error(`${optionName} deve essere >= 0 oppure none / null / off.`);
    }
    return parsed;
}

function parsePauseMinutes(raw: string, optionName: string): number | null {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'none' || normalized === 'null' || normalized === 'off' || normalized === 'indefinite') {
        return null;
    }
    const parsed = parseIntStrict(raw, optionName);
    if (parsed < 1) {
        throw new Error(`${optionName} deve essere >= 1 oppure none / null / off / indefinite.`);
    }
    return parsed;
}

function parseBoolStrict(raw: string, optionName: string): boolean {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    throw new Error(`Valore non valido per ${optionName}: ${raw} (usa true / false).`);
}

function getWorkflowValue(args: string[]): string | undefined {
    const explicit = getOptionValue(args, '--workflow');
    if (explicit) {
        return explicit;
    }
    const positional = args.find((value) => !value.startsWith('--'));
    return positional;
}

function getPositionalArgs(args: string[]): string[] {
    return args.filter((value) => !value.startsWith('--'));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SalesNavResolveItem {
    leadId: number;
    status: string;
    currentUrl: string;
    resolvedProfileUrl: string | null;
    action: 'resolved' | 'updated' | 'conflict' | 'unresolved' | 'challenge_detected' | 'error';
    conflictLeadId?: number | null;
    error?: string;
}

interface SalesNavResolveReport {
    scanned: number;
    resolvable: number;
    updated: number;
    conflicts: number;
    unresolved: number;
    challengeDetected: boolean;
    fix: boolean;
    dryRun: boolean;
    items: SalesNavResolveItem[];
}

async function collectProfileUrlCandidates(page: Page): Promise<string[]> {
    const candidates = new Set<string>();

    const currentUrl = page.url();
    if (currentUrl) candidates.add(currentUrl);

    const canonicalHref = await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null);
    if (canonicalHref) candidates.add(canonicalHref);

    const ogUrl = await page.locator('meta[property="og:url"]').first().getAttribute('content').catch(() => null);
    if (ogUrl) candidates.add(ogUrl);

    const anchors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
            .map((node) => (node as HTMLAnchorElement).href)
            .filter((href) => typeof href === 'string' && href.length > 0);
    }).catch(() => [] as string[]);

    for (const href of anchors) {
        candidates.add(href);
    }

    return Array.from(candidates);
}

function pickResolvedProfileUrl(candidates: string[]): string | null {
    for (const candidate of candidates) {
        const normalized = normalizeLinkedInUrl(candidate);
        if (!isProfileUrl(normalized)) continue;
        if (isSalesNavigatorUrl(normalized)) continue;
        return normalized;
    }
    return null;
}

function getRecoveryStatusFromBlockedReason(reason: string | null): 'READY_INVITE' | 'INVITED' | 'READY_MESSAGE' | null {
    const normalized = (reason ?? '').toLowerCase();
    if (normalized.includes('salesnav_url_requires_profile_invite')) {
        return 'READY_INVITE';
    }
    if (normalized.includes('salesnav_url_requires_profile_check')) {
        return 'INVITED';
    }
    if (normalized.includes('salesnav_url_requires_profile_message')) {
        return 'READY_MESSAGE';
    }
    return null;
}

const WORKFLOW_RUNNER_LOCK_KEY = 'workflow.runner';
const WORKFLOW_RUNNER_MIN_TTL_SECONDS = 120;
const WORKFLOW_RUNNER_HEARTBEAT_MS = 30_000;
const AUTO_SITE_CHECK_LAST_RUN_KEY = 'site_check.last_run_at';
const SALESNAV_LAST_SYNC_KEY = 'salesnav.last_sync_at';

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

function printHelp(): void {
    console.log('Utilizzo consigliato (Windows): .\\bot.ps1 <comando> [opzioni]');
    console.log('Alternativa: npx ts-node src/index.ts <comando> [opzioni]');
    console.log('Compatibilità: npm start -- <comando> [opzioni]');
    console.log('Comandi principali:');
    console.log('  import --file <file.csv> --list <nome_lista>');
    console.log('  run invite|check|message|all (oppure --workflow <valore>)');
    console.log('  dry-run invite|check|message|all (oppure --workflow <valore>)');
    console.log('  run-loop [workflow] [intervalSec] [--cycles <n>] [--dry-run]');
    console.log('  autopilot [intervalSec] [--cycles <n>] [--dry-run]');
    console.log('  login [timeoutSec] [--account <id_account>]');
    console.log('  doctor');
    console.log('  status');
    console.log('  proxy-status');
    console.log('  funnel');
    console.log('  site-check [limit] [--fix]');
    console.log('  state-sync [limit] [--fix]');
    console.log('  salesnav-resolve [limit] [--fix] [--dry-run]');
    console.log('  salesnav-sync [listName] [--url <salesnav_list_url>] [--max-pages <n>] [--limit <n>] [--account <id>] [--dry-run]');
    console.log('  salesnav-lists [--limit <n>]');
    console.log('  salesnav-create-list <nome> [--account <id>]');
    console.log('  salesnav-add-lead <leadId> <listName> [--account <id>]');
    console.log('  salesnav-add-to-list <leadId> <listName> [--account <id>]  # alias');
    console.log('  random-activity [--account <id>] [--max-actions <n>] [--dry-run]');
    console.log('  enrich-targets [limit] [--dry-run]');
    console.log('  pause [minutes|indefinite] [reason]');
    console.log('  resume');
    console.log('  unquarantine');
    console.log('  incidents [open]');
    console.log('  incident-resolve <id>');
    console.log('  privacy-cleanup [days]');
    console.log('  lists');
    console.log('  company-targets [list] [limit]');
    console.log('  list-config <nome_lista> [priority] [inviteCap|none] [messageCap|none] [active]');
    console.log('    (oppure con opzioni: --list, --priority, --invite-cap, --message-cap, --active)');
    console.log('  sync-status');
    console.log('  sync-run-once');
    console.log('  db-backup');
    console.log('Alias retrocompatibili: connect, check, message');
}

async function runImportCommand(args: string[]): Promise<void> {
    const legacyPath = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
    const filePath = getOptionValue(args, '--file') ?? legacyPath;
    const listName = getOptionValue(args, '--list') ?? 'default';

    if (!filePath) {
        throw new Error('Specifica il CSV: npm start -- import --file path/to/file.csv --list nome_lista');
    }

    const result = await importLeadsFromCSV(filePath, listName);
    console.log(
        `Import completato.Lead inseriti = ${result.inserted}, Company target inseriti = ${result.companyTargetsInserted}, Skippati = ${result.skipped}, Lista = ${listName} `
    );
}

async function runLoginCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const positionalTimeout = positional.find((value) => /^\d+$/.test(value));
    const positionalAccount = positional.find((value) => !/^\d+$/.test(value));
    const timeoutRaw = getOptionValue(args, '--timeout') ?? positionalTimeout;
    const timeoutSeconds = timeoutRaw ? Math.max(30, parseIntStrict(timeoutRaw, '--timeout')) : 300;
    const timeoutMs = timeoutSeconds * 1000;
    const accountRaw = getOptionValue(args, '--account') ?? positionalAccount;
    const selectedAccount = getAccountProfileById(accountRaw);
    const availableAccounts = getRuntimeAccountProfiles().map((account) => account.id);
    if (accountRaw && accountRaw !== selectedAccount.id) {
        console.warn(`[LOGIN] account = ${accountRaw} non trovato.Uso account = ${selectedAccount.id}.Disponibili: ${availableAccounts.join(', ')} `);
    }

    const session = await launchBrowser({
        headless: false,
        sessionDir: selectedAccount.sessionDir,
        proxy: selectedAccount.proxy,
    });
    try {
        await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'load' });
        console.log(`Completa il login LinkedIn nella finestra aperta(account = ${selectedAccount.id}, timeout ${timeoutSeconds}s)...`);
        console.log('Il browser resta aperto finché il login non viene verificato o finché scade il timeout.');

        const startedAt = Date.now();
        let lastLogAt = 0;
        while (Date.now() - startedAt <= timeoutMs) {
            if (await isLoggedIn(session.page)) {
                const confirmed = await checkLogin(session.page);
                if (confirmed) {
                    console.log('Login sessione completato con successo.');
                    return;
                }
            }
            const now = Date.now();
            if (now - lastLogAt >= 15_000) {
                const remaining = Math.max(0, Math.ceil((timeoutMs - (now - startedAt)) / 1000));
                console.log(`In attesa completamento login... (${remaining}s rimanenti)`);
                lastLogAt = now;
            }
            await session.page.waitForTimeout(2500);
        }

        // Ultimo controllo esplicito sulla home LinkedIn.
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error(`Login non rilevato entro ${timeoutSeconds} secondi.`);
        }
        console.log('Login sessione completato con successo.');
    } finally {
        await closeBrowserSession(session);
    }
}

async function runLoopCommand(args: string[]): Promise<void> {
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

    // Avvio Poller Telegram (interno o webhook) in background a inizio loop
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

                        // Sostituiamo il vecchio decoy pattern basilare con il nuovo motore avanzato Session Warming
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

                    if (config.companyEnrichmentEnabled && (workflow === 'all' || workflow === 'invite')) {
                        const enrichment = await runCompanyEnrichmentBatch({
                            limit: config.companyEnrichmentBatch,
                            maxProfilesPerCompany: config.companyEnrichmentMaxProfilesPerCompany,
                            dryRun,
                        });
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

                    console.log(`[LOOP] cycle = ${cycle} completed`);
                }
            } catch (error) {
                console.error(`[LOOP] cycle = ${cycle} failed`, error);
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

async function runAutopilotCommand(args: string[]): Promise<void> {
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

async function runWorkflowCommand(workflow: WorkflowSelection, dryRun: boolean): Promise<void> {
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

async function runFunnelCommand(): Promise<void> {
    const report = await buildFunnelReport();
    console.log(JSON.stringify(report, null, 2));
}

async function runSiteCheckCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 25;
    const autoFix = hasOption(args, '--fix') || positional.includes('fix');
    const report = await runSiteCheck({ limitPerStatus: limit, autoFix });
    console.log(JSON.stringify(report, null, 2));
}

async function runStateSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.postRunStateSyncLimit;
    const autoFix = hasOption(args, '--fix') || positional.includes('fix') || config.postRunStateSyncFix;
    const report = await runSiteCheck({ limitPerStatus: limit, autoFix });
    console.log(JSON.stringify({
        mode: 'state_sync',
        limitPerStatus: limit,
        autoFix,
        report,
    }, null, 2));
}

async function runSalesNavSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? config.salesNavSyncListName;
    const listUrl = getOptionValue(args, '--url') ?? positional[1] ?? config.salesNavSyncListUrl;
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : config.salesNavSyncMaxPages;
    const limitRaw = getOptionValue(args, '--limit');
    const maxLeadsPerList = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.salesNavSyncLimit;
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;

    const report = await runSalesNavigatorListSync({
        listName: listName?.trim() ? listName : null,
        listUrl: listUrl?.trim() ? listUrl : null,
        maxPages,
        maxLeadsPerList,
        dryRun,
        accountId: accountId || undefined,
    });
    console.log(JSON.stringify(report, null, 2));
}

async function runSalesNavListsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 200;
    const lists = await listSalesNavLists(limit);
    console.log(JSON.stringify({ total: lists.length, items: lists }, null, 2));
}

async function runSalesNavCreateListCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const listName = getOptionValue(args, '--name') ?? positional[0];
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;
    if (!listName || !listName.trim()) {
        throw new Error('Specifica nome lista: salesnav-create-list <nome>');
    }
    const result = await createSalesNavList(listName, accountId || undefined);
    let dbListId: number | null = null;
    let dbSyncError: string | null = null;

    if (result.ok) {
        try {
            const normalizedName = (result.listName ?? listName).trim();
            if (result.listUrl) {
                const listRow = await upsertSalesNavList(normalizedName, result.listUrl);
                dbListId = listRow.id;
            } else {
                const existing = await getSalesNavListByName(normalizedName);
                dbListId = existing?.id ?? null;
            }
        } catch (error) {
            dbSyncError = error instanceof Error ? error.message : String(error);
        }
    }

    console.log(JSON.stringify({
        ...result,
        dbSync: {
            listId: dbListId,
            synced: dbListId !== null,
            error: dbSyncError,
        },
    }, null, 2));
}

async function runSalesNavAddLeadCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const leadIdRaw = getOptionValue(args, '--lead-id') ?? positional[0];
    const listName = getOptionValue(args, '--list') ?? positional[1];
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;

    if (!leadIdRaw) {
        throw new Error('Specifica leadId: salesnav-add-lead <leadId> <listName>');
    }
    if (!listName || !listName.trim()) {
        throw new Error('Specifica listName: salesnav-add-lead <leadId> <listName>');
    }

    const leadId = Math.max(1, parseIntStrict(leadIdRaw, '--lead-id'));
    const lead = await getLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead non trovato: ${leadId} `);
    }

    const result = await addLeadToSalesNavList(lead.linkedin_url, listName, accountId || undefined);
    const targetListName = (result.listName ?? listName).trim();
    let dbListId: number | null = null;
    let dbLinked = false;
    let dbSyncError: string | null = null;

    if (result.ok) {
        try {
            let listRow = await getSalesNavListByName(targetListName);
            if (!listRow && result.listUrl) {
                listRow = await upsertSalesNavList(targetListName, result.listUrl);
            }
            if (listRow) {
                dbListId = listRow.id;
                await linkLeadToSalesNavList(listRow.id, leadId);
                dbLinked = true;
            }
        } catch (error) {
            dbSyncError = error instanceof Error ? error.message : String(error);
        }
    }

    console.log(JSON.stringify({
        leadId,
        listName,
        leadUrl: lead.linkedin_url,
        dbSync: {
            listId: dbListId,
            linked: dbLinked,
            error: dbSyncError,
        },
        ...result,
    }, null, 2));
}

async function runProxyStatusCommand(): Promise<void> {
    const status = getProxyPoolStatus();
    const failoverChain = getProxyFailoverChain().map((proxy, index) => ({
        order: index + 1,
        server: proxy.server,
        auth: !!proxy.username || !!proxy.password,
    }));

    console.log(JSON.stringify({
        ...status,
        failoverChain,
    }, null, 2));
}

async function runRandomActivityCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const maxActionsRaw = getOptionValue(args, '--max-actions')
        ?? getOptionValue(args, '--actions')
        ?? positional.find((value) => /^\d+$/.test(value));
    const accountId = getOptionValue(args, '--account')
        ?? positional.find((value) => {
            const normalized = value.toLowerCase();
            if (normalized === 'dry' || normalized === 'dry-run') return false;
            return !value.startsWith('--') && !/^\d+$/.test(value);
        })
        ?? config.salesNavSyncAccountId
        ?? undefined;
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry') || positional.includes('dry-run');
    const maxActions = maxActionsRaw
        ? Math.max(1, parseIntStrict(maxActionsRaw, '--max-actions'))
        : config.randomActivityMaxActions;

    const report = await runRandomLinkedinActivity({
        accountId: accountId || undefined,
        maxActions,
        dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
}

async function runSalesNavResolveCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 25;
    const fix = hasOption(args, '--fix') || positional.includes('fix');
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');

    const leads = await getLeadsWithSalesNavigatorUrls(limit);
    const report: SalesNavResolveReport = {
        scanned: 0,
        resolvable: 0,
        updated: 0,
        conflicts: 0,
        unresolved: 0,
        challengeDetected: false,
        fix,
        dryRun,
        items: [],
    };

    if (leads.length === 0) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    const session = await launchBrowser({ headless: config.headless });
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error('Sessione LinkedIn non autenticata. Esegui prima: .\\bot.ps1 login');
        }

        for (const lead of leads) {
            report.scanned += 1;
            try {
                await session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
                await humanDelay(session.page, 1000, 2000);

                if (await detectChallenge(session.page)) {
                    report.challengeDetected = true;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl: null,
                        action: 'challenge_detected',
                    });
                    break;
                }

                const candidates = await collectProfileUrlCandidates(session.page);
                const resolvedProfileUrl = pickResolvedProfileUrl(candidates);
                if (!resolvedProfileUrl) {
                    report.unresolved += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl: null,
                        action: 'unresolved',
                    });
                    continue;
                }

                report.resolvable += 1;
                if (!fix || dryRun) {
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'resolved',
                    });
                    continue;
                }

                const updated = await updateLeadLinkedinUrl(lead.id, resolvedProfileUrl);
                if (updated.updated) {
                    const recoveryStatus = lead.status === 'BLOCKED'
                        ? getRecoveryStatusFromBlockedReason(lead.blocked_reason)
                        : null;
                    if (recoveryStatus) {
                        await reconcileLeadStatus(lead.id, recoveryStatus, 'salesnav_profile_url_resolved', {
                            previousStatus: lead.status,
                            blockedReason: lead.blocked_reason,
                        });
                    }
                    report.updated += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'updated',
                    });
                } else {
                    report.conflicts += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'conflict',
                        conflictLeadId: updated.conflictLeadId,
                    });
                }
            } catch (error) {
                report.items.push({
                    leadId: lead.id,
                    status: lead.status,
                    currentUrl: lead.linkedin_url,
                    resolvedProfileUrl: null,
                    action: 'error',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    } finally {
        await closeBrowserSession(session);
    }

    console.log(JSON.stringify(report, null, 2));
}

async function runEnrichTargetsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.companyEnrichmentBatch;
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry') || positional.includes('dry-run');
    const report = await runCompanyEnrichmentBatch({
        limit,
        maxProfilesPerCompany: config.companyEnrichmentMaxProfilesPerCompany,
        dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
}

async function runStatusCommand(): Promise<void> {
    const localDate = getLocalDateString();
    const [
        quarantineFlag,
        pauseState,
        incidents,
        jobStatusCounts,
        dailyStats,
        syncStatus,
        runnerLock,
        autoSiteCheckLastRunAt,
        salesNavSyncLastRunAt,
    ] = await Promise.all([
        getRuntimeFlag('account_quarantine'),
        getAutomationPauseState(),
        listOpenIncidents(),
        getJobStatusCounts(),
        getDailyStatsSnapshot(localDate),
        getEventSyncStatus(),
        getRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY),
        getRuntimeFlag(AUTO_SITE_CHECK_LAST_RUN_KEY),
        getRuntimeFlag(SALESNAV_LAST_SYNC_KEY),
    ]);

    const payload = {
        localDate,
        quarantine: quarantineFlag === 'true',
        accounts: getRuntimeAccountProfiles().map((account) => ({
            id: account.id,
            sessionDir: account.sessionDir,
            dedicatedProxy: !!account.proxy,
        })),
        pause: pauseState,
        openIncidents: incidents.length,
        jobs: jobStatusCounts,
        proxy: getProxyPoolStatus(),
        dailyStats,
        sync: syncStatus,
        runnerLock,
        autoSiteCheck: {
            enabled: config.autoSiteCheckEnabled,
            fix: config.autoSiteCheckFix,
            limitPerStatus: config.autoSiteCheckLimit,
            intervalHours: config.autoSiteCheckIntervalHours,
            staleDays: config.siteCheckStaleDays,
            lastRunAt: autoSiteCheckLastRunAt,
        },
        stateSync: {
            postRunEnabled: config.postRunStateSyncEnabled,
            postRunLimit: config.postRunStateSyncLimit,
            postRunFix: config.postRunStateSyncFix,
        },
        salesNavSync: {
            enabled: config.salesNavSyncEnabled,
            listName: config.salesNavSyncListName,
            listUrlConfigured: !!config.salesNavSyncListUrl.trim(),
            maxPages: config.salesNavSyncMaxPages,
            intervalHours: config.salesNavSyncIntervalHours,
            limitPerList: config.salesNavSyncLimit,
            accountId: config.salesNavSyncAccountId || null,
            lastRunAt: salesNavSyncLastRunAt,
        },
        randomActivity: {
            enabled: config.randomActivityEnabled,
            probability: config.randomActivityProbability,
            maxActions: config.randomActivityMaxActions,
        },
        ai: {
            personalizationEnabled: config.aiPersonalizationEnabled,
            guardianEnabled: config.aiGuardianEnabled,
            model: config.aiModel,
            openaiConfigured: isOpenAIConfigured(),
            guardianMinIntervalMinutes: config.aiGuardianMinIntervalMinutes,
            guardianPauseMinutes: config.aiGuardianPauseMinutes,
        },
    };
    console.log(JSON.stringify(payload, null, 2));
}

async function runPauseCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const minutesRaw = getOptionValue(args, '--minutes') ?? positional[0];
    const reasonRaw = getOptionValue(args, '--reason') ?? (positional.length > 1 ? positional.slice(1).join(' ') : 'manual_pause');

    const minutes = minutesRaw
        ? parsePauseMinutes(minutesRaw, '--minutes')
        : config.autoPauseMinutesOnFailureBurst;
    const pausedUntil = await setAutomationPause(minutes, reasonRaw);
    const renderedUntil = pausedUntil ?? 'manual resume';
    console.log(`Automazione in pausa.pausedUntil=${renderedUntil} reason = ${reasonRaw} `);
}

async function runResumeCommand(): Promise<void> {
    await clearPauseState();
    console.log('Pausa automazione rimossa.');
}

async function runUnquarantineCommand(): Promise<void> {
    await setQuarantine(false);
    await clearPauseState();
    console.log('Quarantine disattivata e pausa rimossa.');
}

async function runResolveIncidentCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const idRaw = getOptionValue(args, '--id') ?? positional[0];
    if (!idRaw) {
        throw new Error('Specifica ID incidente: npm start -- incident-resolve <id>');
    }
    const incidentId = parseIntStrict(idRaw, '--id');
    if (incidentId < 1) {
        throw new Error('--id deve essere >= 1');
    }
    await resolveIncident(incidentId);
    console.log(`Incidente ${incidentId} risolto.`);
}

async function runPrivacyCleanupCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const daysRaw = getOptionValue(args, '--days') ?? positional[0];
    const days = daysRaw ? Math.max(7, parseIntStrict(daysRaw, '--days')) : config.retentionDays;
    const result = await cleanupPrivacyData(days);
    console.log(JSON.stringify({ retentionDays: days, ...result }, null, 2));
}

async function runCompanyTargetsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? null;
    const limitRaw = getOptionValue(args, '--limit') ?? positional[1];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 50;
    const [total, items] = await Promise.all([
        countCompanyTargets(listName ?? undefined),
        listCompanyTargets(listName, limit),
    ]);
    console.log(JSON.stringify({ list: listName ?? 'all', total, shown: items.length, items }, null, 2));
}

async function runDbBackupCommand(): Promise<void> {
    console.log('Avvio backup database manuale...');
    try {
        const backupPath = await backupDatabase();
        console.log(`Backup completato con successo.File salvato in: ${backupPath} `);
    } catch (e) {
        console.error('Errore durante il backup del database:', e);
    }
}

async function main(): Promise<void> {
    setupGracefulShutdown();
    const args = process.argv.slice(2);
    const command = args[0];
    const commandArgs = args.slice(1);

    await initDatabase();
    const shouldRecoverStuckJobs = command === 'run'
        || command === 'connect'
        || command === 'check'
        || command === 'message'
        || (command === 'run-loop' && !hasOption(commandArgs, '--dry-run'));
    if (shouldRecoverStuckJobs) {
        const recoveredJobs = await recoverStuckJobs(config.jobStuckMinutes);
        if (recoveredJobs > 0) {
            console.warn(`[BOOT] Ripristinati ${recoveredJobs} job RUNNING bloccati da oltre ${config.jobStuckMinutes} minuti.`);
        }
    }

    switch (command) {
        case 'import':
            await runImportCommand(commandArgs);
            break;
        case 'run': {
            const workflow = parseWorkflow(getWorkflowValue(commandArgs));
            await runWorkflowCommand(workflow, false);
            break;
        }
        case 'dry-run': {
            const workflow = parseWorkflow(getWorkflowValue(commandArgs));
            await runWorkflowCommand(workflow, true);
            break;
        }
        case 'run-loop':
            await runLoopCommand(commandArgs);
            break;
        case 'autopilot':
            await runAutopilotCommand(commandArgs);
            break;
        case 'login':
            await runLoginCommand(commandArgs);
            break;
        case 'doctor': {
            const report = await runDoctor();
            console.log(JSON.stringify(report, null, 2));
            break;
        }
        case 'funnel':
            await runFunnelCommand();
            break;
        case 'site-check':
            await runSiteCheckCommand(commandArgs);
            break;
        case 'state-sync':
            await runStateSyncCommand(commandArgs);
            break;
        case 'salesnav-sync':
            await runSalesNavSyncCommand(commandArgs);
            break;
        case 'salesnav-lists':
            await runSalesNavListsCommand(commandArgs);
            break;
        case 'salesnav-create-list':
            await runSalesNavCreateListCommand(commandArgs);
            break;
        case 'salesnav-add-lead':
            await runSalesNavAddLeadCommand(commandArgs);
            break;
        case 'salesnav-add-to-list':
            await runSalesNavAddLeadCommand(commandArgs);
            break;
        case 'salesnav-resolve':
            await runSalesNavResolveCommand(commandArgs);
            break;
        case 'enrich-targets':
            await runEnrichTargetsCommand(commandArgs);
            break;
        case 'status':
            await runStatusCommand();
            break;
        case 'proxy-status':
            await runProxyStatusCommand();
            break;
        case 'random-activity':
            await runRandomActivityCommand(commandArgs);
            break;
        case 'pause':
            await runPauseCommand(commandArgs);
            break;
        case 'resume':
            await runResumeCommand();
            break;
        case 'unquarantine':
            await runUnquarantineCommand();
            break;
        case 'incidents': {
            const positional = getPositionalArgs(commandArgs);
            const openOnly = commandArgs.includes('--open') || positional.includes('open') || positional.length === 0;
            if (!openOnly) {
                console.log('Usa: npm start -- incidents open');
                break;
            }
            const incidents = await listOpenIncidents();
            console.log(JSON.stringify(incidents, null, 2));
            break;
        }
        case 'incident-resolve':
            await runResolveIncidentCommand(commandArgs);
            break;
        case 'privacy-cleanup':
            await runPrivacyCleanupCommand(commandArgs);
            break;
        case 'lists': {
            const lists = await listLeadCampaignConfigs(false);
            console.log(JSON.stringify(lists, null, 2));
            break;
        }
        case 'company-targets':
            await runCompanyTargetsCommand(commandArgs);
            break;
        case 'list-config': {
            const positional = getPositionalArgs(commandArgs);
            const listName = getOptionValue(commandArgs, '--list') ?? positional[0];
            if (!listName) {
                throw new Error('Specifica la lista: npm start -- list-config --list <nome_lista> ...');
            }

            const patch: {
                priority?: number;
                dailyInviteCap?: number | null;
                dailyMessageCap?: number | null;
                isActive?: boolean;
            } = {};

            const priorityRaw = getOptionValue(commandArgs, '--priority') ?? positional[1];
            if (hasOption(commandArgs, '--priority') || priorityRaw !== undefined) {
                const raw = priorityRaw;
                if (!raw) throw new Error('Manca valore per --priority');
                const parsed = parseIntStrict(raw, '--priority');
                if (parsed < 1) throw new Error('--priority deve essere >= 1');
                patch.priority = parsed;
            }
            const inviteCapRaw = getOptionValue(commandArgs, '--invite-cap') ?? positional[2];
            if (hasOption(commandArgs, '--invite-cap') || inviteCapRaw !== undefined) {
                const raw = inviteCapRaw;
                if (!raw) throw new Error('Manca valore per --invite-cap');
                patch.dailyInviteCap = parseNullableCap(raw, '--invite-cap');
            }
            const messageCapRaw = getOptionValue(commandArgs, '--message-cap') ?? positional[3];
            if (hasOption(commandArgs, '--message-cap') || messageCapRaw !== undefined) {
                const raw = messageCapRaw;
                if (!raw) throw new Error('Manca valore per --message-cap');
                patch.dailyMessageCap = parseNullableCap(raw, '--message-cap');
            }
            const activeRaw = getOptionValue(commandArgs, '--active') ?? positional[4];
            if (hasOption(commandArgs, '--active') || activeRaw !== undefined) {
                const raw = activeRaw;
                if (!raw) throw new Error('Manca valore per --active');
                patch.isActive = parseBoolStrict(raw, '--active');
            }

            const updated = await updateLeadCampaignConfig(listName, patch);
            console.log(JSON.stringify(updated, null, 2));
            break;
        }
        case 'sync-status': {
            const status = await getEventSyncStatus();
            console.log(JSON.stringify(status, null, 2));
            break;
        }
        case 'sync-run-once':
            await runEventSyncOnce();
            console.log('Sync eventi completato.');
            break;
        case 'db-backup':
            await runDbBackupCommand();
            break;
        case 'connect':
            await runWorkflowCommand('invite', false);
            break;
        case 'check':
            await runWorkflowCommand('check', false);
            break;
        case 'message':
            await runWorkflowCommand('message', false);
            break;
        case 'warmup':
            await runWorkflowCommand('warmup', false);
            break;
        default:
            printHelp();
            break;
    }
}

main()
    .catch((error) => {
        console.error('[FATAL]', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDatabase();
    });
