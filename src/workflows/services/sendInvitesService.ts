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
    SendInvitesWorkflowRequest,
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

interface SendInvitesPreflightAnswers {
    listName: string;
    limit: number;
    noteMode: 'ai' | 'template' | 'none';
    enrichment: boolean;
    _accountId?: string;
}

async function getScoreStats(listName?: string | null, minScore?: number): Promise<{ min: number; max: number; avg: number; count: number }> {
    const db = await getDatabase();
    const params: unknown[] = [];
    let where = `status = 'READY_INVITE' AND lead_score IS NOT NULL`;
    if (listName) {
        where += ` AND list_name = ?`;
        params.push(listName);
    }
    if (minScore && minScore > 0) {
        where += ` AND lead_score >= ?`;
        params.push(minScore);
    }
    const row = await db.get<{ min_score: number; max_score: number; avg_score: number; cnt: number }>(
        `SELECT MIN(lead_score) as min_score, MAX(lead_score) as max_score, AVG(lead_score) as avg_score, COUNT(*) as cnt
         FROM leads WHERE ${where}`,
        params,
    );
    return {
        min: row?.min_score ?? 0,
        max: row?.max_score ?? 0,
        avg: Math.round(row?.avg_score ?? 0),
        count: row?.cnt ?? 0,
    };
}

function generateWarnings(
    stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    const readyInvite = stats.byStatus['READY_INVITE'] ?? 0;
    if (readyInvite === 0) {
        warnings.push({
            level: 'critical',
            message: 'Nessun lead READY_INVITE — esegui prima sync-list con enrichment',
        });
    }

    const remaining = cfgStatus.budgetInvites - cfgStatus.invitesSentToday;
    if (remaining <= 0) {
        warnings.push({
            level: 'critical',
            message: `Budget inviti esaurito oggi (${cfgStatus.invitesSentToday}/${cfgStatus.budgetInvites})`,
        });
    } else if (remaining < 5) {
        warnings.push({ level: 'warn', message: `Budget inviti quasi esaurito: ${remaining} rimanenti` });
    }

    const weeklyRemaining = cfgStatus.weeklyInviteLimit - cfgStatus.weeklyInvitesSent;
    if (weeklyRemaining <= 0) {
        warnings.push({
            level: 'critical',
            message: `Budget inviti SETTIMANALE esaurito (${cfgStatus.weeklyInvitesSent}/${cfgStatus.weeklyInviteLimit})`,
        });
    } else if (weeklyRemaining < 10) {
        warnings.push({
            level: 'warn',
            message: `Budget inviti settimanale quasi esaurito: ${weeklyRemaining} rimanenti su ${cfgStatus.weeklyInviteLimit}`,
        });
    }

    if (cfgStatus.warmupEnabled) {
        warnings.push({ level: 'info', message: 'Account in fase warmup — budget ridotto automaticamente' });
    }

    if (!cfgStatus.aiConfigured && answers['noteMode'] === 'ai') {
        warnings.push({ level: 'warn', message: 'AI non configurata — fallback a nota template o senza nota' });
    }

    const withoutCompany = stats.totalLeads - stats.withJobTitle;
    if (withoutCompany > 5) {
        warnings.push({
            level: 'info',
            message: `${withoutCompany} lead senza company/job_title — nota generica per questi`,
        });
    }

    if (stats.lastSyncAt) {
        const syncAgeMs = Date.now() - new Date(stats.lastSyncAt).getTime();
        const syncAgeDays = Math.floor(syncAgeMs / 86400000);
        if (syncAgeDays > 7) {
            warnings.push({
                level: 'warn',
                message: `Dati lead obsoleti: ultimo sync ${syncAgeDays} giorni fa. Lead stale riducono acceptance rate — esegui sync-list prima.`,
            });
        }
    } else if (stats.totalLeads > 0) {
        warnings.push({
            level: 'info',
            message: 'Nessun sync registrato per questa lista — verifica che i lead siano aggiornati.',
        });
    }

    return warnings;
}

function buildNextActionSuggestion(
    invitesSent: number,
    invitesAfter: number,
    hardCap: number,
    dryRun: boolean,
): string {
    if (dryRun) {
        return 'Dry run completato. Rimuovi --dry-run per inviare gli inviti reali.';
    }
    const remaining = hardCap - invitesAfter;
    const steps: string[] = [];

    if (remaining <= 0) {
        steps.push('Budget inviti esaurito per oggi.');
        steps.push("Domani: esegui 'send-invites' per il prossimo batch.");
    } else {
        steps.push(`Budget rimanente: ${remaining} inviti.`);
    }

    if (invitesSent === 0) {
        steps.push(
            'ATTENZIONE: 0 inviti inviati. Verifica: lead READY_INVITE disponibili? Sessione LinkedIn valida? Challenge in corso?',
        );
    } else if (invitesSent < 5) {
        steps.push(`Solo ${invitesSent} inviti inviati — possibile sessione breve o challenge. Controlla i log.`);
    }

    steps.push("Prossimo step: esegui 'send-messages' per i lead che hanno accettato.");
    steps.push('Monitora il pending ratio nel daily report — se > 50% considera di ritirare inviti vecchi.');

    return steps.join(' ');
}

