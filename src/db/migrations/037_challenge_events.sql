-- Migration 037: Challenge Events — tracks when LinkedIn triggers security challenges
CREATE TABLE IF NOT EXISTS challenge_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker TEXT NOT NULL,
    lead_id INTEGER,
    url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved INTEGER DEFAULT 0,
    resolution_method TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenge_events_worker ON challenge_events(worker, timestamp);
