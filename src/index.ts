import { closeDatabase, initDatabase } from './db';
import { config, validateCriticalConfig } from './config';
import { runDoctor } from './core/doctor';
import { listOpenIncidents, recoverStuckJobs } from './core/repositories';
import { getEventSyncStatus, runEventSyncOnce } from './sync/eventSync';
import { generateAndSendDailyReport } from './telemetry/dailyReporter';
import { startServer } from './api/server';

import { hasOption, parseWorkflow, getWorkflowValue } from './cli/cliParser';
import { runLoopCommand, runAutopilotCommand, runWorkflowCommand } from './cli/commands/loopCommand';
import { runLoginCommand, runImportCommand, runFunnelCommand, runSiteCheckCommand, runStateSyncCommand, runProxyStatusCommand, runRandomActivityCommand, runEnrichTargetsCommand } from './cli/commands/utilCommands';
import { runSalesNavSyncCommand, runSalesNavListsCommand, runSalesNavCreateListCommand, runSalesNavAddLeadCommand, runSalesNavResolveCommand } from './cli/commands/salesNavCommands';
import { runStatusCommand, runPauseCommand, runResumeCommand, runUnquarantineCommand, runResolveIncidentCommand, runPrivacyCleanupCommand, runDbBackupCommand, runCompanyTargetsCommand, runListConfigCommand, runListsCommand } from './cli/commands/adminCommands';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

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
            console.log(`[PLANNED_RESTART] Uptime = ${uptimeHours}h >= limit ${config.processMaxUptimeHours}h — riavvio pianificato.`);
            clearInterval(interval);
            closeDatabase()
                .catch(err => console.error('[PLANNED_RESTART] Errore chiusura DB:', err))
                .finally(() => process.exit(0));
        }
    }, CHECK_INTERVAL_MS);

    interval.unref();
}

// ─── Help ─────────────────────────────────────────────────────────────────────

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

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    setupGracefulShutdown();
    setupPlannedRestart();

    // ── Validazione configurazione critica ────────────────────────────────────
    const configErrors = validateCriticalConfig();
    if (configErrors.length > 0) {
        console.error('\n❌ ERRORI CONFIGURAZIONE CRITICA — correggere il file .env prima di procedere:\n');
        configErrors.forEach((err) => console.error(`  • ${err}`));
        console.error('');
        // Blocca solo se non stiamo lanciando comandi non-operativi
        const args0 = process.argv[2];
        const safeCommands = ['doctor', 'help', '--help', undefined];
        if (!safeCommands.includes(args0)) {
            process.exit(1);
        }
    }

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
            const positional = commandArgs.filter(v => !v.startsWith('--'));
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
        case 'daily-report':
            await generateAndSendDailyReport();
            break;
        case 'dashboard':
            await initDatabase();
            startServer(3000);
            console.log('Premi Ctrl+C per fermare la Dashboard e spegnere il database.');
            await new Promise(() => { });
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
