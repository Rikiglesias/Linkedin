-- Migration 027: feature store minimale per training/offline eval (P2-05)

CREATE TABLE IF NOT EXISTS ml_feature_dataset_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_name TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    action_scope TEXT NOT NULL DEFAULT 'invite,message',
    lookback_days INTEGER NOT NULL DEFAULT 30,
    split_train_pct INTEGER NOT NULL DEFAULT 80,
    split_validation_pct INTEGER NOT NULL DEFAULT 10,
    seed TEXT NOT NULL DEFAULT 'default',
    row_count INTEGER NOT NULL DEFAULT 0,
    signature_sha256 TEXT NOT NULL DEFAULT '',
    source_stats_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(dataset_name, dataset_version)
);

CREATE INDEX IF NOT EXISTS idx_feature_dataset_versions_dataset
    ON ml_feature_dataset_versions(dataset_name, generated_at DESC);

CREATE TABLE IF NOT EXISTS ml_feature_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_name TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    sample_key TEXT NOT NULL,
    lead_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    event_at TEXT NOT NULL,
    label INTEGER NOT NULL DEFAULT 0,
    split TEXT NOT NULL DEFAULT 'train',
    features_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(dataset_name, dataset_version, sample_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_store_dataset_split
    ON ml_feature_store(dataset_name, dataset_version, split, action);

CREATE INDEX IF NOT EXISTS idx_feature_store_lead_action
    ON ml_feature_store(lead_id, action, event_at);
