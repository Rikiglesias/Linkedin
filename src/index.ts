// ── Crash safety: catch unhandled promise rejections and uncaught exceptions ──
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    process.exit(1);
});

import { closeDatabase, initDatabase } from './db';
import { config, validateConfigFull } from './config';
import { runDoctor } from './core/doctor';
import { getGlobalKPIData, listOpenIncidents, recoverStuckJobs, recoverStuckAcceptedLeads, recoverStuckPublishingPosts } from './core/repositories';
import { getEventSyncStatus, runEventSyncOnce } from './sync/eventSync';
import { generateAndSendDailyReport } from './telemetry/dailyReporter';
import { startServer } from './api/server';

import { hasOption, parseWorkflow, getWorkflowValue } from './cli/cliParser';
import { runLoopCommand, runAutopilotCommand, runWorkflowCommand } from './cli/commands/loopCommand';
import { runReplCommand } from './cli/commands/replCommand';
import {
    runLoginCommand,
    runImportCommand,
    runFunnelCommand,
    runSiteCheckCommand,
    runStateSyncCommand,
    runProxyStatusCommand,
    runRandomActivityCommand,
    runEnrichTargetsCommand,
    runEnrichDeepCommand,
    runEnrichProfilesCommand,
    runEnrichFastCommand,
    runCreateProfileCommand,
    runTestConnectionCommand,
} from './cli/commands/utilCommands';
import {
    runSalesNavUnifiedCommand,
} from './cli/commands/salesNavCommands';
import {
    runSyncListCommand,
    runSyncSearchCommand,
    runSendMessagesCommand,
    runSendInvitesCommand,
} from './cli/commands/workflowCommands';
import {
    runAiQualityCommand,
    runCompanyTargetsCommand,
    runDbAnalyzeCommand,
    runDbBackupCommand,
    runDbRollbackCommand,
    runDiagnosticsCommand,
    runFeatureStoreCommand,
    runRestoreDrillCommand,
    runListConfigCommand,
    runListsCommand,
    runPauseCommand,
    runPrivacyCleanupCommand,
    runReviewQueueCommand,
    runResolveIncidentCommand,
    runResumeCommand,
    runSecurityAdvisorCommand,
    runSecretRotatedCommand,
    runSecretsRotateCommand,
    runSecretsStatusCommand,
    runStatusCommand,
    runUnquarantineCommand,
} from './cli/commands/adminCommands';
import { startCycleTlsProxy, stopCycleTlsProxy } from './proxy/cycleTlsProxy';
import { initPluginSystem, pluginRegistry } from './plugins/pluginLoader';
import { getRuntimeAccountProfiles } from './accountManager';
import { checkProxyHealth } from './proxyManager';
import { printCommandHelp } from './cli/commandHelp';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let shuttingDown = false;
function setupGracefulShutdown(): void {
    const handler = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.warn(`[SIGNAL] ${signal} ricevuto — chiusura in corso...`);

        // Recupera job rimasti in RUNNING → PENDING per il prossimo avvio
        try {
            const recovered = await recoverStuckJobs(0);
            if (recovered > 0) console.log(`[SHUTDOWN] ${recovered} job RUNNING → PENDING`);
        } catch { /* DB potrebbe essere già chiuso */ }

        await stopCycleTlsProxy().catch(() => { });
        await closeDatabase();
        process.exit(0);
    };
    process.on('SIGINT', () => {
        void handler('SIGINT');
    });
    process.on('SIGTERM', () => {
        void handler('SIGTERM');
    });
}

/**
 * Auto-restart pianificato (memory leak protection).
 * Dopo PROCESS_MAX_UPTIME_HOURS il processo esce con code 0.
 */
