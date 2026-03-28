-- Add message_text column to message_history for persistent semantic dedup.
-- Previously, SemanticChecker used in-memory Map that was lost on restart.
-- Now the original text is stored alongside the hash for cross-session dedup.
ALTER TABLE message_history ADD COLUMN message_text TEXT DEFAULT NULL;
