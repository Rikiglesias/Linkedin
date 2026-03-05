-- GDPR consent tracking: base giuridica, timestamp e opt-out
ALTER TABLE leads ADD COLUMN consent_basis TEXT DEFAULT 'legitimate_interest';
ALTER TABLE leads ADD COLUMN consent_recorded_at DATETIME DEFAULT NULL;
ALTER TABLE leads ADD COLUMN gdpr_opt_out INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_gdpr_opt_out ON leads(gdpr_opt_out);
