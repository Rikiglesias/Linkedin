-- Migration 035b: Add missing index on target_list_name for salesnav_sync_runs
CREATE INDEX IF NOT EXISTS idx_sync_runs_list ON salesnav_sync_runs(account_id, target_list_name, status);
