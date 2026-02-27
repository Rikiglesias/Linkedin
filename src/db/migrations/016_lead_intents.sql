-- Migration 016: Lead Intents — Analisi semantica avanzata delle risposte in ingresso
-- Ogni analisi NLP su un messaggio in arrivo viene persistita per analytics storici.

CREATE TABLE IF NOT EXISTS lead_intents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    intent      TEXT    NOT NULL,        -- macro: POSITIVE | NEGATIVE | NEUTRAL | QUESTIONS | NOT_INTERESTED | UNKNOWN
    sub_intent  TEXT,                   -- granular: CALL_REQUESTED | PRICE_INQUIRY | OBJECTION_HANDLING | COMPETITOR_MENTION | REFERRAL | NONE
    confidence  REAL    NOT NULL DEFAULT 0,
    raw_message TEXT,                   -- snippet del messaggio analizzato (max 500 chars)
    analyzed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_intents_lead_id    ON lead_intents(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_intents_intent     ON lead_intents(intent);
CREATE INDEX IF NOT EXISTS idx_lead_intents_sub_intent ON lead_intents(sub_intent);
