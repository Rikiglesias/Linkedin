-- P2-03: Attribuzione timing optimizer per misurare baseline vs optimizer
-- Salviamo strategia/segmento/slot per azioni INVITE e MESSAGE a livello lead.

ALTER TABLE leads ADD COLUMN invite_timing_strategy TEXT;
ALTER TABLE leads ADD COLUMN invite_timing_segment TEXT;
ALTER TABLE leads ADD COLUMN invite_timing_score REAL;
ALTER TABLE leads ADD COLUMN invite_timing_slot_hour INTEGER;
ALTER TABLE leads ADD COLUMN invite_timing_slot_dow INTEGER;
ALTER TABLE leads ADD COLUMN invite_timing_delay_sec INTEGER;
ALTER TABLE leads ADD COLUMN invite_timing_model TEXT;

ALTER TABLE leads ADD COLUMN message_timing_strategy TEXT;
ALTER TABLE leads ADD COLUMN message_timing_segment TEXT;
ALTER TABLE leads ADD COLUMN message_timing_score REAL;
ALTER TABLE leads ADD COLUMN message_timing_slot_hour INTEGER;
ALTER TABLE leads ADD COLUMN message_timing_slot_dow INTEGER;
ALTER TABLE leads ADD COLUMN message_timing_delay_sec INTEGER;
ALTER TABLE leads ADD COLUMN message_timing_model TEXT;

-- Backfill conservativo: storico precedente considerato baseline.
UPDATE leads
SET invite_timing_strategy = COALESCE(invite_timing_strategy, 'baseline'),
    invite_timing_model = COALESCE(invite_timing_model, 'legacy_heuristic')
WHERE invited_at IS NOT NULL;

UPDATE leads
SET message_timing_strategy = COALESCE(message_timing_strategy, 'baseline'),
    message_timing_model = COALESCE(message_timing_model, 'legacy_heuristic')
WHERE messaged_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_invited_timing_strategy
    ON leads(invited_at, invite_timing_strategy);

CREATE INDEX IF NOT EXISTS idx_leads_messaged_timing_strategy
    ON leads(messaged_at, message_timing_strategy);