function setupPlannedRestart(): void {
    const maxUptimeMs = config.processMaxUptimeHours * 60 * 60 * 1000;
    const CHECK_INTERVAL_MS = 30 * 60 * 1000;

    const interval = setInterval(() => {
        const uptimeMs = process.uptime() * 1000;
        if (uptimeMs >= maxUptimeMs) {
            const uptimeHours = (uptimeMs / 3_600_000).toFixed(1);
            console.log(
                `[PLANNED_RESTART] Uptime = ${uptimeHours}h >= limit ${config.processMaxUptimeHours}h — riavvio pianificato.`,
            );
            clearInterval(interval);
            stopCycleTlsProxy()
                .catch(() => { })
                .then(() => closeDatabase())
                .catch((err) => console.error('[PLANNED_RESTART] Errore chiusura DB:', err))
                .finally(() => process.exit(0));
        }
    }, CHECK_INTERVAL_MS);

    interval.unref();
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log('Utilizzo consigliato (Windows): .\\bot.ps1 <comando> [opzioni]');
    console.log('Produzione: npm run build && npm start -- <comando> -- [opzioni]');
    console.log('Sviluppo: npm run start:dev -- <comando> -- [opzioni]');
    console.log('');
    console.log('Production Workflows (pre-flight interattivo + enrichment + report):');
    console.log('  sync-list     [--list "X"] [--url <url>] [--max-pages N] [--max-leads N] [--dry-run] [--interactive]');
    console.log('  sync-search   [--search-name "X"] [--list "X"] [--max-pages N] [--limit N] [--dry-run]');
    console.log('  send-messages [--list "X"] [--template "X"] [--lang it|en] [--limit N] [--dry-run]');
    console.log('  send-invites  [--list "X"] [--note ai|template|none] [--min-score N] [--limit N] [--dry-run]');
    console.log('  Opzioni comuni: --skip-preflight  --no-proxy  --account <id>  --no-enrich');
    console.log('');
    console.log('Comandi principali (job queue — processa job dalla coda):');
    console.log('  import --file <file.csv> --list <nome_lista>');
    console.log('  run invite|check|message|all (oppure --workflow <valore>)');
    console.log('  dry-run invite|check|message|all (oppure --workflow <valore>)');
    console.log('  run-loop [workflow] [intervalSec] [--cycles <n>] [--dry-run]');
    console.log('  autopilot [intervalSec] [--cycles <n>] [--dry-run]');
    console.log('  login [timeoutSec] [--account <id_account>]');
    console.log('  create-profile [--dir <path>] [--timeout <sec>] [--url <linkedin_login_url>]');
    console.log('  doctor');
    console.log('  status');
    console.log('  diagnostics [--sections <all|health,locks,queue,sync,selectors>] [--date <YYYY-MM-DD>]');
    console.log('    alias: diag');
    console.log('  proxy-status');
    console.log('  test-connection [--account <id>] [--no-proxy]');
    console.log('  funnel');
    console.log('  site-check [limit] [--fix]');
    console.log('  state-sync [limit] [--fix]');
    console.log('  salesnav save [--list "X"] [--search-name "X"] [--max-pages N] [--resume] [--dry-run]');
    console.log('  salesnav sync [--list "X"] [--url <url>] [--interactive|-i] [--max-pages N] [--dry-run]');
    console.log('  salesnav resolve [--limit N] [--fix] [--dry-run]');
    console.log('  salesnav lists [--limit N]');
    console.log('  salesnav create "Nome"');
    console.log('  salesnav add <leadId> <lista>');
    console.log('  Opzioni globali: --no-proxy  --account <id>');
    console.log('  random-activity [--account <id>] [--max-actions <n>] [--dry-run]');
    console.log('  enrich-targets [limit] [--dry-run]');
    console.log('  enrich-deep --lead <id> | --list <nome> [--limit N] [--dry-run]');
    console.log('  enrich-profiles --list <nome> [--limit 15] [--dry-run] [--no-proxy]');
    console.log('  enrich-fast [--list <nome>] [--limit 50] [--concurrency 5]  (parallelo, zero LinkedIn)');
    console.log('  pause [minutes|indefinite] [reason]');
    console.log('  resume');
    console.log('  unquarantine');
    console.log('  incidents [open]');
    console.log('  incident-resolve <id>');
    console.log('  privacy-cleanup [days]');
    console.log('  lists');
    console.log('  review-queue [--limit <n>]');
    console.log('  company-targets [list] [limit]');
    console.log('  list-config <nome_lista> [priority] [inviteCap|none] [messageCap|none] [active]');
    console.log('    (oppure con opzioni: --list, --priority, --invite-cap, --message-cap, --active)');
    console.log('  sync-status');
    console.log('  sync-run-once');
    console.log('  db-backup');
    console.log('  restore-drill [--backup <path.sqlite>] [--keep-artifacts] [--report-dir <path>] [--by <source>]');
    console.log('  security-advisor [--by <source>] [--report-dir <path>] [--no-persist-flags]');
    console.log('  ai-quality [--days <n>] [--run]');
    console.log('  feature-store <build|versions|export|import> [opzioni]');
    console.log(
        '    build: --dataset <name> [--version <v>] [--actions invite,message] [--lookback-days <n>] [--force]',
    );
    console.log('    versions: [--dataset <name>] [--limit <n>]');
    console.log('    export: --dataset <name> [--version <v>] [--out-dir <path>]');
    console.log('    import: --manifest <path> [--data-file <path>] [--force]');
    console.log('  secrets-status');
    console.log('  secret-rotated --name <SECRET_NAME> [--owner <owner>] [--expires-days <n>] [--notes <text>]');
    console.log(
        '  secrets-rotate [--apply] [--interval-days <n>] [--actor <name>] [--include <SECRET_A,SECRET_B>] [--env-file <path>]',
    );
    console.log('  db-analyze');
    console.log('  daily-report');
    console.log('  dashboard');
    console.log('  repl');
    console.log('  warmup');
    console.log('Alias retrocompatibili [DEPRECATED]: connect → run invite, check → run check, message → run message');
    console.log('Flag utili: --skip-preflight (salta doctor preflight obbligatorio)');
    console.log('           --strict (rifiuta alias deprecati)');
}

