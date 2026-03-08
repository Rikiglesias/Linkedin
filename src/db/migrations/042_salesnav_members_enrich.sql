-- Migration 042: Enrich salesnav_list_members with first_name, last_name, location
-- Allows per-lead structured data beyond just profile_name.

ALTER TABLE salesnav_list_members ADD COLUMN first_name TEXT;
ALTER TABLE salesnav_list_members ADD COLUMN last_name TEXT;
ALTER TABLE salesnav_list_members ADD COLUMN location TEXT;

-- Index for geographic queries (find all leads in a city/region)
CREATE INDEX IF NOT EXISTS idx_slm_location
    ON salesnav_list_members(location)
    WHERE location IS NOT NULL;
