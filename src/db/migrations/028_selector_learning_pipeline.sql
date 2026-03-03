-- Migration 028: selector learning pipeline runs + rollback metadata

CREATE TABLE IF NOT EXISTS selector_learning_runs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    status                  TEXT    NOT NULL DEFAULT 'RUNNING',
    triggered_by            TEXT,
    source_tag              TEXT    NOT NULL,
    lookback_days           INTEGER NOT NULL DEFAULT 7,
    min_success             INTEGER NOT NULL DEFAULT 3,
    scanned_failures        INTEGER NOT NULL DEFAULT 0,
    promoted_count          INTEGER NOT NULL DEFAULT 0,
    promoted_labels_count   INTEGER NOT NULL DEFAULT 0,
    baseline_open_failures  INTEGER NOT NULL DEFAULT 0,
    evaluation_open_failures INTEGER,
    evaluation_degraded     INTEGER NOT NULL DEFAULT 0,
    rollback_applied        INTEGER NOT NULL DEFAULT 0,
    rollback_reason         TEXT,
    summary_json            TEXT    NOT NULL DEFAULT '{}',
    rollback_snapshot_json  TEXT    NOT NULL DEFAULT '[]',
    started_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_selector_learning_runs_started
    ON selector_learning_runs(started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_selector_learning_runs_status
    ON selector_learning_runs(status, rollback_applied, started_at DESC);
