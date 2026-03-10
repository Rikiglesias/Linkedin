-- Migration 049: Add business_email column to leads table
-- Separa email personale (gmail, outlook, etc.) da email aziendale (name@company.com).
-- L'enrichment pipeline popola business_email; il campo email resta per uso generico.

ALTER TABLE leads ADD COLUMN business_email TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN business_email_confidence INTEGER DEFAULT 0;
