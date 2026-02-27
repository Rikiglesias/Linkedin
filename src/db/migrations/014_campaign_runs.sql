-- 014_campaign_runs.sql
-- Tabella per l'Audit di ogni singola run del bot

CREATE TABLE IF NOT EXISTS campaign_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'RUNNING', -- 'RUNNING', 'SUCCESS', 'FAILED', 'PAUSED'
    profiles_discovered INTEGER DEFAULT 0,
    invites_sent INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);
