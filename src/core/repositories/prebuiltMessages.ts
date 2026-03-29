/**
 * repositories/prebuiltMessages.ts
 * CRUD per messaggi AI pre-generati offline in batch.
 * Il messageWorker consuma i messaggi pronti, evitando la latenza AI durante la sessione browser.
 */

import { getDatabase } from '../../db';

export interface PrebuiltMessage {
    id: number;
    lead_id: number;
    message: string;
    message_hash: string;
    source: 'ai' | 'template';
    model: string | null;
    lang: string;
    created_at: string;
    used_at: string | null;
    expired_at: string | null;
}

/**
 * Recupera un messaggio pre-built non ancora utilizzato per un lead.
 * Ritorna il più recente non scaduto e non usato, o null se non disponibile.
 */
export async function getUnusedPrebuiltMessage(leadId: number): Promise<PrebuiltMessage | null> {
    const db = await getDatabase();
    const row = await db.get<PrebuiltMessage>(
        `SELECT id, lead_id, message, message_hash, source, model, lang, created_at, used_at, expired_at
         FROM prebuilt_messages
         WHERE lead_id = ? AND used_at IS NULL AND expired_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [leadId],
    );
    return row ?? null;
}

/**
 * Marca un messaggio pre-built come utilizzato.
 */
export async function markPrebuiltMessageUsed(messageId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(`UPDATE prebuilt_messages SET used_at = DATETIME('now') WHERE id = ?`, [messageId]);
}

/**
 * Salva un messaggio pre-generato per un lead.
 */
export async function savePrebuiltMessage(
    leadId: number,
    message: string,
    messageHash: string,
    source: 'ai' | 'template',
    model: string | null,
    lang: string = 'it',
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `INSERT INTO prebuilt_messages (lead_id, message, message_hash, source, model, lang)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [leadId, message, messageHash, source, model, lang],
    );
    return result.lastID ?? 0;
}

/**
 * Scade i messaggi pre-built più vecchi di maxAgeHours.
 * I messaggi scaduti non vengono usati dal worker.
 */
export async function expireOldPrebuiltMessages(maxAgeHours: number = 48): Promise<number> {
    const safeHours = Math.max(1, maxAgeHours);
    const db = await getDatabase();
    const result = await db.run(
        `UPDATE prebuilt_messages
         SET expired_at = DATETIME('now')
         WHERE used_at IS NULL AND expired_at IS NULL
           AND created_at < DATETIME('now', '-' || ? || ' hours')`,
        [safeHours],
    );
    return result.changes ?? 0;
}

/**
 * Ritorna gli ID dei lead READY_MESSAGE che NON hanno un messaggio pre-built pronto.
 */
export async function getLeadsWithoutPrebuiltMessage(limit: number = 20): Promise<number[]> {
    const db = await getDatabase();
    const rows = await db.query<{ id: number }>(
        `SELECT l.id
         FROM leads l
         WHERE l.status = 'READY_MESSAGE'
           AND NOT EXISTS (
               SELECT 1 FROM prebuilt_messages pm
               WHERE pm.lead_id = l.id AND pm.used_at IS NULL AND pm.expired_at IS NULL
           )
         ORDER BY COALESCE(l.lead_score, -1) DESC, l.created_at ASC
         LIMIT ?`,
        [limit],
    );
    return rows.map((r) => r.id);
}
