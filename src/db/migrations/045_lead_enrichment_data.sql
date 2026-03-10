-- Migration 045: lead_enrichment_data — Store deep enrichment results (Person Data Finder)
-- Tabella separata da leads per non appesantire la tabella principale con JSON complessi.
-- Relazione 1:1 con leads.id. I campi essenziali (phone, email) restano su leads;
-- qui vanno i dati estesi (social profiles, company intel, confidence breakdown).

CREATE TABLE IF NOT EXISTS lead_enrichment_data (
    lead_id        INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    company_json   TEXT,           -- JSON: PersonDataCompany (industry, size, description, socialLinks)
    phones_json    TEXT,           -- JSON: PersonDataPhone[] (tutti i numeri trovati con type e source)
    socials_json   TEXT,           -- JSON: PersonDataSocial[] (github, gravatar, twitter, linkedin_company)
    seniority      TEXT,           -- 'c-level'|'vp'|'director'|'manager'|'senior'|'mid'|'junior'
    department     TEXT,           -- 'Engineering'|'Sales'|'Marketing'|'HR'|'Finance'|...
    data_points    INTEGER DEFAULT 0,
    confidence     INTEGER DEFAULT 0,  -- 0–100
    sources_json   TEXT,           -- JSON: string[] (fonti usate)
    enriched_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrichment_confidence ON lead_enrichment_data(confidence);
CREATE INDEX IF NOT EXISTS idx_enrichment_seniority ON lead_enrichment_data(seniority);
