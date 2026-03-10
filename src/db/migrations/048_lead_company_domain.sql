-- Migration 048: Add company_domain to leads table
-- Persists the discovered company domain to avoid re-running domain discovery.
-- Populated by the enrichment pipeline (domainDiscovery.ts).

ALTER TABLE leads ADD COLUMN company_domain TEXT DEFAULT NULL;

-- Also track domain source in lead_enrichment_data
ALTER TABLE lead_enrichment_data ADD COLUMN domain_source TEXT DEFAULT NULL;
