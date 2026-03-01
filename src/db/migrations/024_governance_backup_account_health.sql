-- Migration 024: governance, backup tracking, multi-account health snapshots

CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_type TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    backup_path TEXT,
    checksum_sha256 TEXT,
    duration_ms INTEGER,
    details_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_status_started
    ON backup_runs(status, started_at);

CREATE TABLE IF NOT EXISTS security_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT,
    account_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    result TEXT NOT NULL,
    correlation_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_created
    ON security_audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_category_action
    ON security_audit_events(category, action, created_at DESC);

CREATE TABLE IF NOT EXISTS account_health_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    queue_processed INTEGER NOT NULL DEFAULT 0,
    queue_failed INTEGER NOT NULL DEFAULT 0,
    challenges INTEGER NOT NULL DEFAULT 0,
    dead_letters INTEGER NOT NULL DEFAULT 0,
    health TEXT NOT NULL DEFAULT 'GREEN',
    reason TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_health_snapshots_account_observed
    ON account_health_snapshots(account_id, observed_at DESC);
