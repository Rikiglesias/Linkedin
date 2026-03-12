import { sendTelegramAlert } from './alerts';
import { getDailyStatsSnapshot, getOperationalObservabilitySnapshot, getRiskInputs } from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';
import { getDatabase } from '../db';
import { config, getLocalDateString } from '../config';
import { getTimingExperimentReport, getTopTimeSlots } from '../ml/timingOptimizer';
import { getVariantLeaderboard } from '../ml/abBandit';
import { getProxyQualityStatus } from '../proxyManager';

export async function generateAndSendDailyReport(targetDate?: string): Promise<boolean> {
    const localDate = targetDate || getLocalDateString();

    // Raccogliamo i dati aggregati di tutto il giorno da `daily_stats`
    const stats = await getDailyStatsSnapshot(localDate);
    const observability = await getOperationalObservabilitySnapshot(localDate);

    // Risk snapshot per pending ratio e risk score — i KPI più importanti per l'utente
    const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
    const riskSnapshot = evaluateRisk(riskInputs);

    // Contiamo le conversioni e l'impatto funnel globale attingendo alla tabella leads
    const db = await getDatabase();

    const leadsAccepted = await db.get<{ count: number }>(
        `
        SELECT COUNT(*) as count FROM leads WHERE accepted_at LIKE ? || '%'
    `,
        [localDate],
    );

    const leadsMessaged = await db.get<{ count: number }>(
        `
        SELECT COUNT(*) as count FROM leads WHERE messaged_at LIKE ? || '%'
    `,
        [localDate],
    );

    const leadsReplied = await db.get<{ count: number }>(
        `
        SELECT COUNT(*) as count FROM leads WHERE status = 'REPLIED' AND updated_at LIKE ? || '%'
    `,
        [localDate],
    );

    const campaignRunsStats = await db.get<{
        total_runs: number;
        total_discovered: number;
        failed_runs: number;
    }>(
        `
        SELECT 
            COUNT(id) as total_runs, 
            COALESCE(SUM(profiles_discovered), 0) as total_discovered,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_runs
        FROM campaign_runs 
        WHERE start_time LIKE ? || '%'
    `,
        [localDate],
    );

    // AB Testing section
    const abStats = await getVariantLeaderboard().catch(() => []);
    const abSection =
        abStats.length > 0
            ? [
                  `\n*🧪 A/B Varianti Note (Bandit)*`,
                  ...abStats.map(
                      (v) =>
                          `• \`${v.variantId}${v.significanceWinner ? ' (WIN)' : ''}\`: sent=${v.sent} acc=${(v.acceptanceRate * 100).toFixed(0)}% reply=${(v.replyRate * 100).toFixed(0)}% score=${(v.bayesScore ?? v.ucbScore ?? 0).toFixed(3)}`,
                  ),
              ].join('\n')
            : '';

    // Best timing slots
    const topSlots = await getTopTimeSlots(3).catch(() => []);
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const timingSection =
        topSlots.length > 0
            ? [
                  `\n*⏰ Best Time Slots (storico)*`,
                  ...topSlots.map(
                      (s) =>
                          `• ${DOW_LABELS[s.dayOfWeek]} ${String(s.hour).padStart(2, '0')}:00 → score=${s.score} (n=${s.sampleSize})`,
                  ),
              ].join('\n')
            : '';

    const timingExperiment = await getTimingExperimentReport('invite').catch(() => null);
    const timingExperimentSection = timingExperiment
        ? [
              `\n*🧪 Timing A/B (invite)*`,
              `• baseline: sent=${timingExperiment.baseline.sent} rate=${(timingExperiment.baseline.successRate * 100).toFixed(1)}%`,
              `• optimizer: sent=${timingExperiment.optimizer.sent} rate=${(timingExperiment.optimizer.successRate * 100).toFixed(1)}%`,
              `• lift: ${timingExperiment.liftAbsolute === null ? 'n/a' : `${(timingExperiment.liftAbsolute * 100).toFixed(1)}%`}`,
              `• significance: ${
                  timingExperiment.significance?.pValue === null || timingExperiment.significance === null
                      ? 'n/a'
                      : `p=${timingExperiment.significance.pValue.toFixed(4)} (alpha=${timingExperiment.significance.alpha})`
              }`,
          ].join('\n')
        : '';

    const sloSections = observability.slo.windows.map((window) => {
        return `• ${window.windowDays}d status=${window.status} err=${(window.errorRate * 100).toFixed(1)}% chall=${(window.challengeRate * 100).toFixed(1)}% sel=${(window.selectorFailureRate * 100).toFixed(1)}%`;
    });
    const sloSection = [
        `\n*📈 Operational SLO/SLA*`,
        `• Status globale: *${observability.slo.status}*`,
        `• Stato corrente: *${observability.slo.current.status}* (queueLag=${observability.slo.current.queueLagSeconds}s, oldestRunning=${observability.slo.current.oldestRunningJobSeconds}s)`,
        ...sloSections,
    ].join('\n');
    const selectorKpiReduction =
        observability.selectorCacheKpi.reductionPct === null
            ? 'n/a'
            : `${observability.selectorCacheKpi.reductionPct.toFixed(1)}%`;
    const selectorKpiTarget = `${(observability.selectorCacheKpi.targetReductionRate * 100).toFixed(0)}%`;
    const selectorKpiStatus = observability.selectorCacheKpi.validationStatus;
    const selectorKpiBaselineNote = observability.selectorCacheKpi.baselineSufficient
        ? ''
        : ` (baseline<${observability.selectorCacheKpi.minBaselineFailures})`;
    const selectorCacheKpiSection = [
        `\n*🎯 Selector Cache KPI (7d)*`,
        `• Validation: *${selectorKpiStatus}* (riduzione=${selectorKpiReduction}, target=${selectorKpiTarget})${selectorKpiBaselineNote}`,
        `• Failures: corrente=${observability.selectorCacheKpi.currentFailures}, precedente=${observability.selectorCacheKpi.previousFailures}`,
    ].join('\n');

    // F-3: Hot leads — top 3 lead con intent POSITIVE/QUESTIONS oggi
    const hotLeads = await db.query<{ first_name: string; last_name: string; account_name: string; linkedin_url: string; confidence: number; intent: string }>(
        `SELECT l.first_name, l.last_name, l.account_name, l.linkedin_url, 
                li.confidence, li.intent
         FROM lead_intents li
         JOIN leads l ON l.id = li.lead_id
         WHERE li.intent IN ('POSITIVE', 'QUESTIONS')
           AND li.confidence >= 0.8
           AND li.detected_at LIKE ? || '%'
         ORDER BY li.confidence DESC
         LIMIT 3`,
        [localDate],
    ).catch(() => [] as Array<{ first_name: string; last_name: string; account_name: string; linkedin_url: string; confidence: number; intent: string }>);

    const hotLeadsSection = hotLeads.length > 0
        ? [
            `\n*🔥 Hot Leads (intent positivo oggi)*`,
            ...hotLeads.map((hl) => {
                const name = `${hl.first_name || ''} ${hl.last_name || ''}`.trim() || 'Lead';
                const company = hl.account_name ? ` (${hl.account_name})` : '';
                return `• ${name}${company} — ${hl.intent} ${Math.round(hl.confidence * 100)}%`;
            }),
        ].join('\n')
        : '';

    // F-3: Pending ratio trend — confronto vs ieri e media 7 giorni
    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayRiskInputs = await getRiskInputs(yesterdayDate, config.hardInviteCap).catch(() => null);
    const yesterdayPendingRatio = yesterdayRiskInputs ? yesterdayRiskInputs.pendingRatio : null;
    const pendingTrend = yesterdayPendingRatio !== null
        ? riskSnapshot.pendingRatio > yesterdayPendingRatio ? '📈 in salita' : riskSnapshot.pendingRatio < yesterdayPendingRatio ? '📉 in discesa' : '➡️ stabile'
        : '';
    const pendingTrendText = yesterdayPendingRatio !== null
        ? ` (ieri: ${(yesterdayPendingRatio * 100).toFixed(1)}% ${pendingTrend})`
        : '';

    // F-3: Suggestion automatica — ritiro inviti pending
    const expiredInvitesRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM leads WHERE status = 'INVITED' AND invited_at < DATETIME('now', '-21 days')`,
    ).catch(() => null);
    const expiredInvites = expiredInvitesRow?.count ?? 0;
    const suggestionSection = (riskSnapshot.pendingRatio > 0.5 || expiredInvites > 5)
        ? [
            `\n*💡 Suggerimenti*`,
            ...(expiredInvites > 5 ? [`• Ritira ${expiredInvites} inviti pending >21gg per abbassare il pending ratio`] : []),
            ...(riskSnapshot.pendingRatio > 0.5 ? [`• Pending ratio ${(riskSnapshot.pendingRatio * 100).toFixed(0)}% — considera di ridurre il budget inviti o migliorare il targeting`] : []),
        ].join('\n')
        : '';

    // Format Report Markdown per Telegram
    const reportText = [
        `📊 *Daily Performance Summary (${localDate})* 📊`,
        `\n*🔥 Funnel Metrics*`,
        `• Nuovi Lead Scoperti: *${campaignRunsStats?.total_discovered ?? 0}*`,
        `• Inviti Spediti: *${stats.invitesSent}*`,
        `• Nuove Connessioni Accettate: *${leadsAccepted?.count ?? 0}*`,
        `• Messaggi Follow-Up: *${leadsMessaged?.count ?? 0}*`,
        `• Risposte Ricevute: *${leadsReplied?.count ?? 0}*`,
        hotLeadsSection,
        `\n*🤖 Bot Execution*`,
        `• Campaign Runs Totali: *${campaignRunsStats?.total_runs ?? 0}*`,
        `• Fallimenti Critici Runs: *${campaignRunsStats?.failed_runs ?? 0}*`,
        `\n*⚠️ Risk & Health*`,
        `• Risk Score: *${riskSnapshot.score}/100* (${riskSnapshot.action})`,
        `• Pending Ratio: *${(riskSnapshot.pendingRatio * 100).toFixed(1)}%*${pendingTrendText}`,
        `• Errori Esecuzione (Job/Orchestrator): *${stats.runErrors}*`,
        `• Problemi Selettori UI: *${stats.selectorFailures}*`,
        `• Challenge LinkedIn Apparse: *${stats.challengesCount}*`,
        sloSection,
        selectorCacheKpiSection,
        abSection,
        timingSection,
        timingExperimentSection,
        suggestionSection,
        await buildProxyStatusSection(),
    ]
        .filter((s) => s.length > 0)
        .join('\n');

    await sendTelegramAlert(reportText, 'LinkedIn Bot Daily Report', 'info');

    console.log(`[DAILY_REPORTER] Report inviato a Telegram per la data ${localDate}`);
    return true;
}

async function buildProxyStatusSection(): Promise<string> {
    try {
        const status = await getProxyQualityStatus();
        const lines: string[] = [`\n*🛡️ Proxy & TLS Status*`];

        // Pool status
        const pool = status.pool;
        if (!pool.configured) {
            lines.push(`• Proxy: *non configurato* (connessione diretta)`);
        } else {
            lines.push(`• Pool: ${pool.total} proxy (${pool.ready} ready, ${pool.cooling} cooling)`);
            lines.push(`• Tipi: ${pool.mobile} mobile, ${pool.residential} residential, ${pool.unknown} unknown`);
        }

        // Quality report
        const quality = status.quality;
        if (quality) {
            const scoreEmoji = quality.degraded ? '🔴' : quality.overallScore >= 70 ? '🟢' : '🟡';
            lines.push(`• Quality Score: ${scoreEmoji} *${quality.overallScore}/100*`);
            if (quality.datacenterCount > 0) {
                lines.push(`• ⚠️ ${quality.datacenterCount} proxy datacenter rilevati (rischio ban alto)`);
            }
        }

        // JA3 status
        const ja3 = status.ja3;
        if (ja3) {
            const ja3Emoji = ja3.status === 'SECURE' ? '🟢' : ja3.status === 'GAP' ? '🔴' : '🟡';
            lines.push(`• JA3 Spoofing: ${ja3Emoji} *${ja3.status}*${ja3.cycleTlsActive ? ' (CycleTLS attivo)' : ''}`);
            if (ja3.status === 'GAP') {
                lines.push(`• 💡 ${ja3.recommendation}`);
            }
        }

        return lines.join('\n');
    } catch {
        return '';
    }
}
