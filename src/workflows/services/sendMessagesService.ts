import { config, getLocalDateString } from '../../config';
import { getDatabase } from '../../db';
import { runWorkflow } from '../../core/orchestrator';
import {
    computeListPerformanceMultiplier,
    getDailyStat,
    getListDailyStatsBatch,
} from '../../core/repositories';
import { enrichLeadsParallel } from '../../integrations/parallelEnricher';
import { runPreflight } from '../preflight';
import type {
    PreflightConfigStatus,
    PreflightDbStats,
    PreflightWarning,
    SendMessagesWorkflowRequest,
    WorkflowExecutionResult,
    WorkflowPreviewLead,
    WorkflowReport,
    WorkflowReportListBreakdown,
} from '../types';
import { appendProxyReputationWarning } from '../preflight/configInspector';
import {
    buildBlockedResult,
    buildPreflightBlockedResult,
    buildResultFromReport,
    buildWorkflowArtifacts,
    estimateExecutionMinutes,
} from './shared';

interface SendMessagesPreflightAnswers {
    listName: string;
    limit: number;
    messageMode: 'ai' | 'template';
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

    const accepted = (stats.byStatus['ACCEPTED'] ?? 0) + (stats.byStatus['READY_MESSAGE'] ?? 0);
    if (accepted === 0) {
        const listNote = answers['listName']
            ? ` (conteggio globale — la lista "${answers['listName']}" potrebbe avere lead messaggiabili)`
            : '';
        warnings.push({
            level: 'critical',
            message: `Nessun lead ACCEPTED/READY_MESSAGE trovato${listNote} — nulla da messaggiare`,
        });
    }

    const remaining = cfgStatus.budgetMessages - cfgStatus.messagesSentToday;
    if (remaining <= 0) {
        warnings.push({
            level: 'critical',
            message: `Budget messaggi esaurito oggi (${cfgStatus.messagesSentToday}/${cfgStatus.budgetMessages})`,
        });
    } else if (remaining < 5) {
        warnings.push({ level: 'warn', message: `Budget messaggi quasi esaurito: ${remaining} rimanenti` });
    }

    if (!cfgStatus.aiConfigured) {
        warnings.push({ level: 'warn', message: 'AI non configurata — messaggi generici senza personalizzazione' });
    }

    const withoutJobTitle = stats.totalLeads - stats.withJobTitle;
    if (withoutJobTitle > 0 && accepted > 0) {
        const pct = Math.round((withoutJobTitle / stats.totalLeads) * 100);
        if (pct > 30) {
            warnings.push({
                level: 'info',
                message: `${withoutJobTitle} lead senza job_title (${pct}%) — messaggio generico per questi`,
            });
        }
    }

    if (stats.lastSyncAt) {
        const syncAgeMs = Date.now() - new Date(stats.lastSyncAt).getTime();
        const syncAgeDays = Math.floor(syncAgeMs / 86400000);
        if (syncAgeDays > 7) {
            warnings.push({
                level: 'warn',
                message: `Dati lead obsoleti: ultimo sync ${syncAgeDays} giorni fa — esegui sync-list prima.`,
            });
        }
    }

    return warnings;
}

function buildCliOverrides(request: Omit<SendMessagesWorkflowRequest, 'workflow'>): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (request.limit !== null && request.limit !== undefined) overrides['limit'] = String(request.limit);
    if (request.template) overrides['messageMode'] = 'template';
    if (request.skipEnrichment) overrides['enrichment'] = 'false';
    return overrides;
}

