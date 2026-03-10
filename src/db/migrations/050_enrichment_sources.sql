-- Track provenance of every enrichment data point per lead.
-- Stores JSON like: {"email":"person_data_finder:mailto","phone":"web_search:schema.org","job_title":"linkedin_profile"}
ALTER TABLE leads ADD COLUMN enrichment_sources TEXT DEFAULT NULL;
