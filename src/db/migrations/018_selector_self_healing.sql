-- Migration 018: Selector self-healing storage

CREATE TABLE IF NOT EXISTS dynamic_selectors (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label      TEXT    NOT NULL,
    selector          TEXT    NOT NULL,
    confidence        REAL    NOT NULL DEFAULT 0.5,
    source            TEXT    NOT NULL DEFAULT 'learner',
    active            INTEGER NOT NULL DEFAULT 1,
    success_count     INTEGER NOT NULL DEFAULT 0,
    last_validated_at TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(action_label, selector)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_selectors_action_active
    ON dynamic_selectors(action_label, active, success_count DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS selector_failures (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label      TEXT    NOT NULL,
    url               TEXT    NOT NULL,
    selectors_json    TEXT    NOT NULL,
    error_message     TEXT,
    occurrences       INTEGER NOT NULL DEFAULT 1,
    first_seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at       TEXT,
    status            TEXT    NOT NULL DEFAULT 'OPEN',
    UNIQUE(action_label, url)
);

CREATE INDEX IF NOT EXISTS idx_selector_failures_status
    ON selector_failures(status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS selector_fallbacks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action_label      TEXT    NOT NULL,
    selector          TEXT    NOT NULL,
    url               TEXT,
    success_count     INTEGER NOT NULL DEFAULT 1,
    last_success_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(action_label, selector)
);

CREATE INDEX IF NOT EXISTS idx_selector_fallbacks_action
    ON selector_fallbacks(action_label, success_count DESC, updated_at DESC);

