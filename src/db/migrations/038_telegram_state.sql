-- Migration 038: Telegram State — persists bot state (lastUpdateId, etc.)
CREATE TABLE IF NOT EXISTS telegram_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
