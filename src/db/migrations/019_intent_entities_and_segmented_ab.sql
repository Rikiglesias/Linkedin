-- Migration 019: intent entities + segmented A/B stats

ALTER TABLE lead_intents ADD COLUMN entities_json TEXT;

CREATE TABLE IF NOT EXISTS ab_variant_stats_segment (
    segment_key TEXT    NOT NULL,
    variant_id  TEXT    NOT NULL,
    sent        INTEGER NOT NULL DEFAULT 0,
    accepted    INTEGER NOT NULL DEFAULT 0,
    replied     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(segment_key, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_ab_variant_stats_segment_variant
    ON ab_variant_stats_segment(variant_id, segment_key);

