/**
 * Workflow 2: sync-search — Ricerche salvate SalesNav → lista → DB + enrichment
 */

import { config, isWorkingHour } from '../config';
import { getAccountProfileById } from '../accountManager';
import { launchBrowser, closeBrowser, checkLogin } from '../browser';
import { awaitManualLogin, blockUserInput } from '../browser/humanBehavior';
import { enableWindowClickThrough, disableWindowClickThrough, cleanupWindowClickThrough } from '../browser/windowInputBlock';
import { runSalesNavBulkSave } from '../salesnav/bulkSaveOrchestrator';
import type { SalesNavBulkSaveReport } from '../salesnav/bulkSaveOrchestrator';
import { runSalesNavigatorListSync, formatFinalReport } from '../core/salesNavigatorSync';
import { getAutomationPauseState, getRuntimeFlag } from '../core/repositories';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport, sendWorkflowTelegramReport } from './reportFormatter';
import type { PreflightDbStats, PreflightConfigStatus, PreflightWarning, WorkflowReport } from './types';

export interface SyncSearchOptions {
    searchName?: string;
    listName?: string;
    maxPages?: number;
    limit?: number;
    enrichment?: boolean;
    dryRun?: boolean;
    accountId?: string;
    noProxy?: boolean;
    skipPreflight?: boolean;
}

function generateWarnings(
    stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    const targetList = answers['list'];

    if (!cfgStatus.proxyConfigured) {
        warnings.push({ level: 'critical', message: 'Nessun proxy configurato — connessione diretta su SalesNav (rischio detection ALTO)' });
    }
    if (targetList && stats.byList[targetList]) {
        warnings.push({ level: 'info', message: `Lista "${targetList}" ha gia\' ${stats.byList[targetList]} lead — i duplicati saranno skippati` });
    }

    return warnings;
}

