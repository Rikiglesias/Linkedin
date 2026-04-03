import { checkDiskSpace, getDatabase } from '../../db';
import { getLocalDateString } from '../../config';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { getDailyStat, getRuntimeFlag, setRuntimeFlag } from '../../core/repositories';
import type { PreflightConfigStatus, SessionRiskAssessment } from '../types';

export async function computeSessionRiskLevel(cfgStatus: PreflightConfigStatus): Promise<SessionRiskAssessment> {
    const localDate = getLocalDateString();
    const db = await getDatabase();

    const challengeRow = await db.get<{ total: number }>(`
        SELECT COALESCE(SUM(challenges_count), 0) AS total
        FROM daily_stats WHERE date >= DATE('now', '-7 days')
    `);
    const challengesLast7d = challengeRow?.total ?? 0;
    const challengeFactor = Math.min(30, challengesLast7d * 15);

    const pendingRow = await db.get<{ pending: number; total: number }>(`
        SELECT
            COUNT(CASE WHEN status = 'INVITED' THEN 1 END) AS pending,
            COUNT(CASE WHEN invited_at IS NOT NULL THEN 1 END) AS total
        FROM leads
    `);
    const pendingTotal = pendingRow?.total ?? 0;
    const pendingRatio = pendingTotal > 0 ? (pendingRow?.pending ?? 0) / pendingTotal : 0;
    const pendingFactor = Math.min(25, Math.floor(pendingRatio * 40));

    const errorsToday = await getDailyStat(localDate, 'run_errors');
    const processedToday = cfgStatus.invitesSentToday + cfgStatus.messagesSentToday;
    const errorRate = processedToday > 0 ? errorsToday / processedToday : 0;
    const errorFactor = Math.min(20, Math.floor(errorRate * 50));

    const proxyFactor =
        cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe
            ? Math.min(15, Math.floor(cfgStatus.proxyIpReputation.abuseScore / 7))
            : 0;

    const riskAccounts = getRuntimeAccountProfiles();
    let frequencyFactor = 0;
    for (const acc of riskAccounts) {
        const lastSessionTs = await getRuntimeFlag(`browser_session_started_at:${acc.id}`).catch(() => null);
        if (lastSessionTs) {
            const parsedMs = Date.parse(lastSessionTs);
            if (Number.isFinite(parsedMs)) {
                const hoursSince = (Date.now() - parsedMs) / 3600000;
                if (hoursSince < 2) {
                    frequencyFactor = 10;
                    break;
                } else if (hoursSince < 6 && frequencyFactor < 5) {
                    frequencyFactor = 5;
                }
            }
        }
    }

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

    const score = Math.min(
        100,
        challengeFactor + pendingFactor + errorFactor + proxyFactor + frequencyFactor + diskFactor,
    );

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

    try {
        const historyRaw = await getRuntimeFlag('risk_score_history');
        const history: Array<{ date: string; score: number }> = historyRaw ? JSON.parse(historyRaw) : [];
        const today = getLocalDateString();
        const existingIdx = history.findIndex((h) => h.date === today);
        if (existingIdx >= 0) {
            history[existingIdx].score = score;
        } else {
            history.push({ date: today, score });
        }
        await setRuntimeFlag('risk_score_history', JSON.stringify(history.slice(-10)));
    } catch {
        /* best-effort */
    }

    return { level, score, factors, recommendation };
}
