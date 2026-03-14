/**
 * Workflow 3: send-messages — Messaggi personalizzati a lead che hanno accettato l'invito
 */

import { config, getLocalDateString } from '../config';
import { runWorkflow } from '../core/orchestrator';
import { computeListPerformanceMultiplier, getAutomationPauseState, getDailyStat, getListDailyStatsBatch, getRuntimeFlag } from '../core/repositories';
import { enrichLeadsParallel } from '../integrations/parallelEnricher';
import { getDatabase } from '../db';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport } from './reportFormatter';
import type { PreflightDbStats, PreflightConfigStatus, PreflightWarning, WorkflowReport, WorkflowReportListBreakdown } from './types';

export interface SendMessagesOptions {
    listName?: string;
    template?: string;
    lang?: string;
    limit?: number;
    dryRun?: boolean;
    skipPreflight?: boolean;
    accountId?: string;
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
        const listNote = answers['list'] ? ` (conteggio globale — la lista "${answers['list']}" potrebbe avere lead messaggiabili)` : '';
        warnings.push({ level: 'critical', message: `Nessun lead ACCEPTED/READY_MESSAGE trovato${listNote} — nulla da messaggiare` });
    }

    const remaining = cfgStatus.budgetMessages - cfgStatus.messagesSentToday;
    if (remaining <= 0) {
        warnings.push({ level: 'critical', message: `Budget messaggi esaurito oggi (${cfgStatus.messagesSentToday}/${cfgStatus.budgetMessages})` });
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
            warnings.push({ level: 'info', message: `${withoutJobTitle} lead senza job_title (${pct}%) — messaggio generico per questi` });
        }
    }

    // Stale Data Warning (5.3)
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

