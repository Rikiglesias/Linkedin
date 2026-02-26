-- Migration 011: aggiunge colonna acceptances a daily_stats
-- Traccia le accettazioni di un invito rilevate dall'acceptanceWorker.
-- Usa ADD COLUMN IF NOT EXISTS per idempotenza su DB già aggiornati.

ALTER TABLE daily_stats ADD COLUMN acceptances INTEGER NOT NULL DEFAULT 0;
