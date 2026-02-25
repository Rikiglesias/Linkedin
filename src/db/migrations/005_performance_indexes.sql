-- Indici per scheduler/worker su database con molti lead.
CREATE INDEX IF NOT EXISTS idx_leads_status_list_created
    ON leads(status, list_name, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_type_status_next_run
    ON jobs(type, status, next_run_at, priority, created_at);
