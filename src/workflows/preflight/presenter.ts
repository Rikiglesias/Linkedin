import { formatPreflightSection } from '../reportFormatter';
import type { AiAdvisorResult, PreflightConfigStatus, PreflightDbStats, PreflightWarning } from '../types';

function checkMark(ok: boolean): string {
    return ok ? '[OK]' : '[--]';
}

export function displayDbStats(stats: PreflightDbStats, listFilter?: string): void {
    const entries: Array<[string, string]> = [['Lead totali nel DB:', String(stats.totalLeads)]];

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

    if (stats.trend) {
        const t = stats.trend;
        const arrow = (v: number | null) => (v === null ? '' : v > 0 ? ` (+${v})` : v < 0 ? ` (${v})` : ' (=)');
        entries.push(['', '']);
        entries.push(['TREND vs IERI:', '']);
        entries.push(['  Inviti ieri:', `${t.invitesYesterday}`]);
        entries.push(['  Messaggi ieri:', `${t.messagesYesterday}`]);
        entries.push(['  Accettazioni ieri:', `${t.acceptancesYesterday}`]);
        if (t.challengesYesterday > 0) {
            entries.push(['  Challenge ieri:', `${t.challengesYesterday} [!]`]);
        }
        entries.push(['  Lead nuovi oggi vs ieri:', arrow(t.leadsDelta)]);
    }

    console.log(formatPreflightSection('L2: STATO DATABASE', entries));
}

export function displayConfigStatus(cs: PreflightConfigStatus): void {
    const entries: Array<[string, string]> = [
        ['Apollo API:', checkMark(cs.apolloConfigured) + ' ' + (cs.apolloConfigured ? 'configurato' : 'mancante')],
        [
            'Hunter API:',
            checkMark(cs.hunterConfigured) +
                ' ' +
                (cs.hunterConfigured ? 'configurato' : 'mancante (fallback disabilitato)'),
        ],
        [
            'Clearbit API:',
            checkMark(cs.clearbitConfigured) + ' ' + (cs.clearbitConfigured ? 'configurato' : 'mancante'),
        ],
        ['AI Personalization:', checkMark(cs.aiConfigured) + ' ' + (cs.aiConfigured ? 'attivo' : 'mancante')],
        [
            'Supabase Cloud:',
            checkMark(cs.supabaseConfigured) + ' ' + (cs.supabaseConfigured ? 'attivo' : 'non configurato'),
        ],
        ['Proxy:', checkMark(cs.proxyConfigured) + ' ' + (cs.proxyConfigured ? 'configurato' : 'diretto (no proxy)')],
        ...(cs.proxyIpReputation
            ? [
                  [
                      'Proxy IP Reputation:',
                      cs.proxyIpReputation.isSafe
                          ? `${checkMark(true)} ${cs.proxyIpReputation.ip} — score ${cs.proxyIpReputation.abuseScore}/100 (${cs.proxyIpReputation.isp}, ${cs.proxyIpReputation.country})`
                          : `${checkMark(false)} ${cs.proxyIpReputation.ip} — BLACKLISTED score ${cs.proxyIpReputation.abuseScore}/100 (${cs.proxyIpReputation.isp})`,
                  ] as [string, string],
              ]
            : []),
        ['Growth Model:', checkMark(cs.growthModelEnabled) + ' ' + (cs.growthModelEnabled ? 'attivo' : 'disabilitato')],
        [
            'Weekly Strategy:',
            checkMark(cs.weeklyStrategyEnabled) + ' ' + (cs.weeklyStrategyEnabled ? 'attivo' : 'disabilitato'),
        ],
        ['Budget inviti:', `${cs.invitesSentToday}/${cs.budgetInvites} oggi`],
        ['Budget inviti sett.:', `${cs.weeklyInvitesSent}/${cs.weeklyInviteLimit} questa settimana`],
        ['Budget messaggi:', `${cs.messagesSentToday}/${cs.budgetMessages} oggi`],
    ];

    console.log(formatPreflightSection('L3: CONFIG ATTIVA', entries));
}

export function displayWarnings(warnings: PreflightWarning[]): void {
    if (warnings.length === 0) return;

    console.log('');
    console.log('  AVVISI:');
    for (const w of warnings) {
        const prefix = w.level === 'critical' ? '[!!!]' : w.level === 'warn' ? '[!]' : '[i]';
        console.log(`    ${prefix} ${w.message}`);
    }
}

export function displayAiAdvice(advice: AiAdvisorResult): void {
    if (!advice.available) return;

    const icon =
        advice.recommendation === 'PROCEED' ? '[OK]' : advice.recommendation === 'PROCEED_CAUTION' ? '[!]' : '[!!!]';
    const label =
        advice.recommendation === 'PROCEED'
            ? 'PROCEDERE'
            : advice.recommendation === 'PROCEED_CAUTION'
              ? 'PROCEDERE CON CAUTELA'
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
    if (advice.suggestedParams) {
        const sp = advice.suggestedParams;
        const parts: string[] = [];
        if (sp.limit !== null && sp.limit !== undefined) parts.push(`limit=${sp.limit}`);
        if (sp.budgetInvites !== null && sp.budgetInvites !== undefined)
            parts.push(`budgetInvites=${sp.budgetInvites}`);
        if (sp.budgetMessages !== null && sp.budgetMessages !== undefined)
            parts.push(`budgetMessages=${sp.budgetMessages}`);
        if (parts.length > 0) {
            console.log(`      Parametri suggeriti: ${parts.join(', ')}`);
        }
    }
}
