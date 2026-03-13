/**
 * Workflow 3: send-messages — Messaggi personalizzati a lead che hanno accettato l'invito
 */

import { config, getLocalDateString } from '../config';
import { runWorkflow } from '../core/orchestrator';
import { getDailyStat } from '../core/repositories';
import { runPreflight, appendProxyReputationWarning } from './preflight';
import { formatWorkflowReport } from './reportFormatter';
import type { PreflightDbStats, PreflightConfigStatus, PreflightWarning, WorkflowReport } from './types';

export interface SendMessagesOptions {
    listName?: string;
    template?: string;
    lang?: string;
    limit?: number;
    dryRun?: boolean;
    skipPreflight?: boolean;
}

function generateWarnings(
    stats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    _answers: Record<string, string>,
): PreflightWarning[] {
    const warnings: PreflightWarning[] = [];

    appendProxyReputationWarning(warnings, cfgStatus);

    const accepted = (stats.byStatus['ACCEPTED'] ?? 0) + (stats.byStatus['READY_MESSAGE'] ?? 0);
    if (accepted === 0) {
        warnings.push({ level: 'critical', message: 'Nessun lead ACCEPTED/READY_MESSAGE trovato — nulla da messaggiare' });
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
                id: 'mode',
                prompt: 'Modalita\' messaggio',
                type: 'choice',
                choices: ['ai', 'template'],
                defaultValue: opts.template ? 'template' : 'ai',
            },
            {
                id: 'lang',
                prompt: 'Lingua preferita',
                type: 'choice',
                choices: ['it', 'en', 'fr', 'es', 'nl'],
                defaultValue: opts.lang ?? 'it',
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

    // Run the existing orchestrator for message workflow
    console.log('\n  Avvio invio messaggi...\n');

    await runWorkflow({
        workflow: 'message',
        dryRun,
        listFilter: listFilter || undefined,
        sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
        lang,
    });

    // Capture post-run stats
    const msgAfter = await getDailyStat(localDate, 'messages_sent');
    const messagesSent = msgAfter - msgBefore;

    // Report
    const workflowReport: WorkflowReport = {
        workflow: 'send-messages',
        startedAt,
        finishedAt: new Date(),
        success: true,
        summary: {
            messaggi_inviati: messagesSent,
            budget_utilizzato: `${msgAfter}/${config.hardMsgCap}`,
            budget_rimanente: config.hardMsgCap - msgAfter,
            dry_run: dryRun ? 'SI' : 'no',
        },
        errors: [],
        nextAction: msgAfter >= config.hardMsgCap
            ? 'Budget messaggi esaurito — riprendi domani'
            : `Budget rimanente: ${config.hardMsgCap - msgAfter} messaggi`,
    };

    console.log(formatWorkflowReport(workflowReport));
}

function buildCliOverrides(opts: SendMessagesOptions): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (opts.listName) overrides['list'] = opts.listName;
    if (opts.template) overrides['mode'] = 'template';
    if (opts.lang) overrides['lang'] = opts.lang;
    if (opts.limit !== null && opts.limit !== undefined) overrides['limit'] = String(opts.limit);
    if (opts.dryRun !== null && opts.dryRun !== undefined) overrides['dryRun'] = String(opts.dryRun);
    return overrides;
}
