/**
 * Motore pre-flight interattivo riusabile per tutti i workflow.
 * Raccoglie domande, mostra stats DB, config, warning, chiede conferma.
 */

import { config, getLocalDateString } from '../config';
import { checkDiskSpace, getDatabase } from '../db';
import { getDailyStat, getRuntimeFlag } from '../core/repositories';
import { getRuntimeAccountProfiles } from '../accountManager';
import { readLineFromStdin, askConfirmation, askNumber, askChoice, isInteractiveTTY } from '../cli/stdinHelper';
import { formatPreflightSection } from './reportFormatter';
import type { PreflightQuestion, PreflightDbStats, PreflightConfigStatus, PreflightWarning, PreflightResult, SessionRiskAssessment } from './types';

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

    // IP reputation check del proxy attivo (NEW-15)
    let proxyIpReputation: PreflightConfigStatus['proxyIpReputation'] = null;
    if (config.ipReputationApiKey && config.proxyUrl) {
        try {
            const { checkIpReputation } = await import('../proxy/ipReputationChecker');
            const result = await checkIpReputation(config.proxyUrl);
            if (result) {
                proxyIpReputation = {
                    ip: result.ip,
                    abuseScore: result.abuseConfidenceScore,
                    isSafe: result.isSafe,
                    isp: result.isp,
                    country: result.countryCode,
                };
            }
        } catch {
            // Best-effort: se fallisce, procedi senza
        }
    }

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
        proxyIpReputation,
    };
}

/**
 * Helper per tutti i workflow: aggiunge warning se il proxy è blacklisted.
 * Chiamare dentro generateWarnings() di ogni workflow.
 */
export function appendProxyReputationWarning(warnings: PreflightWarning[], cfgStatus: PreflightConfigStatus): void {
    if (cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe) {
        warnings.push({
            level: 'critical',
            message: `Proxy IP ${cfgStatus.proxyIpReputation.ip} BLACKLISTED (abuse score: ${cfgStatus.proxyIpReputation.abuseScore}/100, ISP: ${cfgStatus.proxyIpReputation.isp}). Cambiare proxy prima di procedere.`,
        });
    }
}

// ─── Session Risk Assessment (5.1) ──────────────────────────────────────────

/**
 * Calcola il livello di rischio della sessione prima di procedere.
 * Combina 5 segnali con pesi diversi per produrre un score 0-100.
 *
 * Score → Livello:
 *   0-30  → GO (procedere normalmente)
 *   31-60 → CAUTION (procedere con budget ridotto)
 *   61+   → STOP (non procedere, rischio ban alto)
 */