export async function runSyncSearchWorkflow(opts: SyncSearchOptions): Promise<void> {
    const startedAt = new Date();

    // Pre-flight (6 livelli di controllo)
    const preflight = await runPreflight({
        workflowName: 'sync-search',
        questions: [
            {
                id: 'searchName',
                prompt: 'Nome della ricerca salvata (lascia vuoto per tutte le ricerche)?',
                type: 'string',
                defaultValue: opts.searchName ?? '',
            },
            {
                id: 'listName',
                prompt: 'In quale lista vuoi salvare i risultati?',
                type: 'string',
                defaultValue: opts.listName ?? config.salesNavSyncListName ?? 'Default',
                required: true,
            },
            {
                id: 'maxPages',
                prompt: 'Quante pagine di ricerca scorrere (max)?',
                type: 'number',
                defaultValue: String(opts.maxPages ?? config.salesNavSyncMaxPages),
            },
            {
                id: 'limit',
                prompt: 'Limite lead da salvare in totale?',
                type: 'number',
                defaultValue: String(opts.limit ?? config.salesNavSyncLimit),
            },
            {
                id: 'enrichment',
                prompt: 'Eseguire enrichment e scoring (Apollo/Hunter/AI) alla fine?',
                type: 'boolean',
                defaultValue: opts.enrichment === false ? 'false' : 'true',
            },
        ],
        generateWarnings,
        skipPreflight: opts.skipPreflight,
        cliOverrides: buildCliOverrides(opts),
        cliAccountId: opts.accountId,
    });

    if (!preflight.confirmed) {
        console.log('\n  Operazione annullata.\n');
        return;
    }

    const searchName = preflight.answers['searchName'] || undefined;
    const targetList = preflight.answers['listName'];
    const maxPages = parseInt(preflight.answers['maxPages'] || '10', 10);
    const limit = parseInt(preflight.answers['limit'] || '100', 10);
    const enrichment = preflight.answers['enrichment'] !== 'false';
    const dryRun = opts.dryRun ?? false;
    const accountId = preflight.selectedAccountId ?? opts.accountId ?? config.salesNavSyncAccountId;
    const account = getAccountProfileById(accountId || undefined);

    // ── Guard: quarantina e pausa ─────────────────────────────────────────────
    const quarantine = (await getRuntimeFlag('account_quarantine')) === 'true';
    if (quarantine) {
        console.error('\n  [BLOCCATO] Account in quarantina — operazione annullata. Esegui "bot unquarantine" dopo aver risolto il problema.\n');
        return;
    }
    const pauseState = await getAutomationPauseState();
    if (pauseState.paused) {
        console.error(`\n  [BLOCCATO] Automazione in pausa: ${pauseState.reason ?? 'motivo sconosciuto'}. Riprendi con "bot resume".\n`);
        return;
    }

    // ── Working hours warning ──────────────────────────────────────────────────
    if (!isWorkingHour()) {
        console.warn('  [WARN] Fuori orario lavorativo — procedere con cautela.\n');
    }

    // ── Stima tempo ─────────────────────────────────────────────────────────────
    const estimatedMinutes = Math.ceil((90 + maxPages * 20) / 60); // ~90s warmup + ~20s/pagina
    console.log(`\n  Tempo stimato: ~${estimatedMinutes} minuti per ${maxPages} pagine per ricerca\n`);

    // Step 1: Launch browser and run bulk save
    console.log('  Avvio bulk save da ricerche salvate...\n');

    const session = await launchBrowser({
        headless: config.headless,
        sessionDir: account.sessionDir,
        proxy: opts.noProxy ? undefined : account.proxy,
        bypassProxy: opts.noProxy,
        forceDesktop: true,
    });

    let bulkReport: SalesNavBulkSaveReport | null = null;
    let syncInserted = 0;
    let syncUpdated = 0;
    let syncEnriched = 0;
    let syncPromoted = 0;
    let syncError: string | null = null;

    try {
        let loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            loggedIn = await awaitManualLogin(session.page, 'sync-search');
            if (!loggedIn) {
                console.error('\n  [ERRORE] Login non completato.\n');
                return;
            }
        }

        // Blocca input SUBITO dopo il login — protegge anche il warmup da interferenze utente.
        // Il mouse dell'utente non deve mai raggiungere il browser durante l'automazione.
        // Livello 1 (OS): WS_EX_TRANSPARENT — finestra click-through, mouse passa sotto
        // Livello 2 (JS): overlay DOM + listener capture — backup se Win32 fallisce
        enableWindowClickThrough(session.browser);
        process.on('exit', cleanupWindowClickThrough);
        await blockUserInput(session.page);

        // Warmup sessione: simula navigazione umana (feed, notifiche) prima del bulk save.
        // Un umano reale non apre LinkedIn e va SUBITO su SalesNav — prima guarda il feed.
        try {
            const { warmupSession } = await import('../core/sessionWarmer');
            console.log('  Warmup sessione in corso...\n');
            await warmupSession(session.page);
            // Re-inject overlay dopo warmup (page.goto distrugge il DOM)
            await blockUserInput(session.page);
        } catch (warmupErr) {
            console.warn(`  [WARN] Warmup fallito: ${warmupErr instanceof Error ? warmupErr.message : String(warmupErr)}`);
        }

        // Checkpoint/Resume (4.1): resume=true abilita il ripristino dall'ultimo
        // checkpoint se un run precedente è stato interrotto (crash, challenge, timeout).
        // Evita di rifare page view già completate → meno traffico LinkedIn.
        bulkReport = await runSalesNavBulkSave(session.page, {
            accountId: account.id,
            targetListName: targetList,
            maxPages,
            searchName,
            dryRun,
            sessionLimit: limit,
            resume: true,
        });

        console.log(`\n  Bulk save completato: ${bulkReport.searchesDiscovered} ricerche trovate`);

        // Step 2: Sync the target list (enrichment + scoring + cloud)
        // Riusa lo STESSO browser — un umano non chiude e riapre il browser tra un'operazione e l'altra
        if (!dryRun && bulkReport && bulkReport.status !== 'FAILED') {
            console.log(`\n  Avvio sync lista "${targetList}" per enrichment...\n`);

            try {
                const syncReport = await runSalesNavigatorListSync({
                    listName: targetList,
                    maxPages,
                    maxLeadsPerList: limit,
                    dryRun: false,
                    accountId,
                    interactive: false,
                    skipEnrichment: !enrichment,
                    noProxy: opts.noProxy,
                    existingSession: session,
                });
                syncInserted = syncReport.inserted;
                syncUpdated = syncReport.updated;
                syncEnriched = syncReport.enrichment.enriched;
                syncPromoted = syncReport.enrichment.promoted;

                console.log(formatFinalReport(syncReport));
            } catch (err) {
                syncError = err instanceof Error ? err.message : String(err);
                console.error(`\n  [ERRORE] Sync lista fallito: ${syncError}\n`);
            }
        }
    } finally {
        disableWindowClickThrough(session.browser);
        await closeBrowser(session);
    }

    // Report
    const errors: string[] = [];
    if (bulkReport?.status === 'FAILED') errors.push('Bulk save fallito');
    if (syncError) errors.push(`Sync lista: ${syncError}`);

    const workflowReport: WorkflowReport = {
        workflow: 'sync-search',
        startedAt,
        finishedAt: new Date(),
        success: !!bulkReport && bulkReport.status !== 'FAILED' && !syncError,
        summary: {
            ricerca: searchName || '(tutte)',
            lista_target: targetList,
            ricerche_trovate: bulkReport?.searchesDiscovered ?? 0,
            lead_inseriti: syncInserted,
            lead_aggiornati: syncUpdated,
            enrichment_completati: syncEnriched,
            promossi_ready_invite: syncPromoted,
            challenge: bulkReport?.challengeDetected ? 'SI' : 'no',
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors,
        nextAction: syncPromoted > 0
            ? `Esegui 'send-invites --list "${targetList}"' per invitare i ${syncPromoted} lead pronti`
            : `Esegui 'send-invites --list "${targetList}"' per invitare i nuovi lead`,
        riskAssessment: preflight.riskAssessment,
    };

    console.log(formatWorkflowReport(workflowReport));
    await sendWorkflowTelegramReport(workflowReport);
}

function buildCliOverrides(opts: SyncSearchOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.searchName) overrides['searchName'] = opts.searchName;
    if (opts.listName) overrides['listName'] = opts.listName;
    if (opts.maxPages !== null && opts.maxPages !== undefined) overrides['maxPages'] = String(opts.maxPages);
    if (opts.enrichment === false) overrides['enrichment'] = 'false';
    return overrides;
}
