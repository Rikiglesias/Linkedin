/**
 * repositories/incidents.ts
 * Domain queries: incident creation, listing and resolution.
 */

import { getDatabase } from '../../db';

export async function createIncident(
    type: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    details: Record<string, unknown>
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `
        INSERT INTO account_incidents (type, severity, status, details_json)
        VALUES (?, ?, 'OPEN', ?)
    `,
        [type, severity, JSON.stringify(details)]
    );
    return result.lastID ?? 0;
}

export async function countRecentIncidents(type: string, sinceHours: number): Promise<number> {
    const db = await getDatabase();
    const since = new Date(Date.now() - sinceHours * 3600000).toISOString();
    const row = await db.get<{ count: number | string }>(
        `SELECT COUNT(*) as count FROM account_incidents WHERE type = ? AND opened_at >= ?`,
        [type, since]
    );
    return row ? Number(row.count) : 0;
}

export async function listOpenIncidents(): Promise<Array<{ id: number; type: string; severity: string; opened_at: string; details_json: string | null }>> {
    const db = await getDatabase();
    return db.query(
        `SELECT id, type, severity, opened_at, details_json
         FROM account_incidents
         WHERE status = 'OPEN'
         ORDER BY opened_at DESC`
    );
}

export async function resolveIncident(incidentId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE account_incidents
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [incidentId]
    );
}
