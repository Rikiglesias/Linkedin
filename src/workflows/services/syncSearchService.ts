import { config } from '../../config';
import { getAccountProfileById } from '../../accountManager';
import { awaitManualLogin, blockUserInput } from '../../browser/humanBehavior';
import { closeBrowser, launchBrowser, checkLogin } from '../../browser';
import { releaseRuntimeLock, getRuntimeFlag, setRuntimeFlag } from '../../core/repositories';
import { getAccountAgeDays } from '../../core/repositories/stats';
import {
    cleanupWindowClickThrough,
    disableWindowClickThrough,
    enableWindowClickThrough,
} from '../../browser/windowInputBlock';
import { runSalesNavBulkSave } from '../../salesnav/bulkSaveOrchestrator';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import { listSalesNavLists } from '../../core/repositories/leadsCore';
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

/**
 * Default INTELLIGENTE della lista DESTINAZIONE (dove salvare i lead estratti dalla ricerca):
 * la lista reale usata piu' di recente (last_synced_at), invece del fantasma 'Default'.
 *   - listName esplicito da CLI -> rispetta la scelta
 *   - >=1 lista in DB           -> la piu' recentemente sincronizzata (fallback: la prima esistente)
 *   - 0 liste                   -> '' (l'utente digita il nome; verra' creata)
 * NB: a differenza di sync-list (sorgente, dove vuoto = "tutte"), qui serve UNA destinazione.
 */
async function buildDestinationListDefault(request: Omit<SyncSearchWorkflowRequest, 'workflow'>): Promise<string> {
    if (request.listName) return request.listName;
    const lists = await listSalesNavLists().catch(() => []);
    if (lists.length === 0) return '';
    const mostRecent = lists
        .filter((l) => l.last_synced_at)
        .sort((a, b) => String(b.last_synced_at).localeCompare(String(a.last_synced_at)))[0];
    return (mostRecent ?? lists[0]).name;
}

export async function executeSyncSearchWorkflow(
    request: Omit<SyncSearchWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();

    // Destinazione derivata dallo stato reale (vedi buildDestinationListDefault) invece del fantasma 'Default'.
    const destinationDefault = await buildDestinationListDefault(request);
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
                defaultValue: destinationDefault,
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
            listName: answers['listName'] ?? destinationDefault,
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
        noProxy: request.noProxy ?? false,
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
            // H25: passa il timestamp di fine ultima sessione → se < 30min fa, warmup RIDOTTO
            // (un umano che riapre LinkedIn dopo pochi minuti non riscorre feed+notifiche da capo).
            // Chiave coerente con salesNavigatorSync (browser_session_ended_at), scritta nel finally sotto.
            const lastSessionEndedAt = await getRuntimeFlag(`browser_session_ended_at:${account.id}`).catch(
                () => null,
            );
            // T2b: warmup condizionale — fuori orario o rischio CAUTION/STOP → feed-only;
            // account nuovo → feed garantito. Riusa risk/età/timezone già disponibili.
            const accountAgeDays = await getAccountAgeDays().catch(() => undefined);
            await warmupSession(session.page, lastSessionEndedAt, {
                riskLevel: preflight.riskAssessment?.level,
                accountAgeDays,
                accountTimezone: account.timezone,
                respectWorkingHours: true,
            });
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
        // H25: registra la fine sessione → la prossima run sync-search legge questo flag e fa
        // warmup ridotto se < 30min (pattern identico a salesNavigatorSync.closeOwnedBrowser:799).
        await setRuntimeFlag(`browser_session_ended_at:${account.id}`, new Date().toISOString()).catch(() => null);
        // F1: rilascia il lock anti-concorrenza per-account acquisito dal guard (se presente).
        if (guardDecision.accountLock) {
            await releaseRuntimeLock(guardDecision.accountLock.lockKey, guardDecision.accountLock.ownerId);
        }
    }

    const errors: string[] = [];
    if (bulkReport?.status === 'FAILED') errors.push('Bulk save fallito');
    if (syncError) errors.push(`Sync lista: ${syncError}`);
    // T5: rompe il silent-failure DOM-drift — syncReport.errors aggrega anche scrapeDegraded
    // (salesNavigatorSync:1096, lista NON marcata synced su cambio DOM). Senza questo, un drift
    // restava silenzioso e success=true. WHAT/WHY/DO per l'alert Telegram (reportFormatter critical).
    if (syncReport && syncReport.errors > 0) {
        errors.push(
            `Sync lista SalesNav: ${syncReport.errors} errori durante scrape/upsert ` +
                `(possibile DOM-drift / cambio selettori SalesNav). DO: verifica i selettori lista su SalesNav reale.`,
        );
    }

    // sync-search è scraping/sync DB: l'orario NON è un rischio anti-ban (nessuna azione inviata a
    // LinkedIn) → niente errore "fuori orario". Il working-hours guard resta attivo per l'outreach
    // (workflowEntryGuards), che è l'attività sensibile all'orario.

    const workflowReport: WorkflowReport = {
        workflow: 'sync-search',
        startedAt,
        finishedAt: new Date(),
        // T5: errori interni del sync (incl. DOM-drift/scrapeDegraded) NON devono più essere
        // mascherati come success → severity Telegram critical (reportFormatter:169).
        success: !!bulkReport && bulkReport.status !== 'FAILED' && !syncError && (syncReport?.errors ?? 0) === 0,
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
