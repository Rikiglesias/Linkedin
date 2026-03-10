-- Rollback 046_session_patterns.sql
DROP INDEX IF EXISTS idx_session_patterns_account_date;
DROP TABLE IF EXISTS session_patterns;
