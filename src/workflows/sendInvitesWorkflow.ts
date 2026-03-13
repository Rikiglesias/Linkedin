/**
 * Workflow 4: send-invites — Inviti connessione da lead READY_INVITE
 */

import { config, getLocalDateString } from '../config';
import { runWorkflow } from '../core/orchestrator';
import { computeListPerformanceMultiplier, getDailyStat, getListDailyStatsBatch } from '../core/repositories';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport } from './reportFormatter';
import type { PreflightDbStats, PreflightConfigStatus, PreflightWarning, WorkflowReport, WorkflowReportListBreakdown } from './types';
import { getDatabase } from '../db';
import { runSyncSearchWorkflow } from './syncSearchWorkflow';
import { enrichLeadsParallel } from '../integrations/parallelEnricher';
import inquirer from 'inquirer';

export interface SendInvitesOptions {
    listName?: string;
    noteMode?: 'ai' | 'template' | 'none';
    minScore?: number;
    limit?: number;
    dryRun?: boolean;
    skipPreflight?: boolean;
    accountId?: string;
}

async function getScoreStats(): Promise<{ min: number; max: number; avg: number; count: number }> {
    const db = await getDatabase();
    const row = await db.get<{ min_score: number; max_score: number; avg_score: number; cnt: number }>(
        `SELECT MIN(lead_score) as min_score, MAX(lead_score) as max_score, AVG(lead_score) as avg_score, COUNT(*) as cnt
         FROM leads WHERE status = 'READY_INVITE' AND lead_score IS NOT NULL`,
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
        warnings.push({ level: 'critical', message: 'Nessun lead READY_INVITE — esegui prima sync-list con enrichment' });
    }

    const remaining = cfgStatus.budgetInvites - cfgStatus.invitesSentToday;
    if (remaining <= 0) {
        warnings.push({ level: 'critical', message: `Budget inviti esaurito oggi (${cfgStatus.invitesSentToday}/${cfgStatus.budgetInvites})` });
    } else if (remaining < 5) {
        warnings.push({ level: 'warn', message: `Budget inviti quasi esaurito: ${remaining} rimanenti` });
    }

    if (cfgStatus.warmupEnabled) {
        warnings.push({ level: 'info', message: 'Account in fase warmup — budget ridotto automaticamente' });
    }

    if (!cfgStatus.aiConfigured && answers['noteMode'] === 'ai') {
        warnings.push({ level: 'warn', message: 'AI non configurata — fallback a nota template o senza nota' });
    }

    const withoutCompany = stats.totalLeads - stats.withJobTitle;
    if (withoutCompany > 5) {
        warnings.push({ level: 'info', message: `${withoutCompany} lead senza company/job_title — nota generica per questi` });
    }

    // Stale Data Warning (5.3): lead non sincronizzati da >7 giorni = obsoleti
    // Lead stale → basso acceptance → pending ratio alto → rischio ban
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

export async function runSendInvitesWorkflow(opts: SendInvitesOptions): Promise<void> {
    const startedAt = new Date();
    const localDate = getLocalDateString();

    // Capture pre-run stats
    const invitesBefore = await getDailyStat(localDate, 'invites_sent');

    // Score stats for display
    const scoreStats = await getScoreStats();

    // Pre-flight
    const preflight = await runPreflight({
        workflowName: 'send-invites',
        questions: [
            {
                id: 'list',
                prompt: 'Da quale lista vuoi invitare? (vuoto = tutte le READY_INVITE)',
                type: 'string',
                defaultValue: opts.listName ?? '',
            },
            {
                id: 'noteMode',
                prompt: 'Modalita\' nota invito',
                type: 'choice',
                choices: ['ai', 'template', 'none'],
                defaultValue: opts.noteMode ?? 'ai',
            },
            {
                id: 'minScore',
                prompt: 'Score minimo per invitare?',
                type: 'number',
                defaultValue: String(opts.minScore ?? 30),
            },
            {
                id: 'limit',
                prompt: 'Limite inviti per questa sessione?',
                type: 'number',
                defaultValue: String(opts.limit ?? config.hardInviteCap),
            },
            {
                id: 'dryRun',
                prompt: 'Dry run (mostra senza invitare)?',
                type: 'boolean',
                defaultValue: opts.dryRun ? 'true' : 'false',
            },
        ],
        generateWarnings,
        skipPreflight: opts.skipPreflight,
        cliOverrides: buildCliOverrides(opts),
    });

    if (!preflight.confirmed) {
        console.log('\n  Operazione annullata.\n');
        return;
    }

    // Show score stats if available
    if (scoreStats.count > 0) {
        console.log(`\n  Score READY_INVITE: min=${scoreStats.min} avg=${scoreStats.avg} max=${scoreStats.max} (${scoreStats.count} con score)`);
    }

    const dryRun = preflight.answers['dryRun'] === 'true';
    const listFilter = preflight.answers['list'] || null;

    const db = await getDatabase();
    let query = `SELECT COUNT(*) as cnt FROM leads WHERE status = 'READY_INVITE'`;
    const params: unknown[] = [];
    if (listFilter) {
        query += ` AND list_name = ?`;
        params.push(listFilter);
    }
    const row = await db.get<{cnt: number}>(query, params);

    if (!row || row.cnt === 0) {
        if (listFilter) {
            console.log(`\n  ✅ Sono già state inviate tutte le connessioni per la lista "${listFilter}".\n`);
        } else {
            console.log(`\n  ✅ Sono già state inviate tutte le connessioni.\n`);
        }

        // Fallback: Chiedi all'utente se vuole rimpinguare la lista tramite SalesNav Search
        if (!dryRun) {
            const { wantSync } = await inquirer.prompt([{
                type: 'confirm',
                name: 'wantSync',
                message: 'Non ci sono lead READY_INVITE disponibili. Vuoi estrarre nuovi lead da una ricerca salvata di Sales Navigator?',
                default: true,
            }]);

            if (wantSync) {
                const answers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'searchName',
                        message: 'Nome della ricerca salvata (lascia vuoto per farle tutte):',
                        default: '',
                    },
                    {
                        type: 'input',
                        name: 'targetList',
                        message: 'Nome della lista in cui aggiungere i nuovi lead:',
                        default: listFilter || config.salesNavSyncListName || 'default',
                    }
                ]);

                console.log(`\n  Passaggio automatico al flow sync-search...\n`);
                await runSyncSearchWorkflow({
                    searchName: answers.searchName,
                    listName: answers.targetList,
                    enrichment: true,
                    dryRun: false,
                    accountId: opts.accountId,
                    skipPreflight: true // Skip preflight because the user already answered our minimal prompts
                });
            }
        }
        return;
    }

    const minScore = parseInt(preflight.answers['minScore'] || '0', 10);
    const sessionLimit = parseInt(preflight.answers['limit'] || '0', 10);

    // ── Pre-enrichment parallelo (zero browser, solo API) ──
    let enrichmentDegraded = false;
    if (!dryRun) {
        console.log('\n  ⚡ Pre-enrichment parallelo dei lead (senza browser)...');
        const enrichReport = await enrichLeadsParallel({
            listName: listFilter || undefined,
            limit: sessionLimit > 0 ? sessionLimit : row.cnt,
            concurrency: 5,
            onProgress: (done, total, lastLead) => {
                process.stdout.write(`\r  Enrichment: ${done}/${total} — ${lastLead}`);
            },
        });
        if (enrichReport.total > 0) {
            console.log(`\n  ✅ Enrichment completato: ${enrichReport.enriched}/${enrichReport.total} arricchiti (${enrichReport.emailsFound} email, ${enrichReport.phonesFound} tel) in ${Math.round(enrichReport.durationMs / 1000)}s\n`);
        } else {
            console.log('  ✅ Tutti i lead sono già arricchiti.\n');
        }

        // Graceful Degradation (6.5): se enrichment fallisce per >80% dei lead
        // e noteMode è 'ai', auto-downgrade a 'template' con warning.
        // Nota AI senza dati arricchiti = nota generica vuota → basso acceptance → rischio ban.
        if (enrichReport.total > 5 && enrichReport.enriched / enrichReport.total < 0.20) {
            enrichmentDegraded = true;
            console.warn('\n  ⚠️  DEGRADATION: Enrichment fallito per >80% dei lead. API probabilmente down o rate-limited.');
            if (preflight.answers['noteMode'] === 'ai') {
                console.warn('  ⚠️  Auto-downgrade nota: ai → template (nota AI senza dati = vuota/generica).\n');
            }
        }
    }

    // Run the existing orchestrator for invite workflow
    console.log('\n  Avvio invio inviti...\n');

    let noteMode = (preflight.answers['noteMode'] || 'ai') as 'ai' | 'template' | 'none';
    // Graceful Degradation (6.5): downgrade effettivo
    if (enrichmentDegraded && noteMode === 'ai') {
        noteMode = 'template';
    }

    await runWorkflow({
        workflow: 'invite',
        dryRun,
        listFilter: listFilter || undefined,
        minScore: minScore > 0 ? minScore : undefined,
        sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
        noteMode,
    });

    // Capture post-run stats
    const invitesAfter = await getDailyStat(localDate, 'invites_sent');
    const invitesSent = invitesAfter - invitesBefore;

    // Per-List Performance Breakdown (5.2 wire)
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
    } catch { /* best-effort list breakdown */ }

    // Report
    const workflowReport: WorkflowReport = {
        workflow: 'send-invites',
        startedAt,
        finishedAt: new Date(),
        success: true,
        summary: {
            inviti_inviati: invitesSent,
            budget_utilizzato: `${invitesAfter}/${config.hardInviteCap}`,
            budget_rimanente: config.hardInviteCap - invitesAfter,
            score_minimo: preflight.answers['minScore'] ?? '30',
            nota_modalita: preflight.answers['noteMode'] ?? 'ai',
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors: [],
        nextAction: buildNextActionSuggestion(invitesSent, invitesAfter, config.hardInviteCap, dryRun),
        listBreakdown,
    };

    console.log(formatWorkflowReport(workflowReport));
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
        steps.push('ATTENZIONE: 0 inviti inviati. Verifica: lead READY_INVITE disponibili? Sessione LinkedIn valida? Challenge in corso?');
    } else if (invitesSent < 5) {
        steps.push(`Solo ${invitesSent} inviti inviati — possibile sessione breve o challenge. Controlla i log.`);
    }

    steps.push("Prossimo step: esegui 'send-messages' per i lead che hanno accettato.");
    steps.push("Monitora il pending ratio nel daily report — se > 50% considera di ritirare inviti vecchi.");

    return steps.join(' ');
}

function buildCliOverrides(opts: SendInvitesOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.listName) overrides['list'] = opts.listName;
    if (opts.noteMode) overrides['noteMode'] = opts.noteMode;
    if (opts.minScore !== null && opts.minScore !== undefined) overrides['minScore'] = String(opts.minScore);
    if (opts.limit !== null && opts.limit !== undefined) overrides['limit'] = String(opts.limit);
    if (opts.dryRun !== null && opts.dryRun !== undefined) overrides['dryRun'] = String(opts.dryRun);
    return overrides;
}
