/**
 * Motore pre-flight interattivo riusabile per tutti i workflow.
 * Raccoglie domande, mostra stats DB, config, warning, chiede conferma.
 */

import { config, getLocalDateString } from '../config';
import { getDatabase } from '../db';
import { getDailyStat } from '../core/repositories';
import { readLineFromStdin, askConfirmation, askNumber, askChoice, isInteractiveTTY } from '../cli/stdinHelper';
import { formatPreflightSection } from './reportFormatter';
import type { PreflightQuestion, PreflightDbStats, PreflightConfigStatus, PreflightWarning, PreflightResult } from './types';

// ─── DB Stats Collection ─────────────────────────────────────────────────────

export async function collectDbStats(listFilter?: string): Promise<PreflightDbStats> {
    const db = await getDatabase();

    const totalRow = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads`);
    const statusRows = await db.query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) as cnt FROM leads GROUP BY status ORDER BY cnt DESC`,
    );
    const listRows = await db.query<{ list_name: string; cnt: number }>(
        `SELECT list_name, COUNT(*) as cnt FROM leads GROUP BY list_name ORDER BY cnt DESC LIMIT 20`,
    );
    const emailRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE email IS NOT NULL AND TRIM(email) <> ''`,
    );
    const jobTitleRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE job_title IS NOT NULL AND TRIM(job_title) <> ''`,
    );
    const phoneRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE phone IS NOT NULL AND TRIM(phone) <> ''`,
    );
    const scoreRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE lead_score IS NOT NULL`,
    );
    const locationRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE location IS NOT NULL AND TRIM(location) <> ''`,
    );

    let lastSyncAt: string | null = null;
    if (listFilter) {
        const syncRow = await db.get<{ synced_at: string }>(
            `SELECT synced_at FROM salesnav_lists WHERE name = ? ORDER BY synced_at DESC LIMIT 1`,
            [listFilter],
        );
        lastSyncAt = syncRow?.synced_at ?? null;
    }

    const byStatus: Record<string, number> = {};
    for (const row of statusRows) byStatus[row.status] = row.cnt;

    const byList: Record<string, number> = {};
    for (const row of listRows) byList[row.list_name] = row.cnt;

    const total = totalRow?.total ?? 0;
    const withEmail = emailRow?.total ?? 0;

    return {
        totalLeads: total,
        byStatus,
        byList,
        withEmail,
        withoutEmail: total - withEmail,
        withScore: scoreRow?.total ?? 0,
        withJobTitle: jobTitleRow?.total ?? 0,
        withPhone: phoneRow?.total ?? 0,
        withLocation: locationRow?.total ?? 0,
        lastSyncAt,
    };
}

// ─── Config Status Collection ────────────────────────────────────────────────

export async function collectConfigStatus(): Promise<PreflightConfigStatus> {
    const localDate = getLocalDateString();
    const invitesSentToday = await getDailyStat(localDate, 'invites_sent');
    const messagesSentToday = await getDailyStat(localDate, 'messages_sent');

    return {
        proxyConfigured: !!config.proxyUrl,
        apolloConfigured: !!config.apolloApiKey,
        hunterConfigured: !!config.hunterApiKey,
        clearbitConfigured: !!config.clearbitApiKey,
        aiConfigured: !!config.openaiApiKey || !!config.ollamaEndpoint,
        supabaseConfigured: !!config.supabaseUrl && !!config.supabaseServiceRoleKey,
        growthModelEnabled: config.growthModelEnabled,
        weeklyStrategyEnabled: config.weeklyStrategyEnabled,
        warmupEnabled: config.warmupEnabled,
        budgetInvites: config.hardInviteCap,
        budgetMessages: config.hardMsgCap,
        invitesSentToday,
        messagesSentToday,
    };
}

// ─── Display Functions ───────────────────────────────────────────────────────

function checkMark(ok: boolean): string {
    return ok ? '[OK]' : '[--]';
}

function displayDbStats(stats: PreflightDbStats, listFilter?: string): void {
    const entries: Array<[string, string]> = [
        ['Lead totali nel DB:', String(stats.totalLeads)],
    ];

    if (listFilter && stats.byList[listFilter] !== undefined && stats.byList[listFilter] !== null) {
        entries.push([`Di cui in "${listFilter}":`, String(stats.byList[listFilter])]);
    }

    entries.push(
        ['Lead con email:', String(stats.withEmail)],
        ['Lead senza email:', String(stats.withoutEmail)],
        ['Lead con job_title:', String(stats.withJobTitle)],
        ['Lead con phone:', String(stats.withPhone)],
        ['Lead con location:', String(stats.withLocation)],
        ['Lead con score:', String(stats.withScore)],
    );

    if (stats.lastSyncAt) {
        entries.push(['Ultimo sync lista:', stats.lastSyncAt]);
    }

    // Status breakdown
    const statusLine = Object.entries(stats.byStatus)
        .map(([s, c]) => `${s}=${c}`)
        .join(', ');
    entries.push(['Lead per status:', statusLine || '(nessuno)']);

    console.log(formatPreflightSection('STATO DATABASE ATTUALE', entries));
}

function displayConfigStatus(cs: PreflightConfigStatus): void {
    const entries: Array<[string, string]> = [
        ['Apollo API:', checkMark(cs.apolloConfigured) + ' ' + (cs.apolloConfigured ? 'configurato' : 'mancante')],
        ['Hunter API:', checkMark(cs.hunterConfigured) + ' ' + (cs.hunterConfigured ? 'configurato' : 'mancante (fallback disabilitato)')],
        ['Clearbit API:', checkMark(cs.clearbitConfigured) + ' ' + (cs.clearbitConfigured ? 'configurato' : 'mancante')],
        ['AI Personalization:', checkMark(cs.aiConfigured) + ' ' + (cs.aiConfigured ? 'attivo' : 'mancante')],
        ['Supabase Cloud:', checkMark(cs.supabaseConfigured) + ' ' + (cs.supabaseConfigured ? 'attivo' : 'non configurato')],
        ['Proxy:', checkMark(cs.proxyConfigured) + ' ' + (cs.proxyConfigured ? 'configurato' : 'diretto (no proxy)')],
        ['Growth Model:', checkMark(cs.growthModelEnabled) + ' ' + (cs.growthModelEnabled ? 'attivo' : 'disabilitato')],
        ['Weekly Strategy:', checkMark(cs.weeklyStrategyEnabled) + ' ' + (cs.weeklyStrategyEnabled ? 'attivo' : 'disabilitato')],
        ['Budget inviti:', `${cs.invitesSentToday}/${cs.budgetInvites} oggi`],
        ['Budget messaggi:', `${cs.messagesSentToday}/${cs.budgetMessages} oggi`],
    ];

    console.log(formatPreflightSection('CONFIG ATTIVA', entries));
}

function displayWarnings(warnings: PreflightWarning[]): void {
    if (warnings.length === 0) return;

    console.log('');
    console.log('  AVVISI:');
    for (const w of warnings) {
        const prefix = w.level === 'critical' ? '[!!!]' : w.level === 'warn' ? '[!]' : '[i]';
        console.log(`    ${prefix} ${w.message}`);
    }
}

// ─── Main Pre-flight Runner ──────────────────────────────────────────────────

export interface PreflightConfig {
    workflowName: string;
    questions: PreflightQuestion[];
    listFilter?: string;
    generateWarnings: (stats: PreflightDbStats, config: PreflightConfigStatus, answers: Record<string, string>) => PreflightWarning[];
    skipPreflight?: boolean;
    cliOverrides?: Record<string, string>;
}

export async function runPreflight(pfConfig: PreflightConfig): Promise<PreflightResult> {
    const answers: Record<string, string> = { ...pfConfig.cliOverrides };

    // Se --skip-preflight o non-TTY, usa defaults
    if (pfConfig.skipPreflight || !isInteractiveTTY()) {
        const dbStats = await collectDbStats(pfConfig.listFilter);
        const configStatus = await collectConfigStatus();
        const warnings = pfConfig.generateWarnings(dbStats, configStatus, answers);

        // Fill missing answers with defaults
        for (const q of pfConfig.questions) {
            if (!(q.id in answers) && q.defaultValue !== undefined && q.defaultValue !== null) {
                answers[q.id] = q.defaultValue;
            }
        }

        return { answers, dbStats, configStatus, warnings, confirmed: true };
    }

    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  PRE-FLIGHT: ${pfConfig.workflowName.toUpperCase()}`);
    console.log('════════════════════════════════════════════════════════════════');

    // Ask questions (skip if already answered via CLI flags)
    for (const q of pfConfig.questions) {
        if (q.id in answers) continue;

        if (q.type === 'boolean') {
            const confirmed = await askConfirmation(`  ${q.prompt} [Y/n] `);
            answers[q.id] = confirmed ? 'true' : 'false';
        } else if (q.type === 'number') {
            const num = await askNumber(`  ${q.prompt}`, parseInt(q.defaultValue ?? '0', 10));
            answers[q.id] = String(num);
        } else if (q.type === 'choice' && q.choices) {
            const choice = await askChoice(`  ${q.prompt}`, q.choices, q.defaultValue ?? q.choices[0]);
            answers[q.id] = choice;
        } else {
            const raw = await readLineFromStdin(`  ${q.prompt}${q.defaultValue ? ` (default: ${q.defaultValue})` : ''}: `);
            answers[q.id] = raw || q.defaultValue || '';
        }
    }

    // Collect stats
    const listFilter = answers['list'] ?? pfConfig.listFilter;
    const dbStats = await collectDbStats(listFilter);
    const configStatus = await collectConfigStatus();
    const warnings = pfConfig.generateWarnings(dbStats, configStatus, answers);

    // Display
    console.log('');
    displayDbStats(dbStats, listFilter);
    console.log('');
    displayConfigStatus(configStatus);
    displayWarnings(warnings);
    console.log('');

    // Critical warnings block execution
    const hasCritical = warnings.some((w) => w.level === 'critical');
    if (hasCritical) {
        console.log('  [!!!] Condizioni critiche rilevate. Risolvere prima di procedere.');
        return { answers, dbStats, configStatus, warnings, confirmed: false };
    }

    const confirmed = await askConfirmation('  Procedo? [Y/n] ');

    return { answers, dbStats, configStatus, warnings, confirmed };
}