export async function computeSessionRiskLevel(
    cfgStatus: PreflightConfigStatus,
): Promise<SessionRiskAssessment> {
    const localDate = getLocalDateString();
    const db = await getDatabase();

    // Factor 1: Challenge recenti (ultimi 7 giorni) — peso 30
    const challengeRow = await db.get<{ total: number }>(`
        SELECT COALESCE(SUM(challenges_count), 0) AS total
        FROM daily_stats WHERE date >= DATE('now', '-7 days')
    `);
    const challengesLast7d = challengeRow?.total ?? 0;
    const challengeFactor = Math.min(30, challengesLast7d * 15); // 1 challenge = 15, 2+ = 30 (cap)

    // Factor 2: Pending ratio — peso 25
    const pendingRow = await db.get<{ pending: number; total: number }>(`
        SELECT
            COUNT(CASE WHEN status = 'INVITED' THEN 1 END) AS pending,
            COUNT(CASE WHEN invited_at IS NOT NULL THEN 1 END) AS total
        FROM leads
    `);
    const pendingTotal = pendingRow?.total ?? 0;
    const pendingRatio = pendingTotal > 0
        ? (pendingRow?.pending ?? 0) / pendingTotal
        : 0;
    const pendingFactor = Math.min(25, Math.floor(pendingRatio * 40)); // 65% → 26 (capped at 25)

    // Factor 3: Error rate oggi — peso 20
    const errorsToday = await getDailyStat(localDate, 'run_errors');
    const processedToday = cfgStatus.invitesSentToday + cfgStatus.messagesSentToday;
    const errorRate = processedToday > 0 ? errorsToday / processedToday : 0;
    const errorFactor = Math.min(20, Math.floor(errorRate * 50));

    // Factor 4: Proxy reputation — peso 15
    const proxyFactor = cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe
        ? Math.min(15, Math.floor(cfgStatus.proxyIpReputation.abuseScore / 7))
        : 0;

    // Factor 5: Tempo dall'ultimo run — peso 10 (run troppo frequenti = rischio)
    // Usa browser_session_started_at (timestamp ISO preciso) invece di daily_stats.date
    // (YYYY-MM-DD → mezzanotte, impreciso per calcoli intra-giorno).
    const riskAccounts = getRuntimeAccountProfiles();
    let frequencyFactor = 0;
    for (const acc of riskAccounts) {
        const lastSessionTs = await getRuntimeFlag(`browser_session_started_at:${acc.id}`).catch(() => null);
        if (lastSessionTs) {
            const parsedMs = Date.parse(lastSessionTs);
            if (Number.isFinite(parsedMs)) {
                const hoursSince = (Date.now() - parsedMs) / 3600000;
                if (hoursSince < 2) { frequencyFactor = 10; break; }
                else if (hoursSince < 6 && frequencyFactor < 5) { frequencyFactor = 5; }
            }
        }
    }

    // Factor 6: Disk space (C.2) — peso 15
    const diskStatus = checkDiskSpace();
    const diskFactor = diskStatus.level === 'critical' ? 15 : diskStatus.level === 'warn' ? 5 : 0;

    const factors: Record<string, number> = {
        challenges: challengeFactor,
        pendingRatio: pendingFactor,
        errorRate: errorFactor,
        proxyReputation: proxyFactor,
        runFrequency: frequencyFactor,
        diskSpace: diskFactor,
    };

    const score = Math.min(100, challengeFactor + pendingFactor + errorFactor + proxyFactor + frequencyFactor + diskFactor);

    let level: 'GO' | 'CAUTION' | 'STOP';
    let recommendation: string;
    if (score <= 30) {
        level = 'GO';
        recommendation = 'Rischio basso — procedere normalmente';
    } else if (score <= 60) {
        level = 'CAUTION';
        recommendation = 'Rischio medio — procedere con budget ridotto e monitoraggio attivo';
    } else {
        level = 'STOP';
        recommendation = 'Rischio alto — NON procedere. Attendere, verificare account health e proxy';
    }

    return { level, score, factors, recommendation };
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
        ...(cs.proxyIpReputation ? [['Proxy IP Reputation:', cs.proxyIpReputation.isSafe
            ? `${checkMark(true)} ${cs.proxyIpReputation.ip} — score ${cs.proxyIpReputation.abuseScore}/100 (${cs.proxyIpReputation.isp}, ${cs.proxyIpReputation.country})`
            : `${checkMark(false)} ${cs.proxyIpReputation.ip} — BLACKLISTED score ${cs.proxyIpReputation.abuseScore}/100 (${cs.proxyIpReputation.isp})`] as [string, string]] : []),
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
        const riskAssessment = await computeSessionRiskLevel(configStatus);

        // Fill missing answers with defaults
        for (const q of pfConfig.questions) {
            if (!(q.id in answers) && q.defaultValue !== undefined && q.defaultValue !== null) {
                answers[q.id] = q.defaultValue;
            }
        }

        // STOP blocca anche in modalità non-interattiva
        if (riskAssessment.level === 'STOP') {
            return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment };
        }

        return { answers, dbStats, configStatus, warnings, confirmed: true, riskAssessment };
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

    // Risk Assessment (5.1 wire)
    const riskAssessment = await computeSessionRiskLevel(configStatus);

    // Display
    console.log('');
    displayDbStats(dbStats, listFilter);
    console.log('');
    displayConfigStatus(configStatus);
    displayWarnings(warnings);

    // Mostra risk assessment all'utente
    console.log('');
    const riskIcon = riskAssessment.level === 'GO' ? '[OK]' : riskAssessment.level === 'CAUTION' ? '[!]' : '[!!!]';
    console.log(`  ${riskIcon} Risk Assessment: ${riskAssessment.level} (score: ${riskAssessment.score}/100)`);
    console.log(`      ${riskAssessment.recommendation}`);
    if (riskAssessment.score > 30) {
        const factorDetails = Object.entries(riskAssessment.factors)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        if (factorDetails) console.log(`      Fattori: ${factorDetails}`);
    }
    console.log('');

    // STOP blocca l'esecuzione
    if (riskAssessment.level === 'STOP') {
        console.log('  [!!!] Risk level STOP — sessione NON sicura. Risolvere prima di procedere.');
        return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment };
    }

    // Critical warnings block execution
    const hasCritical = warnings.some((w) => w.level === 'critical');
    if (hasCritical) {
        console.log('  [!!!] Condizioni critiche rilevate. Risolvere prima di procedere.');
        return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment };
    }

    const confirmed = await askConfirmation('  Procedo? [Y/n] ');

    return { answers, dbStats, configStatus, warnings, confirmed, riskAssessment };
}
