-- Migration 059: GDPR Retention Policy & Audit Trail
-- Aggiunge colonne per retention tracking e tabella audit_log per conformità GDPR.
-- Tutte le operazioni sono additive (IF NOT EXISTS / ADD COLUMN ignorato se già esiste).

-- ─── Retention tracking su leads ─────────────────────────────────────────────
-- last_activity_at: timestamp dell'ultima interazione (messaggio, follow-up, cambio stato)
-- anonymized_at: quando il lead è stato anonimizzato (PII sostituita con hash)
-- retention_expires_at: calcolato da last_activity_at + policy; scaduto = candidato a cleanup
ALTER TABLE leads ADD COLUMN last_activity_at DATETIME DEFAULT NULL;
ALTER TABLE leads ADD COLUMN anonymized_at DATETIME DEFAULT NULL;
ALTER TABLE leads ADD COLUMN retention_expires_at DATETIME DEFAULT NULL;

-- Indici per le query di retention cleanup (cerca lead scaduti per anonimizzazione/cancellazione)
CREATE INDEX IF NOT EXISTS idx_leads_last_activity_at ON leads(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_leads_anonymized_at ON leads(anonymized_at);
CREATE INDEX IF NOT EXISTS idx_leads_retention_expires_at ON leads(retention_expires_at);

-- ─── Audit trail centrale ────────────────────────────────────────────────────
-- Traccia ogni azione rilevante su lead: messaggi inviati, inviti, anonimizzazioni, cancellazioni.
-- lead_identifier persiste anche dopo cancellazione del lead (URL LinkedIn hashato o originale).
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action VARCHAR(50) NOT NULL,           -- 'message_sent', 'connection_request', 'follow_up_sent',
                                           -- 'lead_anonymized', 'lead_deleted', 'opt_out_recorded'
    lead_id INTEGER,                       -- NULL dopo cancellazione definitiva del lead
    lead_identifier TEXT,                  -- URL LinkedIn (persiste anche post-anonimizzazione/cancellazione)
    performed_at DATETIME NOT NULL DEFAULT (datetime('now')),
    performed_by TEXT NOT NULL DEFAULT 'bot',  -- 'bot', 'manual', 'retention_cleanup'
    metadata_json TEXT NOT NULL DEFAULT '{}'   -- dati contestuali (list_name, variant, ecc.)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, performed_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_id ON audit_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_identifier ON audit_log(lead_identifier);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON audit_log(performed_at);
