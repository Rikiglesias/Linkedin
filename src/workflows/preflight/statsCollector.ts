import { getLocalDateString } from '../../config';
import { getDatabase } from '../../db';
import type { PreflightDbStats } from '../types';

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

    let trend: PreflightDbStats['trend'] = null;
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().slice(0, 10);
        const yRow = await db.get<{
            invites_sent: number;
            messages_sent: number;
            acceptances: number;
            challenges_count: number;
        }>(
            `SELECT COALESCE(SUM(invites_sent),0) as invites_sent, COALESCE(SUM(messages_sent),0) as messages_sent,
            COALESCE(SUM(acceptances),0) as acceptances, COALESCE(SUM(challenges_count),0) as challenges_count
            FROM daily_stats WHERE date = ?`,
            [yStr],
        );
        if (yRow && (yRow.invites_sent > 0 || yRow.messages_sent > 0 || yRow.acceptances > 0)) {
            const todayStr = getLocalDateString();
            const createdToday = await db.get<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM leads WHERE DATE(created_at) = ?`,
                [todayStr],
            );
            const createdYesterday = await db.get<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM leads WHERE DATE(created_at) = ?`,
                [yStr],
            );
            trend = {
                invitesYesterday: yRow.invites_sent,
                messagesYesterday: yRow.messages_sent,
                acceptancesYesterday: yRow.acceptances,
                challengesYesterday: yRow.challenges_count,
                leadsDelta: (createdToday?.cnt ?? 0) - (createdYesterday?.cnt ?? 0),
            };
        }
    } catch {
        /* trend is best-effort */
    }

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
        trend,
    };
}
