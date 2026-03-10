/**
 * risk/sessionMemory.ts
 * ─────────────────────────────────────────────────────────────────
 * Cross-session behavioral memory.
 *
 * Tracks daily activity patterns per account and exposes
 * `getSessionHistory()` to load the last N days of patterns.
 * The scheduler uses this to:
 *   - Maintain consistent login/logout hour windows
 *   - Modulate inter-action intervals based on recent averages
 *   - Detect anomalies (sudden spikes = risk)
 */

import { getDatabase } from '../db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionPatternRow {
    account_id: string;
    date: string;
    login_hour: number | null;
    logout_hour: number | null;
    total_actions: number;
    invite_count: number;
    message_count: number;
    check_count: number;
    avg_interval_ms: number | null;
    peak_hour: number | null;
    challenges: number;
}

export interface SessionHistorySummary {
    /** Number of days with recorded activity */
    daysWithActivity: number;
    /** Average total actions across recent days */
    avgDailyActions: number;
    /** Average invites across recent days */
    avgDailyInvites: number;
    /** Average messages across recent days */
    avgDailyMessages: number;
    /** Most common login hour (mode) */
    typicalLoginHour: number | null;
    /** Most common logout hour (mode) */
    typicalLogoutHour: number | null;
    /** Average inter-action interval across recent days (ms) */
    avgIntervalMs: number | null;
    /** Recent challenge count sum */
    recentChallenges: number;
    /**
     * Pacing factor 0.5–1.2:
     *  - < 1.0 if recent days had challenges or were high-volume
     *  - > 1.0 if recent days were quiet (can be slightly more aggressive)
     */
    pacingFactor: number;
    /** Raw rows for advanced consumers */
    rows: SessionPatternRow[];
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Load the last `lookbackDays` of session patterns for an account.
 */
export async function getSessionHistory(
    accountId: string,
    lookbackDays = 7,
): Promise<SessionHistorySummary> {
    const db = await getDatabase();
    const safeDays = Math.max(1, Math.min(30, Math.floor(lookbackDays)));

    const rows = await db.query<{
        account_id: string;
        date: string;
        login_hour: number | null;
        logout_hour: number | null;
        total_actions: number;
        invite_count: number;
        message_count: number;
        check_count: number;
        avg_interval_ms: number | null;
        peak_hour: number | null;
        challenges: number;
    }>(
        `SELECT account_id, date, login_hour, logout_hour,
                total_actions, invite_count, message_count, check_count,
                avg_interval_ms, peak_hour, challenges
         FROM session_patterns
         WHERE account_id = ?
           AND date >= date('now', '-' || ? || ' days')
         ORDER BY date DESC
         LIMIT ?`,
        [accountId, safeDays, safeDays],
    );

    if (rows.length === 0) {
        return {
            daysWithActivity: 0,
            avgDailyActions: 0,
            avgDailyInvites: 0,
            avgDailyMessages: 0,
            typicalLoginHour: null,
            typicalLogoutHour: null,
            avgIntervalMs: null,
            recentChallenges: 0,
            pacingFactor: 1.0,
            rows: [],
        };
    }

    const activeDays = rows.filter((r) => r.total_actions > 0);
    const dayCount = activeDays.length || 1;

    const sumActions = activeDays.reduce((s, r) => s + r.total_actions, 0);
    const sumInvites = activeDays.reduce((s, r) => s + r.invite_count, 0);
    const sumMessages = activeDays.reduce((s, r) => s + r.message_count, 0);
    const sumChallenges = rows.reduce((s, r) => s + r.challenges, 0);

    const intervalsWithData = activeDays.filter((r) => r.avg_interval_ms !== null && r.avg_interval_ms !== undefined);
    const avgInterval =
        intervalsWithData.length > 0
            ? Math.round(intervalsWithData.reduce((s, r) => s + (r.avg_interval_ms ?? 0), 0) / intervalsWithData.length)
            : null;

    const typicalLoginHour = computeMode(activeDays.map((r) => r.login_hour).filter((h): h is number => h !== null && h !== undefined));
    const typicalLogoutHour = computeMode(activeDays.map((r) => r.logout_hour).filter((h): h is number => h !== null && h !== undefined));

    // Pacing factor: conservative if challenges exist, slightly aggressive if quiet
    let pacingFactor = 1.0;
    if (sumChallenges >= 3) {
        pacingFactor = 0.5; // significant recent challenges → halve pacing
    } else if (sumChallenges >= 1) {
        pacingFactor = 0.75; // mild caution
    } else if (dayCount >= 3 && sumActions / dayCount < 10) {
        pacingFactor = 1.1; // consistently quiet → slightly more room
    }

    return {
        daysWithActivity: dayCount,
        avgDailyActions: Math.round(sumActions / dayCount),
        avgDailyInvites: Math.round(sumInvites / dayCount),
        avgDailyMessages: Math.round(sumMessages / dayCount),
        typicalLoginHour,
        typicalLogoutHour,
        avgIntervalMs: avgInterval,
        recentChallenges: sumChallenges,
        pacingFactor,
        rows,
    };
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Upsert today's session pattern for an account.
 * Called at the end of each loop cycle to record activity.
 */
export async function recordSessionPattern(
    accountId: string,
    date: string,
    data: {
        loginHour?: number;
        logoutHour?: number;
        totalActions: number;
        inviteCount: number;
        messageCount: number;
        checkCount: number;
        avgIntervalMs?: number;
        peakHour?: number;
        challenges: number;
    },
): Promise<void> {
    const db = await getDatabase();

    await db.run(
        `INSERT INTO session_patterns
            (account_id, date, login_hour, logout_hour,
             total_actions, invite_count, message_count, check_count,
             avg_interval_ms, peak_hour, challenges)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, date) DO UPDATE SET
             logout_hour    = COALESCE(excluded.logout_hour, logout_hour),
             total_actions  = total_actions + excluded.total_actions,
             invite_count   = invite_count + excluded.invite_count,
             message_count  = message_count + excluded.message_count,
             check_count    = check_count + excluded.check_count,
             avg_interval_ms = COALESCE(excluded.avg_interval_ms, avg_interval_ms),
             peak_hour      = COALESCE(excluded.peak_hour, peak_hour),
             challenges     = challenges + excluded.challenges`,
        [
            accountId,
            date,
            data.loginHour ?? null,
            data.logoutHour ?? null,
            data.totalActions,
            data.inviteCount,
            data.messageCount,
            data.checkCount,
            data.avgIntervalMs ?? null,
            data.peakHour ?? null,
            data.challenges,
        ],
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeMode(values: number[]): number | null {
    if (values.length === 0) return null;
    const freq = new Map<number, number>();
    for (const v of values) {
        freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    let best = values[0];
    let bestCount = 0;
    for (const [val, count] of freq) {
        if (count > bestCount) {
            best = val;
            bestCount = count;
        }
    }
    return best;
}
