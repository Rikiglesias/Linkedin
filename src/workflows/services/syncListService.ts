import { config } from '../../config';
import { closeBrowser } from '../../browser';
import { disableWindowClickThrough } from '../../browser/windowInputBlock';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import { listSalesNavLists } from '../../core/repositories/leadsCore';
import { evaluateWorkflowEntryGuards } from '../../core/workflowEntryGuards';
import { runPreflight } from '../preflight';
import { appendProxyReputationWarning } from '../preflight/configInspector';
import type {
    PreflightConfigStatus,
    PreflightDbStats,
    PreflightQuestion,
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

const ALL_LISTS_CHOICE = '(tutte le liste)';

/**
 * Selezione lista INTELLIGENTE: deriva la domanda dalle liste REALI gia' note al bot
 * (salesnav_lists), invece di un default cieco 'Default' (che non e' una lista esistente).
 *   - lista/URL esplicita da CLI -> rispetta la scelta dell'utente
 *   - 0 liste in DB              -> nessun default fantasma; INVIO = scopri/sincronizza tutte live
 *   - 1 lista                    -> quella, come default reale (nessuna scelta a vuoto)
 *   - >1 liste                   -> scelta tra le liste vere (+ "tutte"), tipo 'choice'
 */
async function buildListQuestion(
    request: Omit<SyncListWorkflowRequest, 'workflow'>,
): Promise<PreflightQuestion> {
    if (request.listName || request.listUrl) {
        return {
            id: 'listName',
            prompt: 'Nome della lista SalesNav da sincronizzare?',
            type: 'string',
            defaultValue: request.listName ?? '',
            required: false,
        };
    }
    const savedLists = await listSalesNavLists().catch(() => []);
    if (savedLists.length === 0) {
        return {
            id: 'listName',
            prompt: 'Nessuna lista in DB — INVIO per scoprire e sincronizzare TUTTE le liste su SalesNav',
            type: 'string',
            defaultValue: '',
            required: false,
        };
    }
    if (savedLists.length === 1) {
        return {
            id: 'listName',
            prompt: `Lista da sincronizzare (INVIO = "${savedLists[0].name}")`,
            type: 'string',
            defaultValue: savedLists[0].name,
            required: false,
        };
    }
    return {
        id: 'listName',
        prompt: 'Quale lista SalesNav vuoi sincronizzare?',
        type: 'choice',
        choices: [...savedLists.map((l) => l.name), ALL_LISTS_CHOICE],
        defaultValue: savedLists[0].name,
        required: false,
    };
}

/** '(tutte le liste)' -> '' (= nessun filtro: il sync scopre/sincronizza tutte le liste). */
function normalizeListChoice(value: string): string {
    return value.trim() === ALL_LISTS_CHOICE ? '' : value.trim();
}

export async function executeSyncListWorkflow(
    request: Omit<SyncListWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();

    // Lista derivata dallo stato reale (vedi buildListQuestion) invece del default cieco 'Default'.
    const listQuestion = await buildListQuestion(request);
    const preflight = await runPreflight<SyncListPreflightAnswers>({
        workflowName: 'sync-list',
        questions: [
            listQuestion,
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
            listName: normalizeListChoice(answers['listName'] ?? listQuestion.defaultValue ?? ''),
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
        noProxy: request.noProxy ?? false,
        // Riusa la sessione del canary nel sync (evita il 2° browser sullo stesso profilo = lock conflict).
        reuseSession: true,
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

    // Handoff: se il canary ha lasciato aperta la sessione dell'account operativo, il sync la RIUSA
    // (existingSession) invece di aprire un 2° browser sullo stesso profilo. In quel caso
    // runSalesNavigatorListSync NON chiude (ownsBrowser=false) → la chiude questo caller nel finally.
    const canarySession = guardDecision.session;
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
            existingSession: canarySession,
        });
    } catch (err) {
        syncError = err instanceof Error ? err.message : String(err);
    } finally {
        // Chiusura della sessione del canary riusata (il sync non la possiede). disable PRIMA di close
        // (pattern canonico). Se non c'è handoff (canarySession undefined) il sync ha già chiuso la sua.
        if (canarySession) {
            disableWindowClickThrough(canarySession.browser);
            await closeBrowser(canarySession);
        }
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
        // success veritiero: NON solo lo scraping/upsert core, ma anche enrichment e cloud sync.
        // Prima ignorava enrichment.errors/cloudErrors → success=true con cloud non sincronizzato.
        success:
            report.errors === 0 &&
            report.enrichment.errors === 0 &&
            report.enrichment.cloudErrors === 0 &&
            !report.challengeDetected,
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
        // errors[] veritiero: elenca TUTTI i tipi di errore (scraping/upsert, enrichment, cloud), non
        // solo il challenge. Così il report non tace fallimenti parziali (es. cloud non sincronizzato).
        errors: [
            ...(report.challengeDetected ? ['Challenge LinkedIn rilevato durante sync'] : []),
            ...(report.errors > 0 ? [`${report.errors} errori durante scraping/upsert delle liste`] : []),
            ...(report.enrichment.errors > 0 ? [`${report.enrichment.errors} errori durante l'enrichment`] : []),
            ...(report.enrichment.cloudErrors > 0
                ? [`${report.enrichment.cloudErrors} errori di sync cloud (Supabase) — retry via outbox`]
                : []),
        ],
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
