CREATE TABLE IF NOT EXISTS automation_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'api_v1',
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING',
    claimed_by TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    result_json TEXT,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_automation_commands_status_created_at
    ON automation_commands(status, created_at);

CREATE INDEX IF NOT EXISTS idx_automation_commands_finished_at
    ON automation_commands(finished_at);

CREATE TABLE IF NOT EXISTS outbox_event_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    sink TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at DATETIME,
    last_error TEXT,
    processing_owner TEXT,
    processing_started_at DATETIME,
    processing_expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, sink),
    FOREIGN KEY (event_id) REFERENCES outbox_events(id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_pending_claim
    ON outbox_event_deliveries(sink, status, next_retry_at, processing_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_processing_owner
    ON outbox_event_deliveries(processing_owner, processing_expires_at);
