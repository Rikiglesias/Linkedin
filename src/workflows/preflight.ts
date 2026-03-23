/**
 * Motore pre-flight interattivo riusabile per tutti i workflow.
 *
 * 6 LIVELLI DI CONTROLLO (eseguiti in ordine):
 *   L1: Account Selection  — se >1 account, menu interattivo scelta account
 *   L2: DB Analysis         — raccolta stats DB, status breakdown, data quality
 *   L3: Config Validation   — verifica API keys, proxy, budget, cookie freshness
 *   L4: Risk Assessment     — score 0-100 ponderato su 6 fattori
 *   L5: AI Advisor          — AI analizza L2+L3+L4 e suggerisce azione/parametri
 *   L6: Anti-Ban Checklist  — checklist interattiva finale context-aware
 *
 * Ogni livello puo' bloccare l'esecuzione (STOP) o proseguire con warning.
 */

import { config, getLocalDateString, getWeekStartDate } from '../config';
import { checkDiskSpace, getDatabase } from '../db';
import { countWeeklyInvites, getDailyStat, getRuntimeFlag } from '../core/repositories';
import { getRuntimeAccountProfiles } from '../accountManager';
import { checkSessionFreshness } from '../browser/sessionCookieMonitor';
import { readLineFromStdin, askConfirmation, askNumber, askChoice, isInteractiveTTY } from '../cli/stdinHelper';
import { formatPreflightSection } from './reportFormatter';
import type {
    PreflightQuestion,
    PreflightDbStats,
    PreflightConfigStatus,
    PreflightWarning,
    PreflightResult,
    SessionRiskAssessment,
    AiAdvisorResult,
} from './types';

// ─── L1: Account Selection ──────────────────────────────────────────────────

/**
 * L1: Se sono configurati piu' account, mostra menu interattivo.
 * Ritorna l'accountId selezionato, o undefined se single-account.
 */
async function selectAccount(cliAccountId?: string): Promise<string | undefined> {
    // Se l'utente ha specificato --account da CLI, usa quello
    if (cliAccountId) return cliAccountId;

    const accounts = getRuntimeAccountProfiles();
    if (accounts.length <= 1) return undefined;

    if (!isInteractiveTTY()) return undefined; // non-interattivo: usa default

    console.log('');
    console.log('  L1: SELEZIONE ACCOUNT');
    console.log('');
    console.log('  Account configurati:');
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const proxyLabel = acc.proxy ? `proxy: ${acc.proxy.server}` : 'no proxy';
        const warmupLabel = acc.warmupEnabled ? ' [warmup]' : '';
        console.log(`    ${i + 1}. ${acc.id} (${proxyLabel}${warmupLabel})`);
    }
    console.log('');

    const accountIds = accounts.map(a => a.id);
    const selected = await askChoice(
        '  Quale account vuoi utilizzare?',
        accountIds,
        accountIds[0],
    );
    console.log(`  -> Account selezionato: ${selected}`);
    return selected;
}

// ─── L2: DB Stats Collection ────────────────────────────────────────────────

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
        const syncRow = await db.get<{ last_synced_at: string }>(
            `SELECT last_synced_at FROM salesnav_lists WHERE name = ? ORDER BY last_synced_at DESC LIMIT 1`,
            [listFilter],
        );
        lastSyncAt = syncRow?.last_synced_at ?? null;
    } else {
        const syncRow = await db.get<{ last_synced_at: string }>(
            `SELECT MAX(last_synced_at) as last_synced_at FROM salesnav_lists`,
        );
        lastSyncAt = syncRow?.last_synced_at ?? null;
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

// ─── L3: Config Status Collection ───────────────────────────────────────────

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

    // Cookie freshness check per ogni account
    const staleAccounts: string[] = [];
    const noLoginAccounts: string[] = [];
    const accounts = getRuntimeAccountProfiles();
    for (const acc of accounts) {
        const freshness = checkSessionFreshness(acc.sessionDir, config.sessionCookieMaxAgeDays);
        if (freshness.lastVerifiedAt === null) {
            noLoginAccounts.push(acc.id);
        } else if (freshness.needsRotation) {
            staleAccounts.push(`${acc.id} (${freshness.sessionAgeDays}d)`);
        }
    }

    const weeklyInvitesSent = await countWeeklyInvites(getWeekStartDate());

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
        weeklyInvitesSent,
        weeklyInviteLimit: config.weeklyInviteLimit,
        proxyIpReputation,
        staleAccounts,
        noLoginAccounts,
    };
}

