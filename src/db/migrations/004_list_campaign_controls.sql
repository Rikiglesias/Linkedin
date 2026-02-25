-- Controlli campagna per lista Sales Navigator.
ALTER TABLE lead_lists ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lead_lists ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE lead_lists ADD COLUMN daily_invite_cap INTEGER;
ALTER TABLE lead_lists ADD COLUMN daily_message_cap INTEGER;

CREATE TABLE IF NOT EXISTS list_daily_stats (
    date TEXT NOT NULL,
    list_name TEXT NOT NULL,
    invites_sent INTEGER NOT NULL DEFAULT 0,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, list_name)
);

CREATE INDEX IF NOT EXISTS idx_list_daily_stats_list_date
    ON list_daily_stats(list_name, date);
