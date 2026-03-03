-- Migration 029: outbox claim lease for idempotent processing across retries/crashes

ALTER TABLE outbox_events ADD COLUMN processing_owner TEXT;
ALTER TABLE outbox_events ADD COLUMN processing_started_at DATETIME;
ALTER TABLE outbox_events ADD COLUMN processing_expires_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_outbox_pending_claim
    ON outbox_events(delivered_at, next_retry_at, processing_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_processing_owner
    ON outbox_events(processing_owner, processing_expires_at);

