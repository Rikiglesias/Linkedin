-- Migration 036: Sales Navigator List Members — 3-level deduplication
-- Tracks individual profiles added to SalesNav lists with dedup at URL and fuzzy levels.

CREATE TABLE IF NOT EXISTS salesnav_list_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_name TEXT NOT NULL,
    linkedin_url TEXT,                  -- /in/username (nullable: may not be visible)
    salesnav_url TEXT,                  -- /sales/lead/xxx (nullable: resolved later)
    profile_name TEXT,
    company TEXT,
    title TEXT,
    name_company_hash TEXT,             -- SHA1(lower(trim(name))||'|'||lower(trim(company)))
    run_id INTEGER REFERENCES salesnav_sync_runs(id),
    search_index INTEGER,
    page_number INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'bulk_save'
);

-- Level 1 (primary): unique by linkedin URL per list
CREATE UNIQUE INDEX IF NOT EXISTS idx_slm_list_linkedin
    ON salesnav_list_members(list_name, linkedin_url)
    WHERE linkedin_url IS NOT NULL;

-- Level 2 (secondary): unique by salesnav URL per list
CREATE UNIQUE INDEX IF NOT EXISTS idx_slm_list_salesnav
    ON salesnav_list_members(list_name, salesnav_url)
    WHERE salesnav_url IS NOT NULL;

-- Level 3 (fuzzy, NOT unique — homonyms exist): for warning only
CREATE INDEX IF NOT EXISTS idx_slm_list_namehash
    ON salesnav_list_members(list_name, name_company_hash);
