-- Migration 017: Follow-up columns
-- Aggiunge colonne per tracciare i follow-up inviati per ogni lead

ALTER TABLE leads ADD COLUMN follow_up_count   INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN follow_up_sent_at DATETIME;