export async function executeSendMessagesWorkflow(
    request: Omit<SendMessagesWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();
    const localDate = getLocalDateString();
    const msgBefore = await getDailyStat(localDate, 'messages_sent').catch(() => 0);

    const preflight = await runPreflight<SendMessagesPreflightAnswers>({
        workflowName: 'send-messages',
        questions: [
            {
                id: 'listName',
                prompt: 'Quale lista vuoi targettare (lascia vuoto per targettare tutte)?',
                type: 'string',
                defaultValue: request.listName ?? '',
            },
            {
                id: 'limit',
                prompt: 'Quanti messaggi vuoi inviare al massimo?',
                type: 'number',
                defaultValue: String(request.limit ?? config.hardMsgCap),
            },
            {
                id: 'messageMode',
                prompt: 'Tipo messaggio?',
                type: 'choice',
                choices: ['template', 'ai'],
                defaultValue: request.template ? 'template' : config.aiPersonalizationEnabled ? 'ai' : 'template',
            },
            {
                id: 'enrichment',
                prompt: "Eseguire pre-enrichment dei lead prima dell'invio? (Apollo/Hunter/OSINT)",
                type: 'boolean',
                defaultValue: 'true',
            },
        ],
        listFilter: request.listName,
        generateWarnings,
        skipPreflight: request.skipPreflight,
        cliOverrides: buildCliOverrides(request),
        cliAccountId: request.accountId,
        parseAnswers: (answers) => ({
            listName: answers['listName'] ?? '',
            limit: parseInt(answers['limit'] ?? String(config.hardMsgCap), 10),
            messageMode: answers['messageMode'] === 'template' ? 'template' : 'ai',
            enrichment: answers['enrichment'] !== 'false',
            _accountId: answers['_accountId'],
        }),
    });

    if (!preflight.confirmed) {
        return buildPreflightBlockedResult('send-messages', preflight);
    }

    const listFilter = preflight.answers.listName || null;
    const dryRun = request.dryRun ?? false;
    const sessionLimit = preflight.answers.limit;
    const lang = request.lang || undefined;

    const readyCount =
        (preflight.dbStats.byStatus['ACCEPTED'] ?? 0) + (preflight.dbStats.byStatus['READY_MESSAGE'] ?? 0);

    let previewLeads: WorkflowPreviewLead[] = [];
    let previewMessage: { source: string; message: string } | null = null;
    if (readyCount > 0) {
        const db = await getDatabase();
        let previewQuery = `SELECT first_name, last_name, job_title, accepted_at FROM leads WHERE status IN ('ACCEPTED','READY_MESSAGE')`;
        const previewParams: unknown[] = [];
        if (listFilter) {
            previewQuery += ` AND list_name = ?`;
            previewParams.push(listFilter);
        }
        previewQuery += ` ORDER BY accepted_at ASC LIMIT 5`;
        const rows = await db.query<{
            first_name: string;
            last_name: string;
            job_title: string | null;
            accepted_at: string | null;
        }>(previewQuery, previewParams);
        previewLeads = rows.map((lead) => ({
            label: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'N/A',
            secondary: lead.job_title || 'N/A',
            tertiary: lead.accepted_at ? `acc: ${lead.accepted_at.slice(0, 10)}` : '',
        }));

        if (dryRun) {
            try {
                const { buildPersonalizedFollowUpMessage } = await import('../../ai/messagePersonalizer');
                const { getLeadById } = await import('../../core/repositories/leadsCore');
                const firstLeadRow = await db.get<{ id: number }>(
                    `SELECT id FROM leads WHERE status IN ('ACCEPTED','READY_MESSAGE')${listFilter ? ' AND list_name = ?' : ''} LIMIT 1`,
                    listFilter ? [listFilter] : [],
                );
                if (firstLeadRow) {
                    const sampleLead = await getLeadById(firstLeadRow.id);
                    if (sampleLead) {
                        const preview = await buildPersonalizedFollowUpMessage(sampleLead, lang);
                        previewMessage = {
                            source: preview.source,
                            message: preview.message,
                        };
                    }
                }
            } catch {
                previewMessage = null;
            }
        }
    }

    if (readyCount === 0) {
        return buildBlockedResult('send-messages', {
            reason: 'NO_WORK_AVAILABLE',
            message: 'Nessun lead ACCEPTED/READY_MESSAGE disponibile per questo run',
            details: { listName: listFilter },
        }, {
            summary: {
                lead_messaggiabili: readyCount,
                lista_target: listFilter,
            },
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                previewLeads,
                candidateCount: readyCount,
                extra: { previewMessage },
            }),
            nextAction: 'Attendi nuove accettazioni o verifica la lista target.',
        });
    }

    const effectiveLimit = sessionLimit > 0 ? Math.min(sessionLimit, readyCount) : readyCount;
    const estimatedMinutes = estimateExecutionMinutes(dryRun, effectiveLimit, 90, 60);

    let enrichmentDegraded = false;
    if (!dryRun && effectiveLimit > 0 && preflight.answers.enrichment) {
        try {
            const enrichReport = await enrichLeadsParallel({
                listName: listFilter || undefined,
                limit: effectiveLimit,
                concurrency: 5,
            });
            if (enrichReport.total > 5 && enrichReport.enriched / enrichReport.total < 0.2) {
                enrichmentDegraded = true;
            }
        } catch {
            enrichmentDegraded = true;
        }
    }

    let workflowError: string | null = null;
    const runOutcome = await runWorkflow({
        workflow: 'message',
        dryRun,
        listFilter: listFilter || undefined,
        sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
        lang,
        messageMode: preflight.answers.messageMode === 'template' ? 'template' : undefined,
        accountId: preflight.selectedAccountId ?? request.accountId,
    }).catch((err: unknown) => {
        workflowError = err instanceof Error ? err.message : String(err);
        return null;
    });

    let msgAfter = msgBefore;
    try {
        msgAfter = await getDailyStat(localDate, 'messages_sent');
    } catch {
        /* fallback */
    }
    const messagesSent = msgAfter - msgBefore;

    if (workflowError) {
        return buildBlockedResult('send-messages', {
            reason: 'WORKFLOW_ERROR',
            message: workflowError,
        }, {
            errors: [workflowError],
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                previewLeads,
                candidateCount: readyCount,
                estimatedMinutes,
                extra: { enrichmentDegraded, previewMessage },
            }),
        });
    }

    if (runOutcome && runOutcome.status === 'blocked' && runOutcome.blocked) {
        return buildBlockedResult('send-messages', runOutcome.blocked, {
            summary: {
                messaggi_inviati: messagesSent,
                budget_utilizzato: `${msgAfter}/${config.hardMsgCap}`,
                budget_rimanente: config.hardMsgCap - msgAfter,
                messaggio_modalita: preflight.answers.messageMode,
                template: request.template ?? null,
                dry_run: dryRun ? 'SI' : 'no',
            },
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                previewLeads,
                candidateCount: readyCount,
                estimatedMinutes,
                extra: { enrichmentDegraded, previewMessage },
            }),
        });
    }

    const listBreakdown: WorkflowReportListBreakdown[] = [];
    try {
        const listMessageStats = await getListDailyStatsBatch(localDate, 'messages_sent');
        const listInviteStats = await getListDailyStatsBatch(localDate, 'invites_sent');
        for (const [ln, msg] of listMessageStats) {
            const perf = await computeListPerformanceMultiplier(ln, 30);
            const inv = listInviteStats.get(ln) ?? 0;
            let flag: WorkflowReportListBreakdown['flag'] = null;
            if (perf.sampleSize >= 10 && perf.acceptanceRatePct < 10) flag = 'critical';
            else if (perf.sampleSize >= 10 && perf.acceptanceRatePct < 20) flag = 'underperforming';
            listBreakdown.push({
                listName: ln,
                invitesSent: inv,
                messagesSent: msg,
                acceptanceRatePct: perf.acceptanceRatePct,
                flag,
            });
        }
    } catch {
        // best-effort
    }

    const workflowReport: WorkflowReport = {
        workflow: 'send-messages',
        startedAt,
        finishedAt: new Date(),
        success: true,
        summary: {
            messaggi_inviati: messagesSent,
            budget_utilizzato: `${msgAfter}/${config.hardMsgCap}`,
            budget_rimanente: config.hardMsgCap - msgAfter,
            messaggio_modalita: preflight.answers.messageMode,
            template: request.template ?? null,
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors: [],
        nextAction:
            msgAfter >= config.hardMsgCap
                ? 'Budget messaggi esaurito — riprendi domani. Ciclo completo: sync-search → sync-list → send-invites → send-messages'
                : `Budget rimanente: ${config.hardMsgCap - msgAfter} messaggi. Prossimo ciclo: sync-search per nuovi lead`,
        listBreakdown,
        riskAssessment: preflight.riskAssessment,
    };

    return buildResultFromReport('send-messages', workflowReport, {
        ...buildWorkflowArtifacts({
            preflight,
            previewLeads,
            candidateCount: readyCount,
            estimatedMinutes,
            extra: { enrichmentDegraded, previewMessage },
        }),
    });
}
