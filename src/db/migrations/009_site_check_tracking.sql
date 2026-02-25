ALTER TABLE leads ADD COLUMN last_site_check_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_leads_status_last_site_check
    ON leads(status, last_site_check_at, created_at);
