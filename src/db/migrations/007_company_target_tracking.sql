ALTER TABLE company_targets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company_targets ADD COLUMN last_error TEXT;
ALTER TABLE company_targets ADD COLUMN processed_at DATETIME;