function buildCliOverrides(request: Omit<SendInvitesWorkflowRequest, 'workflow'>): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (request.limit !== null && request.limit !== undefined) overrides['limit'] = String(request.limit);
    if (request.skipEnrichment) overrides['enrichment'] = 'false';
    return overrides;
}

export async function executeSendInvitesWorkflow(
    request: Omit<SendInvitesWorkflowRequest, 'workflow'>,
): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();
    const localDate = getLocalDateString();
    const invitesBefore = await getDailyStat(localDate, 'invites_sent').catch(() => 0);

    const preflight = await runPreflight<SendInvitesPreflightAnswers>({
        workflowName: 'send-invites',
        questions: [
            {
                id: 'listName',
                prompt: 'Quale lista vuoi targettare (lascia vuoto per targettare tutte)?',
                type: 'string',
                defaultValue: request.listName ?? '',
            },
            {
                id: 'limit',
                prompt: 'Quanti inviti vuoi inviare al massimo?',
                type: 'number',
                defaultValue: String(request.limit ?? config.hardInviteCap),
            },
            {
                id: 'noteMode',
                prompt: 'Nota di connessione?',
                type: 'choice',
                choices: ['none', 'template', 'ai'],
                defaultValue: request.noteMode ?? 'none',
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
            limit: parseInt(answers['limit'] ?? String(config.hardInviteCap), 10),
            noteMode:
                answers['noteMode'] === 'ai' || answers['noteMode'] === 'template' ? answers['noteMode'] : 'none',
            enrichment: answers['enrichment'] !== 'false',
            _accountId: answers['_accountId'],
        }),
    });

    if (!preflight.confirmed) {
        return buildPreflightBlockedResult('send-invites', preflight);
    }

    const listFilter = preflight.answers.listName || null;
    const sessionLimit = preflight.answers.limit;
    const dryRun = request.dryRun ?? false;
    const minScore = request.minScore ?? 0;

    const scoreStats = await getScoreStats(listFilter, minScore);
    const db = await getDatabase();
    const params: unknown[] = [];
    let countQuery = `SELECT COUNT(*) as cnt FROM leads WHERE status = 'READY_INVITE'`;
    if (listFilter) {
        countQuery += ` AND list_name = ?`;
        params.push(listFilter);
    }
    if (minScore > 0) {
        countQuery += ` AND lead_score >= ?`;
        params.push(minScore);
    }
    const row = await db.get<{ cnt: number }>(countQuery, params);
    const candidateCount = row?.cnt ?? 0;

    let previewLeads: WorkflowPreviewLead[] = [];
    if (candidateCount > 0) {
        const previewParams: unknown[] = [];
        let previewQuery = `SELECT first_name, last_name, job_title, lead_score FROM leads WHERE status = 'READY_INVITE'`;
        if (listFilter) {
            previewQuery += ` AND list_name = ?`;
            previewParams.push(listFilter);
        }
        if (minScore > 0) {
            previewQuery += ` AND lead_score >= ?`;
            previewParams.push(minScore);
        }
        previewQuery += ` ORDER BY lead_score DESC NULLS LAST LIMIT 5`;
        const rows = await db.query<{
            first_name: string;
            last_name: string;
            job_title: string | null;
            lead_score: number | null;
        }>(previewQuery, previewParams);
        previewLeads = rows.map((lead) => ({
            label: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'N/A',
            secondary: lead.job_title || 'N/A',
            tertiary: lead.lead_score !== null ? `score:${lead.lead_score}` : 'no score',
        }));
    }

    if (candidateCount === 0) {
        let totalInDb = 0;
        let newCount = 0;
        try {
            const totalRow = await db.get<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM leads${listFilter ? ' WHERE list_name = ?' : ''}`,
                listFilter ? [listFilter] : [],
            );
            totalInDb = totalRow?.cnt ?? 0;
            const newRow = await db.get<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM leads WHERE status = 'NEW'${listFilter ? ' AND list_name = ?' : ''}`,
                listFilter ? [listFilter] : [],
            );
            newCount = newRow?.cnt ?? 0;
        } catch {
            // best-effort
        }

        return buildBlockedResult('send-invites', {
            reason: 'NO_WORK_AVAILABLE',
            message: 'Nessun lead READY_INVITE disponibile per questo run',
            details: { listName: listFilter, totalInDb, newCount, minScore },
        }, {
            summary: {
                lead_totali: totalInDb,
                lead_new: newCount,
                candidati_ready_invite: candidateCount,
                score_minimo: minScore,
            },
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                previewLeads,
                candidateCount,
                extra: { totalInDb, newCount, scoreStats },
            }),
            nextAction:
                newCount > 0
                    ? 'Esegui enrichment dei lead NEW prima di inviare inviti.'
                    : 'Sincronizza o arricchisci una lista prima di lanciare send-invites.',
        });
    }

    const effectiveLimit = sessionLimit > 0 ? Math.min(sessionLimit, candidateCount) : candidateCount;
    const estimatedMinutes = estimateExecutionMinutes(dryRun, effectiveLimit, 90, 75);

    let noteMode = preflight.answers.noteMode;
    let enrichmentDegraded = false;
    if (!dryRun && preflight.answers.enrichment) {
        const enrichReport = await enrichLeadsParallel({
            listName: listFilter || undefined,
            limit: effectiveLimit,
            concurrency: 5,
        });
        if (enrichReport.total > 5 && enrichReport.enriched / enrichReport.total < 0.2) {
            enrichmentDegraded = true;
            if (noteMode === 'ai') {
                noteMode = 'template';
            }
        }
    }

    let workflowError: string | null = null;
    const runOutcome = await runWorkflow({
        workflow: 'invite',
        dryRun,
        listFilter: listFilter || undefined,
        minScore: minScore > 0 ? minScore : undefined,
        sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
        noteMode,
        accountId: preflight.selectedAccountId ?? request.accountId,
    }).catch((err: unknown) => {
        workflowError = err instanceof Error ? err.message : String(err);
        return null;
    });

    let invitesAfter = invitesBefore;
    try {
        invitesAfter = await getDailyStat(localDate, 'invites_sent');
    } catch {
        /* fallback */
    }
    const invitesSent = invitesAfter - invitesBefore;

    if (workflowError) {
        return buildBlockedResult('send-invites', {
            reason: 'WORKFLOW_ERROR',
            message: workflowError,
        }, {
            errors: [workflowError],
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({ preflight, previewLeads, candidateCount, estimatedMinutes, extra: { scoreStats } }),
        });
    }

    if (runOutcome && runOutcome.status === 'blocked' && runOutcome.blocked) {
        return buildBlockedResult('send-invites', runOutcome.blocked, {
            summary: {
                inviti_inviati: invitesSent,
                budget_utilizzato: `${invitesAfter}/${config.hardInviteCap}`,
                budget_rimanente: config.hardInviteCap - invitesAfter,
                score_minimo: minScore,
                nota_modalita: noteMode,
                dry_run: dryRun ? 'SI' : 'no',
            },
            riskAssessment: preflight.riskAssessment,
            artifacts: buildWorkflowArtifacts({
                preflight,
                previewLeads,
                candidateCount,
                estimatedMinutes,
                extra: { scoreStats, enrichmentDegraded },
            }),
        });
    }

    const listBreakdown: WorkflowReportListBreakdown[] = [];
    try {
        const listInviteStats = await getListDailyStatsBatch(localDate, 'invites_sent');
        const listMessageStats = await getListDailyStatsBatch(localDate, 'messages_sent');
        for (const [ln, inv] of listInviteStats) {
            const perf = await computeListPerformanceMultiplier(ln, 30);
            const msg = listMessageStats.get(ln) ?? 0;
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
        workflow: 'send-invites',
        startedAt,
        finishedAt: new Date(),
        success: true,
        summary: {
            inviti_inviati: invitesSent,
            budget_utilizzato: `${invitesAfter}/${config.hardInviteCap}`,
            budget_rimanente: config.hardInviteCap - invitesAfter,
            score_minimo: minScore,
            nota_modalita: noteMode,
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors: [],
        nextAction: buildNextActionSuggestion(invitesSent, invitesAfter, config.hardInviteCap, dryRun),
        listBreakdown,
        riskAssessment: preflight.riskAssessment,
    };

    return buildResultFromReport('send-invites', workflowReport, {
        ...buildWorkflowArtifacts({
            preflight,
            previewLeads,
            candidateCount,
            estimatedMinutes,
            extra: { scoreStats, enrichmentDegraded },
        }),
    });
}
