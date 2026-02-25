-- Aggiunge campi persona (nome/cognome) alla tabella leads.
-- Sales Navigator esporta First Name e Last Name separatamente.
ALTER TABLE leads ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN last_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN job_title  TEXT NOT NULL DEFAULT '';