/**
 * Helper per tutti i workflow: aggiunge warning se il proxy e' blacklisted.
 * Chiamare dentro generateWarnings() di ogni workflow.
 */
export function appendProxyReputationWarning(warnings: PreflightWarning[], cfgStatus: PreflightConfigStatus): void {
    if (cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe) {
        warnings.push({
            level: 'critical',
            message: `Proxy IP ${cfgStatus.proxyIpReputation.ip} BLACKLISTED (abuse score: ${cfgStatus.proxyIpReputation.abuseScore}/100, ISP: ${cfgStatus.proxyIpReputation.isp}). Cambiare proxy prima di procedere.`,
        });
    }
    if (cfgStatus.staleAccounts.length > 0) {
        warnings.push({
            level: 'warn',
            message: `Cookie sessione scaduti per: ${cfgStatus.staleAccounts.join(', ')}. Rinnovare il profilo con create-profile.`,
        });
    }
    if (cfgStatus.noLoginAccounts.length > 0) {
        warnings.push({
            level: 'critical',
            message: `Nessun login registrato per: ${cfgStatus.noLoginAccounts.join(', ')}. Esegui "bot login" prima di procedere.`,
        });
    }
}

// ─── L4: Session Risk Assessment ────────────────────────────────────────────

/**
 * Calcola il livello di rischio della sessione prima di procedere.
 * Combina 6 segnali con pesi diversi per produrre un score 0-100.
 *
 * Score -> Livello:
 *   0-30  -> GO (procedere normalmente)
 *   31-60 -> CAUTION (procedere con budget ridotto)
 *   61+   -> STOP (non procedere, rischio ban alto)
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
    const challengeFactor = Math.min(30, challengesLast7d * 15);

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
    const pendingFactor = Math.min(25, Math.floor(pendingRatio * 40));

    // Factor 3: Error rate oggi — peso 20
    const errorsToday = await getDailyStat(localDate, 'run_errors');
    const processedToday = cfgStatus.invitesSentToday + cfgStatus.messagesSentToday;
    const errorRate = processedToday > 0 ? errorsToday / processedToday : 0;
    const errorFactor = Math.min(20, Math.floor(errorRate * 50));

    // Factor 4: Proxy reputation — peso 15
    const proxyFactor = cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe
        ? Math.min(15, Math.floor(cfgStatus.proxyIpReputation.abuseScore / 7))
        : 0;

    // Factor 5: Tempo dall'ultimo run — peso 10
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

    // Factor 6: Disk space — peso 15
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

// ─── L5: AI Advisor ─────────────────────────────────────────────────────────

/**
 * L5: Chiede all'AI di analizzare lo stato del sistema e consigliare
 * se procedere, con cautela, o abortire. Usa i dati raccolti da L2+L3+L4.
 *
 * Best-effort: se l'AI non e' configurata o la chiamata fallisce,
 * ritorna { available: false } e il workflow prosegue normalmente.
 */
