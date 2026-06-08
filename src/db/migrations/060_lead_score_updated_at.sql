-- Up
-- leadScorer (rescore stale, src/ai/leadScorer.ts) usa leads.lead_score_updated_at per sapere
-- quando lo score di un lead è stato ricalcolato, ma nessuna migration creava la colonna:
-- 013_lead_scoring aggiungeva solo lead_score/confidence_score -> "no such column" al rescore_stale.
-- DATETIME DEFAULT NULL: i lead mai (ri)scorati hanno NULL e vengono ripescati dalla query
-- (WHERE lead_score_updated_at IS NULL OR < now-N). Idempotente via _migrations (gira una volta).
ALTER TABLE leads ADD COLUMN lead_score_updated_at DATETIME DEFAULT NULL;
