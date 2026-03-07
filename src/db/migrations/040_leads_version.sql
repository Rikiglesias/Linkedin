-- Migration 040: Leads Version Column — enables optimistic locking for lead transitions
ALTER TABLE leads ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
