/**
 * auditLog.ts — Repository per audit_log (GDPR)
 *
 * Funzioni di scrittura usate dai worker quando inviano messaggi/inviti
 * e dallo script gdprRetentionCleanup per loggare anonimizzazioni/cancellazioni.
 *
 * Nessuna funzione qui tocca il browser o LinkedIn direttamente.
 * SRP: solo lettura/scrittura su audit_log.
 */

import { getDatabase } from '../../db';

export type AuditAction =
    | 'message_sent'
    | 'follow_up_sent'
    | 'connection_request'
    | 'lead_anonymized'
    | 'lead_deleted'
    | 'opt_out_recorded';

export type AuditPerformedBy = 'bot' | 'manual' | 'retention_cleanup';

export interface AuditLogEntry {
    id: number;
    action: AuditAction;
    lead_id: number | null;
    lead_identifier: string;
    performed_at: string;
    performed_by: AuditPerformedBy;
    metadata_json: string;
}

/**
 * Scrive una entry in audit_log.
 * Non lancia eccezioni: errori vengono loggati silenziosamente per non bloccare i worker.
 */
export async function writeAuditEntry(
    action: AuditAction,
    leadId: number | null,
    leadIdentifier: string,
    performedBy: AuditPerformedBy,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    try {
        const db = await getDatabase();
        await db.run(
            `INSERT INTO audit_log (action, lead_id, lead_identifier, performed_by, metadata_json)
             VALUES (?, ?, ?, ?, ?)`,
            [action, leadId, leadIdentifier, performedBy, JSON.stringify(metadata)],
        );
    } catch {
        // Non propagare — un errore di audit non deve bloccare il bot
        // logWarn viene omesso per non creare dipendenza circolare logger→db→auditLog
    }
}

/**
 * Legge le ultime N entry di audit_log per un lead specifico (per URL).
 * Usabile da CLI/export per rispondere a richieste GDPR (diritto di accesso).
 */
export async function getAuditEntriesForLead(leadIdentifier: string, limit = 100): Promise<AuditLogEntry[]> {
    const db = await getDatabase();
    return db.query<AuditLogEntry>(
        `SELECT id, action, lead_id, lead_identifier, performed_at, performed_by, metadata_json
         FROM audit_log
         WHERE lead_identifier = ?
         ORDER BY performed_at DESC
         LIMIT ?`,
        [leadIdentifier, limit],
    );
}

/**
 * Legge le ultime N entry di audit_log per un lead_id (se ancora presente).
 */
export async function getAuditEntriesForLeadId(leadId: number, limit = 100): Promise<AuditLogEntry[]> {
    const db = await getDatabase();
    return db.query<AuditLogEntry>(
        `SELECT id, action, lead_id, lead_identifier, performed_at, performed_by, metadata_json
         FROM audit_log
         WHERE lead_id = ?
         ORDER BY performed_at DESC
         LIMIT ?`,
        [leadId, limit],
    );
}

/**
 * Statistiche sintetiche audit_log — usato da dashboard/report.
 * Raggruppa per action nell'intervallo specificato.
 */
export async function getAuditSummary(sinceIso: string): Promise<{ action: string; count: number }[]> {
    const db = await getDatabase();
    return db.query<{ action: string; count: number }>(
        `SELECT action, COUNT(*) AS count
         FROM audit_log
         WHERE performed_at >= ?
         GROUP BY action
         ORDER BY count DESC`,
        [sinceIso],
    );
}