async function runAiAdvisor(
    workflowName: string,
    dbStats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    riskAssessment: SessionRiskAssessment,
    warnings: PreflightWarning[],
): Promise<AiAdvisorResult> {
    // Se AI non configurata, skip silenziosamente
    if (!cfgStatus.aiConfigured) {
        return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
    }

    try {
        const { isOpenAIConfigured, requestOpenAIText } = await import('../ai/openaiClient');
        if (!isOpenAIConfigured()) {
            return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
        }

        const statusBreakdown = Object.entries(dbStats.byStatus)
            .map(([s, c]) => `${s}: ${c}`)
            .join(', ');
        const listBreakdown = Object.entries(dbStats.byList)
            .slice(0, 10)
            .map(([l, c]) => `"${l}": ${c}`)
            .join(', ');
        const warningsSummary = warnings.length > 0
            ? warnings.map(w => `[${w.level}] ${w.message}`).join('\n')
            : 'Nessun warning';
        const riskFactors = Object.entries(riskAssessment.factors)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');

        const prompt = `Sei l'AI advisor di un sistema di automazione LinkedIn. Analizza lo stato del sistema e decidi se il workflow "${workflowName}" deve procedere.

STATO DATABASE (L2):
- Lead totali: ${dbStats.totalLeads}
- Per status: ${statusBreakdown || 'nessuno'}
- Per lista: ${listBreakdown || 'nessuna'}
- Con email: ${dbStats.withEmail}/${dbStats.totalLeads} (${dbStats.totalLeads > 0 ? Math.round(dbStats.withEmail / dbStats.totalLeads * 100) : 0}%)
- Con job_title: ${dbStats.withJobTitle}/${dbStats.totalLeads}
- Con score: ${dbStats.withScore}/${dbStats.totalLeads}
- Ultimo sync: ${dbStats.lastSyncAt || 'mai'}

CONFIGURAZIONE (L3):
- Proxy: ${cfgStatus.proxyConfigured ? 'OK' : 'MANCANTE'}${cfgStatus.proxyIpReputation ? ` (abuse score: ${cfgStatus.proxyIpReputation.abuseScore}/100)` : ''}
- Budget inviti: ${cfgStatus.invitesSentToday}/${cfgStatus.budgetInvites} oggi, ${cfgStatus.weeklyInvitesSent}/${cfgStatus.weeklyInviteLimit} settimana
- Budget messaggi: ${cfgStatus.messagesSentToday}/${cfgStatus.budgetMessages} oggi
- API enrichment: Apollo=${cfgStatus.apolloConfigured}, Hunter=${cfgStatus.hunterConfigured}, Clearbit=${cfgStatus.clearbitConfigured}
- Warmup: ${cfgStatus.warmupEnabled ? 'ATTIVO' : 'disabilitato'}
- Cookie scaduti: ${cfgStatus.staleAccounts.length > 0 ? cfgStatus.staleAccounts.join(', ') : 'nessuno'}

RISK ASSESSMENT (L4):
- Score: ${riskAssessment.score}/100 (${riskAssessment.level})
- Fattori attivi: ${riskFactors || 'nessuno'}

WARNING ATTIVI:
${warningsSummary}

Rispondi SOLO in formato JSON con questa struttura:
{
  "recommendation": "PROCEED" | "PROCEED_CAUTION" | "ABORT",
  "reasoning": "spiegazione breve (1-2 frasi) in italiano",
  "suggestedActions": ["azione 1", "azione 2"]
}

Regole:
- ABORT solo se ci sono condizioni critiche che rischiano ban (proxy blacklisted, pending ratio >60%, budget esaurito)
- PROCEED_CAUTION se ci sono warning importanti ma non bloccanti
- PROCEED se tutto e' in ordine
- suggestedActions: max 3 suggerimenti concreti e brevi`;

        const response = await requestOpenAIText({
            system: 'Sei un esperto di automazione LinkedIn e anti-detection. Rispondi solo in JSON valido.',
            user: prompt,
            maxOutputTokens: 300,
            temperature: 0.3,
            responseFormat: 'json_object',
        });

        const parsed = JSON.parse(response) as {
            recommendation?: string;
            reasoning?: string;
            suggestedActions?: string[];
        };

        const rec = parsed.recommendation?.toUpperCase();
        const recommendation = rec === 'ABORT' ? 'ABORT'
            : rec === 'PROCEED_CAUTION' ? 'PROCEED_CAUTION'
            : 'PROCEED';

        return {
            available: true,
            recommendation,
            reasoning: parsed.reasoning ?? '',
            suggestedActions: Array.isArray(parsed.suggestedActions)
                ? parsed.suggestedActions.slice(0, 3)
                : [],
        };
    } catch {
        // AI advisor e' best-effort: se fallisce, non blocca il workflow
        return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
    }
}

// ─── L6: Anti-Ban Checklist ─────────────────────────────────────────────────

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

    const statusLine = Object.entries(stats.byStatus)
        .map(([s, c]) => `${s}=${c}`)
        .join(', ');
    entries.push(['Lead per status:', statusLine || '(nessuno)']);

    console.log(formatPreflightSection('L2: STATO DATABASE', entries));
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
        ['Budget inviti sett.:', `${cs.weeklyInvitesSent}/${cs.weeklyInviteLimit} questa settimana`],
        ['Budget messaggi:', `${cs.messagesSentToday}/${cs.budgetMessages} oggi`],
    ];

    console.log(formatPreflightSection('L3: CONFIG ATTIVA', entries));
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

