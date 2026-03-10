-- Blacklist per profili/company da non contattare.
-- Check preventivo prima di creare job: se il target è in blacklist, skip.
CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_url TEXT,
    company_domain TEXT,
    reason TEXT NOT NULL,
    added_by TEXT NOT NULL DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_linkedin_url ON blacklist(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_company_domain ON blacklist(company_domain) WHERE company_domain IS NOT NULL;
