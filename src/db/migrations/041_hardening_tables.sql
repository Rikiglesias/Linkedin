-- Migration 041: Consolidate hardcoded DDL from db.ts into proper migration.
-- All tables and columns here were previously created inline in the TypeScript bootstrap.
-- This migration is idempotent (IF NOT EXISTS / ensureColumn patterns).

-- ─── Hardening columns on existing tables ────────────────────────────────────
-- These ALTER TABLEs are wrapped in try-catch logic at the application level.
-- For SQLite, ALTER TABLE ADD COLUMN is idempotent if column already exists (error ignored).
-- The application's ensureColumn* helpers handle both dialects.

-- ─── list_daily_stats ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS list_daily_stats (
    date TEXT NOT NULL,
    list_name TEXT NOT NULL,
    invites_sent INTEGER NOT NULL DEFAULT 0,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, list_name)
);
CREATE INDEX IF NOT EXISTS idx_list_daily_stats_list_date ON list_daily_stats(list_name, date);

-- ─── Hot-path indexes on leads and jobs ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_status_list_created ON leads(status, list_name, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status_last_site_check ON leads(status, last_site_check_at, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status_next_run ON jobs(type, status, next_run_at, priority, created_at);
-- Ensure account_id column exists before creating index (was previously added by ensureColumn in db.ts)
-- SQLite ignores ALTER TABLE ADD COLUMN if column already exists (raises error, caught by app layer).
-- For fresh DBs, this is required before the index below.
ALTER TABLE jobs ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_jobs_account_status_next_run ON jobs(account_id, status, next_run_at, priority, created_at);

-- ─── company_targets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_name TEXT NOT NULL,
    account_name TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    source_file TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_targets_list_account_website
    ON company_targets(list_name, account_name, website);
CREATE INDEX IF NOT EXISTS idx_company_targets_list_status
    ON company_targets(list_name, status, created_at);

-- ─── runtime_locks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runtime_locks (
    lock_key TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON runtime_locks(expires_at);

-- ─── ab_variant_stats_segment ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_variant_stats_segment (
    segment_key TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,
    replied INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (segment_key, variant_id)
);

-- ─── dynamic_selectors ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dynamic_selectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label TEXT NOT NULL,
    selector TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'learner',
    active INTEGER NOT NULL DEFAULT 1,
    success_count INTEGER NOT NULL DEFAULT 0,
    last_validated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(action_label, selector)
);

-- ─── selector_failures ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS selector_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label TEXT NOT NULL,
    url TEXT NOT NULL,
    selectors_json TEXT NOT NULL,
    error_message TEXT,
    occurrences INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    UNIQUE(action_label, url)
);

-- ─── selector_fallbacks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS selector_fallbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label TEXT NOT NULL,
    selector TEXT NOT NULL,
    url TEXT,
    success_count INTEGER NOT NULL DEFAULT 1,
    last_success_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(action_label, selector)
);

-- ─── list_rampup_state ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS list_rampup_state (
    list_name TEXT PRIMARY KEY,
    last_run_date TEXT,
    current_invite_cap INTEGER NOT NULL DEFAULT 0,
    current_message_cap INTEGER NOT NULL DEFAULT 0,
    daily_increase REAL NOT NULL DEFAULT 0.05,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
