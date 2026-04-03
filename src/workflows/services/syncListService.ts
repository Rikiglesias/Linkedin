import { config } from '../../config';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import { evaluateWorkflowEntryGuards } from '../../core/workflowEntryGuards';
import { runPreflight } from '../preflight';
import { appendProxyReputationWarning } from '../preflight/configInspector';
import type {
    PreflightConfigStatus,
    PreflightDbStats,
    PreflightWarning,
    SyncListWorkflowRequest,
    WorkflowExecutionResult,
    WorkflowReport,
} from '../types';
import {
    buildBlockedResult,
    buildPreflightBlockedResult,
    buildResultFromReport,
    buildWorkflowArtifacts,
    estimateExecutionMinutes,
} from './shared';

interface SyncListPreflightAnswers {
    listName: string;
    listUrl: string;
    maxPages: number;
    maxLeads: number;
    enrichment: boolean;
    _accountId?: string;
}

function generateWarnings(
    _stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    _answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    if (!cfgStatus.proxyConfigured) {
        warnings.push({
            level: 'critical',
            message: 'Nessun proxy configurato — connessione diretta su SalesNav (rischio detection ALTO)',
        });
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

function buildCliOverrides(request: Omit<SyncListWorkflowRequest, 'workflow'>): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (request.maxPages !== null && request.maxPages !== undefined) overrides['maxPages'] = String(request.maxPages);
    if (request.enrichment === false) overrides['enrichment'] = 'false';
    return overrides;
}

export async function executeSyncListWorkflow(
    request: Omit<SyncListWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();
    const preflight = await runPreflight<SyncListPreflightAnswers>({
        workflowName: 'sync-list',
        questions: [
            {
                id: 'listName',
                prompt: 'Nome della lista SalesNav da sincronizzare?',
                type: 'string',
                defaultValue: request.listName ?? config.salesNavSyncListName ?? 'Default',
                required: true,
            },
            {
                id: 'listUrl',
                prompt: 'URL della lista SalesNav (opzionale, premi INVIO per skippare)?',
                type: 'string',
                defaultValue: request.listUrl ?? '',
            },
            {
                id: 'maxPages',
                prompt: 'Quante pagine vuoi scorrere? (0 = tutte)',
                type: 'number',
                defaultValue: String(request.maxPages ?? config.salesNavSyncMaxPages),
            },
            {
                id: 'maxLeads',
                prompt: 'Limite massimo di lead da sincronizzare? (0 = tutti)',
                type: 'number',
                defaultValue: String(request.maxLeads ?? config.salesNavSyncLimit),
            },
            {
                id: 'enrichment',
                prompt: 'Eseguire enrichment dati dopo il sync? (Apollo/Hunter/OSINT/scoring/cloud)',
                type: 'boolean',
                defaultValue: request.enrichment === false ? 'false' : 'true',
            },
        ],
        listFilter: request.listName,
        generateWarnings,
        skipPreflight: request.skipPreflight,
        cliOverrides: buildCliOverrides(request),
        cliAccountId: request.accountId,
        parseAnswers: (answers) => ({
            listName: answers['listName'] ?? config.salesNavSyncListName ?? 'Default',
            listUrl: answers['listUrl'] ?? '',
            maxPages: parseInt(answers['maxPages'] ?? String(config.salesNavSyncMaxPages), 10),
            maxLeads: parseInt(answers['maxLeads'] ?? String(config.salesNavSyncLimit), 10),
            enrichment: answers['enrichment'] !== 'false',
            _accountId: answers['_accountId'],
        }),
    });

    if (!preflight.confirmed) {
        return buildPreflightBlockedResult('sync-list', preflight);
    }

    const listName = preflight.answers.listName;
    const listUrl = preflight.answers.listUrl || undefined;
    const rawMaxPages = preflight.answers.maxPages;
    const rawMaxLeads = preflight.answers.maxLeads;
    const maxPages = rawMaxPages <= 0 ? 999 : rawMaxPages;
    const maxLeads = rawMaxLeads <= 0 ? 99999 : rawMaxLeads;
    const enrichment = preflight.answers.enrichment;

    const guardDecision = await evaluateWorkflowEntryGuards({
        workflow: 'sync-list',
        dryRun: request.dryRun ?? false,
        accountId: preflight.selectedAccountId ?? request.accountId,
    });
    if (!guardDecision.allowed && guardDecision.blocked) {
        return buildBlockedResult('sync-list', guardDecision.blocked, {
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                estimatedMinutes: estimateExecutionMinutes(request.dryRun ?? false, maxPages, 60, 15),
            }),
        });
    }

    let syncError: string | null = null;
    let report: Awaited<ReturnType<typeof runSalesNavigatorListSync>> | null = null;
    try {
        report = await runSalesNavigatorListSync({
            listName: listName || null,
            listUrl: listUrl || null,
            maxPages,
            maxLeadsPerList: maxLeads,
            dryRun: request.dryRun ?? false,
            accountId: preflight.selectedAccountId ?? request.accountId,
            interactive: request.interactive ?? false,
            noProxy: request.noProxy ?? false,
            skipEnrichment: !enrichment,
        });
    } catch (err) {
        syncError = err instanceof Error ? err.message : String(err);
    }

    if (syncError) {
        return buildBlockedResult('sync-list', {
            reason: 'WORKFLOW_ERROR',
            message: syncError,
        }, {
            errors: [syncError],
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                estimatedMinutes: estimateExecutionMinutes(request.dryRun ?? false, maxPages, 60, 15),
            }),
        });
    }

    if (!report) {
        return buildBlockedResult('sync-list', {
            reason: 'WORKFLOW_ERROR',
            message: 'runSalesNavigatorListSync non ha prodotto un report',
        }, {
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({ preflight }),
        });
    }

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
        nextAction:
            report.enrichment.promoted > 0
                ? `Step 3/4: esegui 'send-invites --list "${listName}"' per invitare i ${report.enrichment.promoted} lead pronti`
                : 'Nessun lead promosso. Attendi enrichment o abbassa la soglia score',
        riskAssessment: preflight.riskAssessment,
    };

    return buildResultFromReport('sync-list', workflowReport, {
        ...buildWorkflowArtifacts({
            preflight,
            estimatedMinutes: estimateExecutionMinutes(request.dryRun ?? false, maxPages, 60, 15),
            extra: { syncReport: report },
        }),
    });
}