function displayAiAdvice(advice: AiAdvisorResult): void {
    if (!advice.available) return;

    const icon = advice.recommendation === 'PROCEED' ? '[OK]'
        : advice.recommendation === 'PROCEED_CAUTION' ? '[!]'
        : '[!!!]';
    const label = advice.recommendation === 'PROCEED' ? 'PROCEDERE'
        : advice.recommendation === 'PROCEED_CAUTION' ? 'PROCEDERE CON CAUTELA'
        : 'NON PROCEDERE';

    console.log('');
    console.log(`  L5: AI ADVISOR — ${icon} ${label}`);
    if (advice.reasoning) {
        console.log(`      ${advice.reasoning}`);
    }
    if (advice.suggestedActions.length > 0) {
        console.log('      Azioni suggerite:');
        for (const action of advice.suggestedActions) {
            console.log(`        - ${action}`);
        }
    }
}

/**
 * L6: Checklist anti-ban interattiva context-aware.
 * Le domande dipendono dai dati raccolti in L2/L3/L4.
 */
async function runAntiBanChecklist(
    workflowName: string,
    dbStats?: PreflightDbStats,
    _cfgStatus?: PreflightConfigStatus,
): Promise<boolean> {
    const isOutreach = workflowName === 'send-invites' || workflowName === 'send-messages';
    const minHours = isOutreach ? 2 : 1;

    // Raccolta dati per domande intelligenti
    const accounts = getRuntimeAccountProfiles();
    let recentSessionHours: number | null = null;
    for (const acc of accounts) {
        const lastTs = await getRuntimeFlag(`browser_session_started_at:${acc.id}`).catch(() => null);
        if (lastTs) {
            const parsedMs = Date.parse(lastTs);
            if (Number.isFinite(parsedMs)) {
                const h = (Date.now() - parsedMs) / 3600000;
                if (recentSessionHours === null || h < recentSessionHours) recentSessionHours = h;
            }
        }
    }

    const pendingCount = dbStats?.byStatus['INVITED'] ?? 0;
    const totalInvited = dbStats ? Object.values(dbStats.byStatus).reduce((s, v) => s + v, 0) : 0;
    const pendingRatio = totalInvited > 0 ? pendingCount / totalInvited : 0;
    const readyInvite = dbStats?.byStatus['READY_INVITE'] ?? 0;
    const readyMessage = (dbStats?.byStatus['ACCEPTED'] ?? 0) + (dbStats?.byStatus['READY_MESSAGE'] ?? 0);
    const lastSyncDaysAgo = dbStats?.lastSyncAt
        ? Math.floor((Date.now() - new Date(dbStats.lastSyncAt).getTime()) / 86400000)
        : null;
    const leadsWithoutEmail = dbStats?.withoutEmail ?? 0;
    const totalLeads = dbStats?.totalLeads ?? 0;
    const isFirstSessionToday = recentSessionHours === null || recentSessionHours > 12;

    console.log('');
    console.log('  L6: CHECKLIST ANTI-BAN');
    console.log('');

    // Domanda 1: SEMPRE — rapida, unica domanda bloccante
    const tabOk = await askConfirmation('    Tab LinkedIn chiusi e browser pronto? [Y/n] ');
    if (!tabOk) {
        console.log('      -> Chiudi TUTTI i tab LinkedIn. Per fermare: Ctrl+C (mai chiudere la finestra).');
        console.log('');
        console.log('  [!!!] Risolvi prima di procedere.');
        return false;
    }

    // Domande context-aware (solo se i dati le richiedono)

    // Sessione recente: chiedi solo se < minHours
    if (recentSessionHours !== null && recentSessionHours < minHours) {
        const minLeft = Math.ceil((minHours - recentSessionHours) * 60);
        const proceedAnyway = await askConfirmation(`    [!] Ultima sessione ${recentSessionHours.toFixed(1)}h fa (consigliato ${minHours}h). Procedere comunque? [y/N] `);
        if (!proceedAnyway) {
            console.log(`      -> Attendi ~${minLeft} minuti prima della prossima sessione.`);
            return false;
        }
    }

    // Pending ratio alto: offri di ritirare inviti vecchi
    if (isOutreach && pendingRatio > 0.50 && pendingCount > 10) {
        console.log(`    [!] Pending ratio: ${Math.round(pendingRatio * 100)}% (${pendingCount} inviti in attesa)`);
        console.log(`        LinkedIn flagga account con pending ratio >65%.`);
        console.log(`        Consiglio: ritira inviti vecchi con "bot.ps1 run check" prima di inviare nuovi.`);
        console.log('');
    }

    // Dati obsoleti: suggerisci sync prima
    if (lastSyncDaysAgo !== null && lastSyncDaysAgo > 7) {
        console.log(`    [!] Ultimo sync: ${lastSyncDaysAgo} giorni fa — i dati potrebbero essere obsoleti.`);
        console.log('        Consiglio: lancia "bot.ps1 sync-list" per aggiornare prima di procedere.');
        console.log('');
    }

    // Lead incompleti: suggerisci enrichment
    if (totalLeads > 10 && leadsWithoutEmail > totalLeads * 0.7) {
        console.log(`    [i] ${leadsWithoutEmail}/${totalLeads} lead senza email — l'enrichment migliorera' la personalizzazione.`);
        console.log('');
    }

    // Nessun lead pronto per il workflow specifico
    if (workflowName === 'send-invites' && readyInvite === 0) {
        console.log('    [!] 0 lead READY_INVITE — non ci sono lead pronti da invitare.');
        console.log('        Lancia prima "bot.ps1 sync-search" o "bot.ps1 sync-list" con enrichment.');
        console.log('');
    }
    if (workflowName === 'send-messages' && readyMessage === 0) {
        console.log('    [!] 0 lead pronti per messaggi — attendi che qualcuno accetti i tuoi inviti.');
        console.log('');
    }

    // Tips sessione
    console.log('  TIPS SESSIONE:');
    console.log('    [i] CAPTCHA: il bot li risolve automaticamente (GPT-5.4 + Ollama fallback)');
    if (isFirstSessionToday) {
        console.log('    [i] Prima sessione oggi: il bot fara\' warmup (feed + notifiche) prima di agire');
    }
    console.log(`    [i] Dopo la sessione: aspetta almeno ${minHours}h prima di usare LinkedIn`);
    console.log('');

    return true;
}

