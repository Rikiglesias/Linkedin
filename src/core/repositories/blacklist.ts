/**
 * repositories/blacklist.ts
 * Domain queries: blacklist CRUD and preventive check before job creation.
 */

import { getDatabase } from '../../db';

export interface BlacklistEntry {
    id: number;
    linkedin_url: string | null;
    company_domain: string | null;
    reason: string;
    added_by: string;
    created_at: string;
}

/**
 * Verifica se un lead è in blacklist per URL LinkedIn o dominio azienda.
 * Ritorna `true` se il target è bloccato e non deve essere contattato.
 */
export async function isBlacklisted(
    linkedinUrl: string | null | undefined,
    companyDomain: string | null | undefined,
): Promise<boolean> {
    const db = await getDatabase();
    const normalizedUrl = normalizeBlacklistUrl(linkedinUrl);
    const normalizedDomain = normalizeBlacklistDomain(companyDomain);

    if (!normalizedUrl && !normalizedDomain) return false;

    const conditions: string[] = [];
    const params: string[] = [];

    if (normalizedUrl) {
        conditions.push('linkedin_url = ?');
        params.push(normalizedUrl);
    }
    if (normalizedDomain) {
        conditions.push('company_domain = ?');
        params.push(normalizedDomain);
    }

    const row = await db.get<{ count: number | string }>(
        `SELECT COUNT(*) as count FROM blacklist WHERE ${conditions.join(' OR ')}`,
        params,
    );
    return row ? Number(row.count) > 0 : false;
}

/**
 * Aggiunge un'entry alla blacklist.
 * Se `linkedin_url` è già presente, l'INSERT fallisce silenziosamente (UNIQUE index).
 */
export async function addToBlacklist(
    linkedinUrl: string | null,
    companyDomain: string | null,
    reason: string,
    addedBy: string = 'manual',
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `INSERT OR IGNORE INTO blacklist (linkedin_url, company_domain, reason, added_by)
         VALUES (?, ?, ?, ?)`,
        [
            normalizeBlacklistUrl(linkedinUrl) ?? null,
            normalizeBlacklistDomain(companyDomain) ?? null,
            reason,
            addedBy,
        ],
    );
    return result.lastID ?? 0;
}

/**
 * Rimuove un'entry dalla blacklist per ID.
 */
export async function removeFromBlacklist(id: number): Promise<void> {
    const db = await getDatabase();
    await db.run('DELETE FROM blacklist WHERE id = ?', [id]);
}

/**
 * Lista tutte le entry nella blacklist, ordinate per data decrescente.
 */
export async function listBlacklist(limit: number = 200): Promise<BlacklistEntry[]> {
    const db = await getDatabase();
    return db.query<BlacklistEntry>(
        `SELECT id, linkedin_url, company_domain, reason, added_by, created_at
         FROM blacklist
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit],
    );
}

/**
 * Conta il numero totale di entry nella blacklist.
 */
export async function countBlacklist(): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ count: number | string }>('SELECT COUNT(*) as count FROM blacklist');
    return row ? Number(row.count) : 0;
}

// ── Normalizzazione ──────────────────────────────────────────────────────────

function normalizeBlacklistUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const trimmed = url.trim().toLowerCase();
    if (!trimmed) return null;
    // Rimuovi trailing slash e parametri query per matching coerente
    return trimmed.replace(/\/+$/, '').split('?')[0] ?? trimmed;
}

function normalizeBlacklistDomain(domain: string | null | undefined): string | null {
    if (!domain) return null;
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) return null;
    // Rimuovi protocollo e www per matching coerente
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}
