import { config, isWorkingHour } from '../../config';
import { getAccountProfileById } from '../../accountManager';
import { awaitManualLogin, blockUserInput } from '../../browser/humanBehavior';
import { closeBrowser, launchBrowser, checkLogin } from '../../browser';
import {
    cleanupWindowClickThrough,
    disableWindowClickThrough,
    enableWindowClickThrough,
} from '../../browser/windowInputBlock';
import { runSalesNavBulkSave } from '../../salesnav/bulkSaveOrchestrator';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import { evaluateWorkflowEntryGuards } from '../../core/workflowEntryGuards';
import { runPreflight } from '../preflight';
import { appendProxyReputationWarning } from '../preflight/configInspector';
import type {
    PreflightConfigStatus,
    PreflightDbStats,
    PreflightWarning,
    SyncSearchWorkflowRequest,
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

interface SyncSearchPreflightAnswers {
    searchName: string;
    listName: string;
    maxPages: number;
    limit: number;
    enrichment: boolean;
    _accountId?: string;
}

function generateWarnings(
    stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    const targetList = answers['listName'];
    if (!cfgStatus.proxyConfigured) {
        warnings.push({
            level: 'critical',
            message: 'Nessun proxy configurato — connessione diretta su SalesNav (rischio detection ALTO)',
        });
    }
    if (targetList && stats.byList[targetList]) {
        warnings.push({
            level: 'info',
            message: `Lista "${targetList}" ha gia' ${stats.byList[targetList]} lead — i duplicati saranno skippati`,
        });
    }

    return warnings;
}

function buildCliOverrides(request: Omit<SyncSearchWorkflowRequest, 'workflow'>): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (request.searchName) overrides['searchName'] = request.searchName;
    if (request.listName) overrides['listName'] = request.listName;
    if (request.maxPages !== null && request.maxPages !== undefined) overrides['maxPages'] = String(request.maxPages);
    if (request.enrichment === false) overrides['enrichment'] = 'false';
    return overrides;
}