export async function runSendMessagesWorkflow(opts: SendMessagesOptions): Promise<void> {
    const startedAt = new Date();
    const localDate = getLocalDateString();

    // Capture pre-run stats
    const msgBefore = await getDailyStat(localDate, 'messages_sent');

    // Pre-flight
    const preflight = await runPreflight({
        workflowName: 'send-messages',
        questions: [
            {
                id: 'list',
                prompt: 'Da quale lista vuoi messaggiare? (vuoto = tutte)',
                type: 'string',
                defaultValue: opts.listName ?? '',
            },
            {
                id: 'lang',
                prompt: 'Lingua preferita',
                type: 'choice',
                choices: ['it', 'en', 'fr', 'es', 'nl'],
                defaultValue: opts.lang ?? 'en',
            },
            {
                id: 'limit',
                prompt: 'Limite messaggi per questa sessione?',
                type: 'number',
                defaultValue: String(opts.limit ?? config.hardMsgCap),
            },
            {
                id: 'dryRun',
                prompt: 'Dry run (mostra senza inviare)?',
                type: 'boolean',
                defaultValue: opts.dryRun ? 'true' : 'false',
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

    const dryRun = preflight.answers['dryRun'] === 'true';
    const listFilter = preflight.answers['list'] || null;
    const sessionLimit = parseInt(preflight.answers['limit'] || '0', 10);
    const lang = preflight.answers['lang'] || undefined;

    // Preview primi 5 lead che verranno messaggiati
    const readyCount = (preflight.dbStats.byStatus['ACCEPTED'] ?? 0) + (preflight.dbStats.byStatus['READY_MESSAGE'] ?? 0);
    if (readyCount > 0) {
        const db = await getDatabase();
        let previewQuery = `SELECT first_name, last_name, job_title, accepted_at FROM leads WHERE status IN ('ACCEPTED','READY_MESSAGE')`;
        const previewParams: unknown[] = [];
        if (listFilter) {
            previewQuery += ` AND list_name = ?`;
            previewParams.push(listFilter);
        }
        previewQuery += ` ORDER BY accepted_at ASC LIMIT 5`;
        const previewLeads = await db.query<{ first_name: string; last_name: string; job_title: string | null; accepted_at: string | null }>(previewQuery, previewParams);
        if (previewLeads.length > 0) {
            console.log(`\n  Prossimi lead da messaggiare (${previewLeads.length} su ${readyCount}):`);
            for (const lead of previewLeads) {
                const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'N/A';
                const title = lead.job_title || 'N/A';
                const acc = lead.accepted_at ? `acc: ${lead.accepted_at.slice(0, 10)}` : '';
                console.log(`    - ${name.padEnd(25)} ${title.substring(0, 35).padEnd(36)} ${acc}`);
            }
            console.log('');
        }
    }

    // ── Guard: quarantina e pausa ─────────────────────────────────────────────
    if (!dryRun) {
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
    }

    // ── Stima tempo ─────────────────────────────────────────────────────────────
    const accepted = (preflight.dbStats.byStatus['ACCEPTED'] ?? 0) + (preflight.dbStats.byStatus['READY_MESSAGE'] ?? 0);
    const effectiveLimit = sessionLimit > 0 ? Math.min(sessionLimit, accepted) : accepted;
    if (!dryRun && effectiveLimit > 0) {
        const estimatedMinutes = Math.ceil((90 + effectiveLimit * 60) / 60); // ~90s warmup + ~60s/messaggio
        console.log(`  ⏱  Tempo stimato: ~${estimatedMinutes} minuti per ${effectiveLimit} messaggi\n`);
    }

    // ── Pre-enrichment parallelo (zero browser, solo API) ──
    if (!dryRun && effectiveLimit > 0) {
        console.log('\n  ⚡ Pre-enrichment parallelo dei lead (senza browser)...');
        try {
            const enrichReport = await enrichLeadsParallel({
                listName: listFilter || undefined,
                limit: effectiveLimit,
                concurrency: 5,
                onProgress: (done, total, lastLead) => {
                    process.stdout.write(`\r  Enrichment: ${done}/${total} — ${lastLead}`);
                },
            });
            if (enrichReport.total > 0) {
                console.log(`\n  ✅ Enrichment completato: ${enrichReport.enriched}/${enrichReport.total} arricchiti (${enrichReport.emailsFound} email) in ${Math.round(enrichReport.durationMs / 1000)}s\n`);
            } else {
                console.log('  ✅ Tutti i lead sono già arricchiti.\n');
            }
        } catch {
            console.warn('  ⚠️  Pre-enrichment fallito (non bloccante, proseguo).\n');
        }
    }

    // Run the existing orchestrator for message workflow
    console.log('\n  Avvio invio messaggi...\n');

    let workflowError: string | null = null;
    try {
        await runWorkflow({
            workflow: 'message',
            dryRun,
            listFilter: listFilter || undefined,
            sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
            lang,
        });
    } catch (err) {
        workflowError = err instanceof Error ? err.message : String(err);
        console.error(`\n  [ERRORE] runWorkflow fallito: ${workflowError}\n`);
    }

    // Capture post-run stats (anche dopo errore — le stats parziali sono valide)
    let msgAfter = msgBefore;
    try {
        msgAfter = await getDailyStat(localDate, 'messages_sent');
    } catch { /* fallback a msgBefore se DB non raggiungibile */ }
    const messagesSent = msgAfter - msgBefore;

    // Per-List Performance Breakdown
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
    } catch { /* best-effort list breakdown */ }

    // Report
    const workflowReport: WorkflowReport = {
        workflow: 'send-messages',
        startedAt,
        finishedAt: new Date(),
        success: !workflowError,
        summary: {
            messaggi_inviati: messagesSent,
            budget_utilizzato: `${msgAfter}/${config.hardMsgCap}`,
            budget_rimanente: config.hardMsgCap - msgAfter,
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors: workflowError ? [workflowError] : [],
        nextAction: msgAfter >= config.hardMsgCap
            ? 'Budget messaggi esaurito — riprendi domani'
            : `Budget rimanente: ${config.hardMsgCap - msgAfter} messaggi`,
        listBreakdown,
        riskAssessment: preflight.riskAssessment,
    };

    console.log(formatWorkflowReport(workflowReport));
}

function buildCliOverrides(opts: SendMessagesOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.listName) overrides['list'] = opts.listName;
    if (opts.lang) overrides['lang'] = opts.lang;
    if (opts.limit !== null && opts.limit !== undefined) overrides['limit'] = String(opts.limit);
    if (opts.dryRun !== null && opts.dryRun !== undefined) overrides['dryRun'] = String(opts.dryRun);
    if (opts.accountId) overrides['accountId'] = opts.accountId;
    return overrides;
}
