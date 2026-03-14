/**
 * Workflow 2: sync-search — Ricerche salvate SalesNav → lista → DB + enrichment
 */

import { config } from '../config';
import { getAccountProfileById } from '../accountManager';
import { launchBrowser, closeBrowser, checkLogin } from '../browser';
import { runSalesNavBulkSave } from '../salesnav/bulkSaveOrchestrator';
import type { SalesNavBulkSaveReport } from '../salesnav/bulkSaveOrchestrator';
import { runSalesNavigatorListSync, formatFinalReport } from '../core/salesNavigatorSync';
import { getAutomationPauseState, getRuntimeFlag } from '../core/repositories';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport } from './reportFormatter';
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

    // Pre-flight
    const preflight = await runPreflight({
        workflowName: 'sync-search',
        questions: [
            {
                id: 'searchName',
                prompt: 'Ricerche salvate (vuoto = tutte, oppure nomi separati da virgola)',
                type: 'string',
                defaultValue: opts.searchName ?? '',
            },
            {
                id: 'list',
                prompt: 'Nome della lista target dove aggiungere i nuovi lead',
                type: 'string',
                defaultValue: opts.listName ?? config.salesNavSyncListName ?? '',
                required: true,
            },
            {
                id: 'maxPages',
                prompt: 'Pagine massime per ricerca?',
                type: 'number',
                defaultValue: String(opts.maxPages ?? 10),
            },
            {
                id: 'limit',
                prompt: 'Limite lead da aggiungere?',
                type: 'number',
                defaultValue: String(opts.limit ?? 100),
            },
            {
                id: 'enrichment',
                prompt: 'Vuoi enrichment profondo?',
                type: 'boolean',
                defaultValue: opts.enrichment !== false ? 'true' : 'false',
            },
        ],
        listFilter: opts.listName,
        generateWarnings,
        skipPreflight: opts.skipPreflight,
        cliOverrides: buildCliOverrides(opts),
    });

    if (!preflight.confirmed) {
        console.log('\n  Operazione annullata.\n');
        return;
    }

    const searchName = preflight.answers['searchName'] || null;
    const targetList = preflight.answers['list'];
    const maxPages = parseInt(preflight.answers['maxPages'] || '10', 10);
    const limit = parseInt(preflight.answers['limit'] || '100', 10);
    const dryRun = opts.dryRun ?? false;
    const accountId = opts.accountId ?? config.salesNavSyncAccountId;
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

    // Step 1: Launch browser and run bulk save
    console.log('\n  Avvio bulk save da ricerche salvate...\n');

    const session = await launchBrowser({
        headless: false,
        sessionDir: account.sessionDir,
        proxy: opts.noProxy ? undefined : account.proxy,
        bypassProxy: opts.noProxy,
        forceDesktop: true,
    });

    let bulkReport: SalesNavBulkSaveReport | null = null;
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            console.error('[ERRORE] Sessione non autenticata. Esegui prima "login".');
            return;
        }

        // Input block: NON bloccare qui — SalesNav può richiedere login manuale separato.
        // Il blocco input viene attivato dentro bulkSaveOrchestrator.reInjectOverlays()
        // DOPO che la navigazione SalesNav è completata e il login confermato.

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
    } finally {
        await closeBrowser(session);
    }

    // Step 2: Sync the target list (enrichment + scoring + cloud)
    let syncInserted = 0;
    let syncUpdated = 0;
    let syncEnriched = 0;
    let syncPromoted = 0;
    let syncError: string | null = null;
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
    };

    console.log(formatWorkflowReport(workflowReport));
}

function buildCliOverrides(opts: SyncSearchOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.searchName) overrides['searchName'] = opts.searchName;
    if (opts.listName) overrides['list'] = opts.listName;
    if (opts.maxPages !== null && opts.maxPages !== undefined) overrides['maxPages'] = String(opts.maxPages);
    if (opts.limit !== null && opts.limit !== undefined) overrides['limit'] = String(opts.limit);
    if (opts.enrichment !== null && opts.enrichment !== undefined) overrides['enrichment'] = String(opts.enrichment);
    if (opts.dryRun !== null && opts.dryRun !== undefined) overrides['dryRun'] = String(opts.dryRun);
    return overrides;
}