export async function executeSyncSearchWorkflow(
    request: Omit<SyncSearchWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();

    const preflight = await runPreflight<SyncSearchPreflightAnswers>({
        workflowName: 'sync-search',
        questions: [
            {
                id: 'searchName',
                prompt: 'Nome della ricerca salvata (lascia vuoto per tutte le ricerche)?',
                type: 'string',
                defaultValue: request.searchName ?? '',
            },
            {
                id: 'listName',
                prompt: 'In quale lista vuoi salvare i risultati?',
                type: 'string',
                defaultValue: request.listName ?? config.salesNavSyncListName ?? 'Default',
                required: true,
            },
            {
                id: 'maxPages',
                prompt: 'Quante pagine di ricerca scorrere (max)?',
                type: 'number',
                defaultValue: String(request.maxPages ?? config.salesNavSyncMaxPages),
            },
            {
                id: 'limit',
                prompt: 'Limite lead da salvare in totale?',
                type: 'number',
                defaultValue: String(request.limit ?? config.salesNavSyncLimit),
            },
            {
                id: 'enrichment',
                prompt: 'Eseguire enrichment e scoring (Apollo/Hunter/AI) alla fine?',
                type: 'boolean',
                defaultValue: request.enrichment === false ? 'false' : 'true',
            },
        ],
        generateWarnings,
        skipPreflight: request.skipPreflight,
        cliOverrides: buildCliOverrides(request),
        cliAccountId: request.accountId,
        parseAnswers: (answers) => ({
            searchName: answers['searchName'] ?? '',
            listName: answers['listName'] ?? config.salesNavSyncListName ?? 'Default',
            maxPages: parseInt(answers['maxPages'] ?? String(config.salesNavSyncMaxPages), 10),
            limit: parseInt(answers['limit'] ?? String(config.salesNavSyncLimit), 10),
            enrichment: answers['enrichment'] !== 'false',
            _accountId: answers['_accountId'],
        }),
    });

    if (!preflight.confirmed) {
        return buildPreflightBlockedResult('sync-search', preflight);
    }

    const searchName = preflight.answers.searchName || undefined;
    const targetList = preflight.answers.listName;
    const maxPages = preflight.answers.maxPages;
    const limit = preflight.answers.limit;
    const enrichment = preflight.answers.enrichment;
    const dryRun = request.dryRun ?? false;
    const accountId = preflight.selectedAccountId ?? request.accountId ?? config.salesNavSyncAccountId;
    const account = getAccountProfileById(accountId || undefined);

    const guardDecision = await evaluateWorkflowEntryGuards({
        workflow: 'sync-search',
        dryRun,
        accountId,
    });
    if (!guardDecision.allowed && guardDecision.blocked) {
        return buildBlockedResult('sync-search', guardDecision.blocked, {
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                estimatedMinutes: estimateExecutionMinutes(dryRun, maxPages, 90, 20),
            }),
        });
    }

    let bulkReport: Awaited<ReturnType<typeof runSalesNavBulkSave>> | null = null;
    let syncReport: Awaited<ReturnType<typeof runSalesNavigatorListSync>> | null = null;
    let syncInserted = 0;
    let syncUpdated = 0;
    let syncEnriched = 0;
    let syncPromoted = 0;
    let syncError: string | null = null;

    const session = await launchBrowser({
        headless: config.headless,
        sessionDir: account.sessionDir,
        proxy: request.noProxy ? undefined : account.proxy,
        bypassProxy: request.noProxy,
        forceDesktop: true,
    });
    const exitCleanupHandler = () => cleanupWindowClickThrough();

    try {
        let loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            loggedIn = await awaitManualLogin(session.page, 'sync-search');
            if (!loggedIn) {
                return buildBlockedResult('sync-search', {
                    reason: 'LOGIN_REQUIRED',
                    message: 'Login LinkedIn non completato',
                }, {
                    riskAssessment: preflight.riskAssessment,
                    artifacts: buildWorkflowArtifacts({
                        preflight,
                        estimatedMinutes: estimateExecutionMinutes(dryRun, maxPages, 90, 20),
                    }),
                });
            }
        }

        enableWindowClickThrough(session.browser);
        process.on('exit', exitCleanupHandler);
        await blockUserInput(session.page);

        try {
            const { warmupSession } = await import('../../core/sessionWarmer');
            await warmupSession(session.page);
            await blockUserInput(session.page);
        } catch {
            // best-effort
        }

        bulkReport = await runSalesNavBulkSave(session.page, {
            accountId: account.id,
            targetListName: targetList,
            maxPages,
            searchName,
            dryRun,
            sessionLimit: limit,
            resume: true,
        });

        if (!dryRun && bulkReport && bulkReport.status !== 'FAILED') {
            try {
                syncReport = await runSalesNavigatorListSync({
                    listName: targetList,
                    maxPages,
                    maxLeadsPerList: limit,
                    dryRun: false,
                    accountId,
                    interactive: false,
                    skipEnrichment: !enrichment,
                    noProxy: request.noProxy,
                    existingSession: session,
                });
                syncInserted = syncReport.inserted;
                syncUpdated = syncReport.updated;
                syncEnriched = syncReport.enrichment.enriched;
                syncPromoted = syncReport.enrichment.promoted;
            } catch (err) {
                syncError = err instanceof Error ? err.message : String(err);
            }
        }
    } finally {
        process.off('exit', exitCleanupHandler);
        disableWindowClickThrough(session.browser);
        await closeBrowser(session);
    }

    const errors: string[] = [];
    if (bulkReport?.status === 'FAILED') errors.push('Bulk save fallito');
    if (syncError) errors.push(`Sync lista: ${syncError}`);

    if (!isWorkingHour()) {
        errors.push('Workflow avviato fuori orario lavorativo');
    }

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
        nextAction:
            syncPromoted > 0
                ? `Step 3/4: esegui 'send-invites --list "${targetList}"' per invitare i ${syncPromoted} lead pronti`
                : syncInserted > 0
                  ? `Step 3/4: esegui 'send-invites --list "${targetList}"' per invitare i nuovi lead`
                  : 'Nessun lead nuovo. Prova una ricerca diversa o attendi nuovi risultati',
        riskAssessment: preflight.riskAssessment,
    };

    return buildResultFromReport('sync-search', workflowReport, {
        ...buildWorkflowArtifacts({
            preflight,
            estimatedMinutes: estimateExecutionMinutes(dryRun, maxPages, 90, 20),
            extra: {
                bulkReport,
                syncReport,
                syncError,
                syncInserted,
                syncUpdated,
                syncEnriched,
                syncPromoted,
            },
        }),
    });
}
