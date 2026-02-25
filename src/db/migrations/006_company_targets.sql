CREATE TABLE IF NOT EXISTS company_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_name TEXT NOT NULL,
    account_name TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    source_file TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_targets_list_account_website
    ON company_targets(list_name, account_name, website);

CREATE INDEX IF NOT EXISTS idx_company_targets_list_status
    ON company_targets(list_name, status, created_at);
