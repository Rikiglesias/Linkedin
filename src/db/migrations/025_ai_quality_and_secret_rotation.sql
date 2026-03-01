-- Migration 025: AI quality pipeline dataset/runs + secret rotation governance

CREATE TABLE IF NOT EXISTS ai_validation_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL,
    label TEXT NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    expected_json TEXT NOT NULL DEFAULT '{}',
    tags_csv TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_validation_samples_task_active
    ON ai_validation_samples(task_type, active, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_validation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'RUNNING',
    triggered_by TEXT,
    summary_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_validation_runs_started
    ON ai_validation_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS ai_validation_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    sample_id INTEGER NOT NULL,
    predicted_json TEXT NOT NULL DEFAULT '{}',
    similarity REAL NOT NULL DEFAULT 0,
    is_match INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(run_id, sample_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_validation_results_run
    ON ai_validation_results(run_id, is_match, similarity);

CREATE TABLE IF NOT EXISTS secret_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    secret_name TEXT NOT NULL UNIQUE,
    owner TEXT,
    rotated_at TEXT NOT NULL,
    expires_at TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_secret_inventory_expires
    ON secret_inventory(expires_at, rotated_at);