// ─── Main Pre-flight Runner ─────────────────────────────────────────────────

export interface PreflightConfig {
    workflowName: string;
    questions: PreflightQuestion[];
    listFilter?: string;
    generateWarnings: (stats: PreflightDbStats, config: PreflightConfigStatus, answers: Record<string, string>) => PreflightWarning[];
    skipPreflight?: boolean;
    cliOverrides?: Record<string, string>;
    /** L1: accountId da CLI --account flag. */
    cliAccountId?: string;
}

export async function runPreflight(pfConfig: PreflightConfig): Promise<PreflightResult> {
    const answers: Record<string, string> = { ...pfConfig.cliOverrides };

    // Se --skip-preflight o non-TTY, usa defaults (livelli L2+L3+L4 still run)
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

        // STOP blocca anche in modalita' non-interattiva
        if (riskAssessment.level === 'STOP') {
            return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment };
        }

        return { answers, dbStats, configStatus, warnings, confirmed: true, riskAssessment };
    }

    console.log('');
    console.log('================================================================');
    console.log(`  PRE-FLIGHT: ${pfConfig.workflowName.toUpperCase()} (6 LIVELLI DI CONTROLLO)`);
    console.log('================================================================');

    // Mostra posizione nel funnel
    const funnelSteps = [
        { cmd: 'sync-search', label: 'Ricerca → Lista SalesNav' },
        { cmd: 'sync-list', label: 'Lista SalesNav → DB' },
        { cmd: 'send-invites', label: 'Invita lead pronti' },
        { cmd: 'send-messages', label: 'Messaggia chi ha accettato' },
    ];
    const currentStep = funnelSteps.findIndex(s => s.cmd === pfConfig.workflowName);
    if (currentStep >= 0) {
        console.log('');
        console.log('  FUNNEL: ' + funnelSteps.map((s, i) =>
            i === currentStep ? `[${i + 1}. ${s.label}]` : `${i + 1}. ${s.label}`,
        ).join(' → '));
    }

    // ── L1: Account Selection ────────────────────────────────────────────────
    const selectedAccountId = await selectAccount(pfConfig.cliAccountId);
    if (selectedAccountId) {
        answers['_accountId'] = selectedAccountId;
    }

    // ── L2: DB Analysis ──────────────────────────────────────────────────────
    const earlyListFilter = pfConfig.cliOverrides?.['listName'] ?? pfConfig.listFilter;
    const dbStats = await collectDbStats(earlyListFilter);

    // ── L3: Config Validation ────────────────────────────────────────────────
    const configStatus = await collectConfigStatus();

    // ── L6: Anti-Ban Checklist (eseguita prima delle domande per bloccare subito) ──
    const checklistPassed = await runAntiBanChecklist(pfConfig.workflowName, dbStats, configStatus);
    if (!checklistPassed) {
        return {
            answers,
            dbStats,
            configStatus,
            warnings: [],
            confirmed: false,
            riskAssessment: { level: 'STOP', score: 100, factors: { checklist: 100 }, recommendation: 'Checklist anti-ban non superata' },
            selectedAccountId,
        };
    }

    // ── Domande interattive (workflow-specific) ──────────────────────────────
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

    // Aggiorna listFilter con eventuale risposta dell'utente
    const listFilter = answers['list'] ?? answers['listName'] ?? earlyListFilter;
    const warnings = pfConfig.generateWarnings(dbStats, configStatus, answers);

    // ── L4: Risk Assessment ──────────────────────────────────────────────────
    const riskAssessment = await computeSessionRiskLevel(configStatus);

    // ── Display L2 + L3 ──────────────────────────────────────────────────────
    console.log('');
    displayDbStats(dbStats, listFilter);
    console.log('');
    displayConfigStatus(configStatus);
    displayWarnings(warnings);

    // ── Display L4 ───────────────────────────────────────────────────────────
    console.log('');
    const riskIcon = riskAssessment.level === 'GO' ? '[OK]' : riskAssessment.level === 'CAUTION' ? '[!]' : '[!!!]';
    console.log(`  L4: RISK ASSESSMENT — ${riskIcon} ${riskAssessment.level} (score: ${riskAssessment.score}/100)`);
    console.log(`      ${riskAssessment.recommendation}`);
    if (riskAssessment.score > 30) {
        const factorDetails = Object.entries(riskAssessment.factors)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        if (factorDetails) console.log(`      Fattori: ${factorDetails}`);
    }

    // ── L5: AI Advisor ───────────────────────────────────────────────────────
    let aiAdvice: AiAdvisorResult | undefined;
    if (configStatus.aiConfigured) {
        console.log('');
        console.log('  L5: AI Advisor in analisi...');
        aiAdvice = await runAiAdvisor(
            pfConfig.workflowName,
            dbStats,
            configStatus,
            riskAssessment,
            warnings,
        );
        displayAiAdvice(aiAdvice);

        // AI dice ABORT: blocca (ma l'utente puo' forzare)
        if (aiAdvice.available && aiAdvice.recommendation === 'ABORT') {
            console.log('');
            const forceOverride = await askConfirmation('  [!!!] L\'AI consiglia di NON procedere. Vuoi forzare comunque? [y/N] ');
            if (!forceOverride) {
                return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment, selectedAccountId, aiAdvice };
            }
            console.log('  -> Override utente: si procede nonostante il consiglio AI.');
        }
    }
    console.log('');

    // STOP blocca l'esecuzione
    if (riskAssessment.level === 'STOP') {
        console.log('  [!!!] Risk level STOP — sessione NON sicura. Risolvere prima di procedere.');
        return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment, selectedAccountId, aiAdvice };
    }

    // Critical warnings block execution
    const hasCritical = warnings.some((w) => w.level === 'critical');
    if (hasCritical) {
        console.log('  [!!!] Condizioni critiche rilevate. Risolvere prima di procedere.');
        return { answers, dbStats, configStatus, warnings, confirmed: false, riskAssessment, selectedAccountId, aiAdvice };
    }

    const confirmed = await askConfirmation('  Procedo? [Y/n] ');

    // Rilascia stdin dopo le domande
    process.stdin.pause();

    return { answers, dbStats, configStatus, warnings, confirmed, riskAssessment, selectedAccountId, aiAdvice };
}
