-- Pre-built AI messages: generati offline in batch, consumati dal messageWorker durante la sessione browser.
-- Riduce il tempo con browser aperto di ~2-5s per messaggio.

CREATE TABLE IF NOT EXISTS prebuilt_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    message_hash TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ai',
    model TEXT,
    lang TEXT DEFAULT 'it',
    created_at DATETIME NOT NULL DEFAULT (DATETIME('now')),
    used_at DATETIME,
    expired_at DATETIME,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prebuilt_messages_lead_unused
    ON prebuilt_messages(lead_id) WHERE used_at IS NULL AND expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prebuilt_messages_expired
    ON prebuilt_messages(expired_at) WHERE expired_at IS NOT NULL;
