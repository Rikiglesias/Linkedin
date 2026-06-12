-- 061_orphan_pii_cleanup — backend-audit P0a (2026-06-12)
-- Bonifica delle righe figlie ORFANE di leads accumulate quando PRAGMA foreign_keys era OFF
-- (abilitato globalmente da 0194c03/db.ts, ma SQLite NON applica le FK retroattivamente:
-- le righe figlie con lead_id che punta a un lead ormai cancellato restano = PII fantasma
-- senza titolare né scopo → vanno rimosse, GDPR Art.5 minimizzazione).
--
-- Idempotente: ogni DELETE colpisce solo righe orfane; ri-eseguita è no-op.
-- Su Postgres (prod, FK sempre enforced) non esistono orfani → tutte no-op, innocua.
-- Set tabelle = figlie keyed su lead_id (allineato a deleteLead in gdprRetentionCleanup.ts;
-- salesnav_list_members è keyed su linkedin_url, NON lead_id → fuori da questo sweep).
-- id di leads è PK NOT NULL → la subquery non ritorna mai NULL → NOT IN safe; il filtro
-- lead_id IS NOT NULL copre le figlie con colonna nullable.

DELETE FROM message_history     WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM lead_events         WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM list_leads          WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM lead_intents        WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM lead_enrichment_data WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM prebuilt_messages   WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM salesnav_list_items WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM ml_feature_store    WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM challenge_events    WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
DELETE FROM lead_campaign_state WHERE lead_id IS NOT NULL AND lead_id NOT IN (SELECT id FROM leads);
