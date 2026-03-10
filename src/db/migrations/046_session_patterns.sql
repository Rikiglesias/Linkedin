-- 046_session_patterns.sql
-- Cross-session memory: tracks daily behavioral patterns per account
-- to modulate pacing/timing and produce consistent behavioral fingerprints.

CREATE TABLE IF NOT EXISTS session_patterns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT    NOT NULL DEFAULT 'default',
    date            TEXT    NOT NULL,
    login_hour      INTEGER,                          -- hour of first activity (0-23)
    logout_hour     INTEGER,                          -- hour of last activity (0-23)
    total_actions   INTEGER NOT NULL DEFAULT 0,
    invite_count    INTEGER NOT NULL DEFAULT 0,
    message_count   INTEGER NOT NULL DEFAULT 0,
    check_count     INTEGER NOT NULL DEFAULT 0,
    avg_interval_ms INTEGER,                          -- average inter-action interval
    peak_hour       INTEGER,                          -- hour with most actions
    challenges      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_session_patterns_account_date
    ON session_patterns(account_id, date DESC);
