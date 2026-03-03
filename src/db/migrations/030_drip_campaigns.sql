-- 030_drip_campaigns.sql

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    step_order INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    delay_hours INTEGER NOT NULL DEFAULT 24,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, step_order)
);

CREATE TABLE IF NOT EXISTS lead_campaign_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    campaign_id INTEGER NOT NULL,
    current_step_id INTEGER,
    status TEXT NOT NULL DEFAULT 'ENROLLED',
    next_execution_at DATETIME,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lead_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_campaign_state_next_exec 
    ON lead_campaign_state(status, next_execution_at);
