-- Hot path indexes for scheduler/outbox/hygiene queries (SQLite + Postgres compatible)
CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run_priority_created
    ON jobs(status, next_run_at, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_leads_status_invited_created
    ON leads(status, invited_at, created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_retry_created
    ON outbox_events(delivered_at, next_retry_at, created_at);
