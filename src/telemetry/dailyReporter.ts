import { sendTelegramAlert } from './alerts';
import { getDailyStatsSnapshot } from '../core/repositories';
import { getDatabase } from '../db';
import { getLocalDateString } from '../config';
import { getTopTimeSlots } from '../ml/timingOptimizer';
import { getVariantLeaderboard } from '../ml/abBandit';

export async function generateAndSendDailyReport(targetDate?: string): Promise<boolean> {
    const localDate = targetDate || getLocalDateString();

    // Raccogliamo i dati aggregati di tutto il giorno da `daily_stats`
    const stats = await getDailyStatsSnapshot(localDate);

    // Contiamo le conversioni e l'impatto funnel globale attingendo alla tabella leads
    const db = await getDatabase();

    const leadsAccepted = await db.get<{ count: number }>(`
        SELECT COUNT(*) as count FROM leads WHERE accepted_at LIKE ? || '%'
    `, [localDate]);

    const leadsMessaged = await db.get<{ count: number }>(`
        SELECT COUNT(*) as count FROM leads WHERE messaged_at LIKE ? || '%'
    `, [localDate]);

    const leadsReplied = await db.get<{ count: number }>(`
        SELECT COUNT(*) as count FROM leads WHERE status = 'REPLIED' AND updated_at LIKE ? || '%'
    `, [localDate]);

    const campaignRunsStats = await db.get<{
        total_runs: number,
        total_discovered: number,
        failed_runs: number
    }>(`
        SELECT 
            COUNT(id) as total_runs, 
            COALESCE(SUM(profiles_discovered), 0) as total_discovered,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_runs
        FROM campaign_runs 
        WHERE start_time LIKE ? || '%'
    `, [localDate]);

    // AB Testing section
    const abStats = await getVariantLeaderboard().catch(() => []);
    const abSection = abStats.length > 0
        ? [
            `\n*🧪 A/B Varianti Note (Bandit)*`,
            ...abStats.map(v =>
                `• \`${v.variantId}\`: sent=${v.sent} acc=${(v.acceptanceRate * 100).toFixed(0)}% reply=${(v.replyRate * 100).toFixed(0)}% UCB=${v.ucbScore}`
            )
        ].join('\n')
        : '';

    // Best timing slots
    const topSlots = await getTopTimeSlots(3).catch(() => []);
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const timingSection = topSlots.length > 0
        ? [
            `\n*⏰ Best Time Slots (storico)*`,
            ...topSlots.map(s =>
                `• ${DOW_LABELS[s.dayOfWeek]} ${String(s.hour).padStart(2, '0')}:00 → score=${s.score} (n=${s.sampleSize})`
            )
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
        `\n*🤖 Bot Execution*`,
        `• Campaign Runs Totali: *${campaignRunsStats?.total_runs ?? 0}*`,
        `• Fallimenti Critici Runs: *${campaignRunsStats?.failed_runs ?? 0}*`,
        `\n*⚠️ Risk & Health*`,
        `• Errori Esecuzione (Job/Orchestrator): *${stats.runErrors}*`,
        `• Problemi Selettori UI: *${stats.selectorFailures}*`,
        `• Challenge LinkedIn Apparse: *${stats.challengesCount}*`,
        abSection,
        timingSection,
    ].filter(s => s.length > 0).join('\n');

    await sendTelegramAlert(reportText, 'LinkedIn Bot Daily Report', 'info');

    console.log(`[DAILY_REPORTER] Report inviato a Telegram per la data ${localDate}`);
    return true;
}