function shouldRunMandatoryPreflight(command: string | undefined): boolean {
    if (!command) return false;
    const guardedCommands = new Set(['run', 'run-loop', 'autopilot', 'connect', 'check', 'message', 'warmup']);
    return guardedCommands.has(command);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    setupGracefulShutdown();
    setupPlannedRestart();

    // ── Validazione configurazione critica ────────────────────────────────────
    const { errors: configErrors, warnings: configWarnings } = validateConfigFull(config);
    if (configWarnings.length > 0) {
        console.warn('\n⚠️  AVVISI CONFIGURAZIONE:\n');
        configWarnings.forEach((w) => console.warn(`  • ${w}`));
        console.warn('');
    }
    if (configErrors.length > 0) {
        console.error('\n❌ ERRORI CONFIGURAZIONE CRITICA — correggere il file .env prima di procedere:\n');
        configErrors.forEach((err) => console.error(`  • ${err}`));
        console.error('');
        // Blocca solo se non stiamo lanciando comandi non-operativi
        const args0 = process.argv[2];
        const safeCommands = ['doctor', 'help', '--help', 'login', 'create-profile', undefined];
        if (!safeCommands.includes(args0)) {
            process.exit(1);
        }
    }

    const args = process.argv.slice(2);
    const command = args[0];

    // ── Per-command --help: intercetta prima dell'inizializzazione pesante ────
    if (command && (args.includes('--help') || args.includes('-h'))) {
        if (printCommandHelp(command)) {
            return;
        }
        // Comando senza help specifico: mostra help globale
        printHelp();
        return;
    }
    if (command === 'help' || command === '--help' || command === '-h') {
        printHelp();
        return;
    }
    const commandArgs = args.slice(1);
    const strictMode = hasOption(commandArgs, '--strict');
    const skipPreflight = hasOption(commandArgs, '--skip-preflight');
    const isDryRunCommand = command === 'dry-run' || hasOption(commandArgs, '--dry-run');

    // ── Deprecation handling ─────────────────────────────────────────────────
    const DEPRECATED_ALIASES: Record<string, string> = {
        'connect': 'run invite',
        'check': 'run check',
        'message': 'run message',
        'salesnav-sync': 'salesnav sync',
        'salesnav-bulk-save': 'salesnav save',
        'salesnav-resolve': 'salesnav resolve',
        'salesnav-lists': 'salesnav lists',
        'salesnav-create-list': 'salesnav create',
        'salesnav-add-lead': 'salesnav add',
        'salesnav-add-to-list': 'salesnav add',
    };

    if (command && command in DEPRECATED_ALIASES) {
        const replacement = DEPRECATED_ALIASES[command];
        if (strictMode) {
            console.error(`[STRICT] Comando deprecato "${command}" rifiutato. Usa "${replacement}" al suo posto.`);
            process.exit(1);
        }
        console.warn(`[DEPRECATED] "${command}" è deprecato e verrà rimosso in v2.0. Usa "${replacement}" al suo posto.`);
    }
    const browserCommands = new Set([
        'run',
        'dry-run',
        'run-loop',
        'autopilot',
        'login',
        'create-profile',
        'doctor',
        'site-check',
        'state-sync',
        'salesnav',
        'salesnav-sync',
        'salesnav-bulk-save',
        'salesnav-resolve',
        'salesnav-lists',
        'salesnav-create-list',
        'salesnav-add-lead',
        'salesnav-add-to-list',
        'random-activity',
        'test-connection',
        'connect',
        'check',
        'message',
        'warmup',
        'sync-list',
        'sync-search',
        'send-messages',
        'send-invites',
    ]);

    await initDatabase();
    await initPluginSystem().catch((error) => {
        console.warn('[PLUGIN] init failed', error);
    });
    if (!isDryRunCommand && config.useJa3Proxy && browserCommands.has(command ?? '')) {
        await startCycleTlsProxy();
    }
    const shouldRecoverStuckJobs =
        command === 'run' ||
        command === 'connect' ||
        command === 'check' ||
        command === 'message' ||
        command === 'send-messages' ||
        command === 'send-invites' ||
        (command === 'run-loop' && !hasOption(commandArgs, '--dry-run'));
    if (shouldRecoverStuckJobs) {
        const recoveredJobs = await recoverStuckJobs(config.jobStuckMinutes);
        if (recoveredJobs > 0) {
            console.warn(
                `[BOOT] Ripristinati ${recoveredJobs} job RUNNING bloccati da oltre ${config.jobStuckMinutes} minuti.`,
            );
        }
        const recoveredLeads = await recoverStuckAcceptedLeads(20);
        if (recoveredLeads > 0) {
            console.warn(`[BOOT] Promossi ${recoveredLeads} lead bloccati in ACCEPTED → READY_MESSAGE.`);
        }
        const recoveredPosts = await recoverStuckPublishingPosts(10);
        if (recoveredPosts > 0) {
            console.warn(`[BOOT] Recuperati ${recoveredPosts} post bloccati in PUBLISHING → FAILED.`);
        }
    }

    if (
        config.mandatoryPreflightEnabled &&
        !skipPreflight &&
        !isDryRunCommand &&
        shouldRunMandatoryPreflight(command)
    ) {
        const preflight = await runDoctor();
        const failures: string[] = [];
        if (!preflight.dbIntegrityOk) failures.push('database_integrity_failed');
        if (!preflight.sessionLoginOk) failures.push('linkedin_login_missing');
        if (!preflight.accountIsolation.ok) failures.push('account_isolation_failed');
        if (preflight.quarantine) failures.push('account_quarantine_enabled');
        if (preflight.compliance.enforced && !preflight.compliance.ok) failures.push('compliance_guardrail_violated');

        if (failures.length > 0) {
            console.error('[PREFLIGHT] Bloccato: condizioni critiche rilevate.');
            console.error(
                JSON.stringify(
                    {
                        command,
                        failures,
                        preflight,
                    },
                    null,
                    2,
                ),
            );
            process.exit(1);
        }
        console.log('[PREFLIGHT] OK');
    }

    // ── Pre-flight proxy health check ────────────────────────────────────────
    if (!isDryRunCommand && browserCommands.has(command ?? '')) {
        const accounts = getRuntimeAccountProfiles();
        for (const account of accounts) {
            if (account.proxy) {
                const healthy = await checkProxyHealth(account.proxy);
                if (!healthy) {
                    console.error(`[PREFLIGHT] Proxy ${account.proxy.server} NON raggiungibile (account: ${account.id})`);
                } else {
                    console.log(`[PREFLIGHT] Proxy OK: ${account.proxy.server} (${account.id})`);
                }
            }
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
        case 'create-profile':
            await runCreateProfileCommand(commandArgs);
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
        case 'salesnav':
            await runSalesNavUnifiedCommand(commandArgs);
            break;
        case 'salesnav-sync':
            await runSalesNavUnifiedCommand(['sync', ...commandArgs]);
            break;
        case 'salesnav-bulk-save':
            await runSalesNavUnifiedCommand(['save', ...commandArgs]);
            break;
        case 'salesnav-resolve':
            await runSalesNavUnifiedCommand(['resolve', ...commandArgs]);
            break;
        case 'salesnav-lists':
            await runSalesNavUnifiedCommand(['lists', ...commandArgs]);
            break;
        case 'salesnav-create-list':
            await runSalesNavUnifiedCommand(['create', ...commandArgs]);
            break;
        case 'salesnav-add-lead':
        case 'salesnav-add-to-list':
            await runSalesNavUnifiedCommand(['add', ...commandArgs]);
            break;
        case 'enrich-targets':
            await runEnrichTargetsCommand(commandArgs);
            break;
        case 'enrich-deep':
            await runEnrichDeepCommand(commandArgs);
            break;
        case 'enrich-profiles':
            await runEnrichProfilesCommand(commandArgs);
            break;
        case 'enrich-fast':
            await runEnrichFastCommand(commandArgs);
            break;
        case 'status':
            await runStatusCommand();
            break;
        case 'diagnostics':
        case 'diag':
            await runDiagnosticsCommand(commandArgs);
            break;
        case 'kpi': {
            const kpi = await getGlobalKPIData();
            console.log(JSON.stringify(kpi, null, 2));
            break;
        }
        case 'proxy-status':
            await runProxyStatusCommand();
            break;
        case 'test-connection':
            await runTestConnectionCommand(commandArgs);
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
            const positional = commandArgs.filter((v) => !v.startsWith('--'));
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
        case 'lists':
            await runListsCommand();
            break;
        case 'review-queue':
            await runReviewQueueCommand(commandArgs);
            break;
        case 'company-targets':
            await runCompanyTargetsCommand(commandArgs);
            break;
        case 'list-config':
            await runListConfigCommand(commandArgs);
            break;
        case 'sync-status': {
            const status = await getEventSyncStatus();
            console.log(JSON.stringify(status, null, 2));
            break;
        }
        case 'sync-run-once':
            await runEventSyncOnce();
            console.log('Sync eventi completato.');
            break;
        case 'db-analyze':
            await runDbAnalyzeCommand();
            break;
        case 'db-backup':
            await runDbBackupCommand();
            break;
        case 'db-rollback':
            await runDbRollbackCommand(commandArgs);
            break;
        case 'restore-drill':
            await runRestoreDrillCommand(commandArgs);
            break;
        case 'security-advisor':
            await runSecurityAdvisorCommand(commandArgs);
            break;
        case 'ai-quality':
            await runAiQualityCommand(commandArgs);
            break;
        case 'feature-store':
            await runFeatureStoreCommand(commandArgs);
            break;
        case 'secrets-status':
            await runSecretsStatusCommand();
            break;
        case 'secret-rotated':
            await runSecretRotatedCommand(commandArgs);
            break;
        case 'secrets-rotate':
            await runSecretsRotateCommand(commandArgs);
            break;
        case 'connect':
            await runWorkflowCommand('invite', false);
            break;
        case 'check':  // deprecated → run check
            await runWorkflowCommand('check', false);
            break;
        case 'message': // deprecated → run message
            await runWorkflowCommand('message', false);
            break;
        case 'warmup':
            await runWorkflowCommand('warmup', false);
            break;
        case 'daily-report':
            await generateAndSendDailyReport();
            break;
        case 'dashboard':
            startServer(3000);
            console.log('Premi Ctrl+C per fermare la Dashboard e spegnere il database.');
            await new Promise(() => { });
            break;
        case 'repl':
            await runReplCommand();
            break;
        case 'sync-list':
            await runSyncListCommand(commandArgs);
            break;
        case 'sync-search':
            await runSyncSearchCommand(commandArgs);
            break;
        case 'send-messages':
            await runSendMessagesCommand(commandArgs);
            break;
        case 'send-invites':
            await runSendInvitesCommand(commandArgs);
            break;
        default:
            if (command) {
                console.error(`[WARN] Comando sconosciuto: "${command}". Usa "help" per l'elenco comandi.`);
            }
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
        await pluginRegistry.shutdown().catch(() => { });
        await stopCycleTlsProxy().catch(() => { });
        await closeDatabase();
    });
