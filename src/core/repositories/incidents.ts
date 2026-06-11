/**
 * repositories/incidents.ts
 * Domain queries: incident creation, listing and resolution.
 */

import { getDatabase } from '../../db';

export async function createIncident(
    type: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    details: Record<string, unknown>,
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `
        INSERT INTO account_incidents (type, severity, status, details_json)
        VALUES (?, ?, 'OPEN', ?)
    `,
        [type, severity, JSON.stringify(details)],
    );
    return result.lastID ?? 0;
}

export async function countRecentIncidents(type: string, sinceHours: number): Promise<number> {
    const db = await getDatabase();
    const since = new Date(Date.now() - sinceHours * 3600000).toISOString();
    const row = await db.get<{ count: number | string }>(
        `SELECT COUNT(*) as count FROM account_incidents WHERE type = ? AND opened_at >= ?`,
        [type, since],
    );
    return row ? Number(row.count) : 0;
}

/**
 * F3 ai-stack: conta gli account DISTINTI colpiti da un type di incident nelle ultime ore.
 * Estrazione accountId in JS (non json_extract): portabile SQLite+Postgres senza dialetti.
 * Le righe filtrate per type+finestra sono poche per costruzione (burst cap giornalieri).
 */
export async function countDistinctIncidentAccounts(
    type: string,
    sinceHours: number,
): Promise<{ count: number; accounts: string[] }> {
    const db = await getDatabase();
    const since = new Date(Date.now() - sinceHours * 3600000).toISOString();
    const rows = await db.query<{ details_json: string | null }>(
        `SELECT details_json FROM account_incidents WHERE type = ? AND opened_at >= ?`,
        [type, since],
    );
    const accounts = new Set<string>();
    for (const row of rows) {
        let accountId = 'default';
        try {
            const details: unknown = row.details_json ? JSON.parse(row.details_json) : null;
            const candidate = (details as Record<string, unknown> | null)?.accountId;
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                accountId = candidate.trim();
            }
        } catch {
            // details_json corrotto → l'incident conta come 'default' (non perde il segnale)
        }
        accounts.add(accountId);
    }
    return { count: accounts.size, accounts: Array.from(accounts).sort() };
}

export async function listOpenIncidents(): Promise<
    Array<{ id: number; type: string; severity: string; opened_at: string; details_json: string | null }>
> {
    const db = await getDatabase();
    return db.query(
        `SELECT id, type, severity, opened_at, details_json
         FROM account_incidents
         WHERE status = 'OPEN'
         ORDER BY opened_at DESC`,
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
        [incidentId],
    );
}
