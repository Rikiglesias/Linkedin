-- Rollback migration 052: Remove engagement tracking columns.
-- Note: SQLite non supporta DROP COLUMN prima della versione 3.35.0.
-- Su versioni più vecchie, questa migration non è reversibile senza ricreazione tabella.
-- La 055 ricrea già la tabella, quindi questo down è safe solo se applicato prima della 055.

-- Per SQLite >= 3.35.0:
ALTER TABLE daily_stats DROP COLUMN likes_given;
ALTER TABLE daily_stats DROP COLUMN follows_given;
