/**
 * Workflow 1: sync-list — Sync lista SalesNav → DB + enrichment + scoring + cloud sync
 */

import { config } from '../config';
import { runSalesNavigatorListSync, formatFinalReport } from '../core/salesNavigatorSync';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport } from './reportFormatter';
import type { PreflightDbStats, PreflightConfigStatus, PreflightWarning, WorkflowReport } from './types';

export interface SyncListOptions {
    listName?: string;
    listUrl?: string;
    maxPages?: number;
    maxLeads?: number;
    enrichment?: boolean;
    dryRun?: boolean;
    interactive?: boolean;
    accountId?: string;
    noProxy?: boolean;
    skipPreflight?: boolean;
}

function generateWarnings(
    _stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    _answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    if (!cfgStatus.proxyConfigured) {
        warnings.push({ level: 'warn', message: 'Nessun proxy configurato — connessione diretta (rischio detection)' });
    }
    if (!cfgStatus.apolloConfigured && !cfgStatus.hunterConfigured) {
        warnings.push({ level: 'info', message: 'Nessun API enrichment configurato (Apollo/Hunter) — solo OSINT' });
    }
    if (!cfgStatus.aiConfigured) {
        warnings.push({ level: 'warn', message: 'AI non configurata — nessun scoring/pulizia automatica' });
    }
    if (!cfgStatus.supabaseConfigured) {
        warnings.push({ level: 'info', message: 'Supabase non configurato — solo DB locale' });
    }

    return warnings;
}

export async function runSyncListWorkflow(opts: SyncListOptions): Promise<void> {
    const startedAt = new Date();

    // Pre-flight
    const preflight = await runPreflight({
        workflowName: 'sync-list',
        questions: [
            {
                id: 'list',
                prompt: 'Nome della lista SalesNav (o URL diretto)',
                type: 'string',
                defaultValue: opts.listName ?? config.salesNavSyncListName ?? '',
                required: true,
            },
            {
                id: 'maxPages',
                prompt: 'Quante pagine massimo scansionare?',
                type: 'number',
                defaultValue: String(opts.maxPages ?? config.salesNavSyncMaxPages),
            },
            {
                id: 'maxLeads',
                prompt: 'Limite lead massimi?',
                type: 'number',
                defaultValue: String(opts.maxLeads ?? config.salesNavSyncLimit),
            },
            {
                id: 'enrichment',
                prompt: 'Vuoi enrichment profondo (OSINT)?',
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

    const listName = preflight.answers['list'] || opts.listName;
    const listUrl = opts.listUrl;
    const maxPages = parseInt(preflight.answers['maxPages'] || '10', 10);
    const maxLeads = parseInt(preflight.answers['maxLeads'] || '500', 10);

    // Run the existing sync engine
    console.log('\n  Avvio sync lista...\n');

    const report = await runSalesNavigatorListSync({
        listName: listName || null,
        listUrl: listUrl || null,
        maxPages,
        maxLeadsPerList: maxLeads,
        dryRun: opts.dryRun ?? false,
        accountId: opts.accountId,
        interactive: opts.interactive ?? false,
        noProxy: opts.noProxy ?? false,
    });

    // Display the existing detailed report
    console.log(formatFinalReport(report));

    // Display workflow summary
    const workflowReport: WorkflowReport = {
        workflow: 'sync-list',
        startedAt,
        finishedAt: new Date(),
        success: report.errors === 0 && !report.challengeDetected,
        summary: {
            lista: listName || '(tutte)',
            pagine_visitate: report.pagesVisited,
            candidati_trovati: report.candidatesDiscovered,
            candidati_unici: report.uniqueCandidates,
            inseriti: report.inserted,
            aggiornati: report.updated,
            invariati: report.unchanged,
            errori: report.errors,
            enrichment_completati: report.enrichment.enriched,
            promossi_ready_invite: report.enrichment.promoted,
            cloud_sync: report.enrichment.cloudSynced,
        },
        errors: report.challengeDetected ? ['Challenge LinkedIn rilevato durante sync'] : [],
        nextAction: report.enrichment.promoted > 0
            ? `Esegui 'send-invites --list "${listName}"' per invitare i lead pronti`
            : 'Attendi enrichment o abbassa la soglia score',
    };

    console.log(formatWorkflowReport(workflowReport));
}

function buildCliOverrides(opts: SyncListOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.listName) overrides['list'] = opts.listName;
    if (opts.maxPages !== null && opts.maxPages !== undefined) overrides['maxPages'] = String(opts.maxPages);
    if (opts.maxLeads !== null && opts.maxLeads !== undefined) overrides['maxLeads'] = String(opts.maxLeads);
    if (opts.enrichment !== null && opts.enrichment !== undefined) overrides['enrichment'] = String(opts.enrichment);
    return overrides;
}
