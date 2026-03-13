-- Rollback migration 054: Remove prebuilt_messages table and indexes.

DROP INDEX IF EXISTS idx_prebuilt_messages_expired;
DROP INDEX IF EXISTS idx_prebuilt_messages_lead_unused;
DROP TABLE IF EXISTS prebuilt_messages;
