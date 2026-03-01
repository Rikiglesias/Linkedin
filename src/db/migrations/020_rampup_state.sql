-- Migration 020: Ramp-up automatic state per list

CREATE TABLE IF NOT EXISTS list_rampup_state (
    list_name            TEXT PRIMARY KEY,
    last_run_date        TEXT,
    current_invite_cap   INTEGER NOT NULL DEFAULT 0,
    current_message_cap  INTEGER NOT NULL DEFAULT 0,
    daily_increase       REAL    NOT NULL DEFAULT 0.05,
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_list_rampup_state_last_run
    ON list_rampup_state(last_run_date, updated_at DESC);

