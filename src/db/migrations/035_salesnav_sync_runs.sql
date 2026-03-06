-- Migration 035: Sales Navigator Bulk Save — Run tracking with resumability
-- Tracks "saved search → save to list" bulk operations page by page

CREATE TABLE IF NOT EXISTS salesnav_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL DEFAULT 'default',
    target_list_name TEXT NOT NULL,
    search_name TEXT,
    status TEXT NOT NULL DEFAULT 'RUNNING',  -- RUNNING | SUCCESS | FAILED | PAUSED
    total_searches INTEGER DEFAULT 0,
    processed_searches INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    processed_pages INTEGER DEFAULT 0,
    total_leads_saved INTEGER DEFAULT 0,
    current_search_index INTEGER DEFAULT 0,
    current_page_number INTEGER DEFAULT 1,
    last_error TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-page tracking for granular progress and error diagnostics
CREATE TABLE IF NOT EXISTS salesnav_sync_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES salesnav_sync_runs(id),
    search_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    leads_on_page INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | SUCCESS | FAILED | SKIPPED
    error_message TEXT,
    saved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON salesnav_sync_runs(status, account_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_account_started ON salesnav_sync_runs(account_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_items_run ON salesnav_sync_items(run_id, search_index, page_number);
