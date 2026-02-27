-- Migration 015: A/B Variant Stats for Multi-Armed Bandit
-- Traccia performance per ogni variante di nota di invito (testo, stile, lunghezza, ecc.)
-- Il bandit usa questi dati per bilanciare exploration vs exploitation.

CREATE TABLE IF NOT EXISTS ab_variant_stats (
    variant_id  TEXT    PRIMARY KEY,
    sent        INTEGER NOT NULL DEFAULT 0,
    accepted    INTEGER NOT NULL DEFAULT 0,
    replied     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Index per query rapide su tasso di accettazione
CREATE INDEX IF NOT EXISTS idx_ab_variant_stats_accepted ON ab_variant_stats(accepted);
