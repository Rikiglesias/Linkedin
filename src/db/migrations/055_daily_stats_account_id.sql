-- Migration 055: Add account_id to daily_stats for per-account budget enforcement.
-- Previously daily_stats had PK (date) only, making budget caps global across all accounts.
-- New PK: (date, account_id). Existing data migrated with account_id = 'default'.

CREATE TABLE IF NOT EXISTS daily_stats_new (
    date TEXT NOT NULL,
    account_id TEXT NOT NULL DEFAULT 'default',
    invites_sent INTEGER NOT NULL DEFAULT 0,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    challenges_count INTEGER NOT NULL DEFAULT 0,
    selector_failures INTEGER NOT NULL DEFAULT 0,
    run_errors INTEGER NOT NULL DEFAULT 0,
    acceptances INTEGER NOT NULL DEFAULT 0,
    follow_ups_sent INTEGER NOT NULL DEFAULT 0,
    profile_views INTEGER NOT NULL DEFAULT 0,
    likes_given INTEGER NOT NULL DEFAULT 0,
    follows_given INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, account_id)
);

INSERT INTO daily_stats_new (
    date, account_id,
    invites_sent, messages_sent, challenges_count, selector_failures, run_errors,
    acceptances, profile_views, likes_given, follows_given
)
SELECT
    date, 'default',
    invites_sent, messages_sent, challenges_count, selector_failures, run_errors,
    acceptances, profile_views, likes_given, follows_given
FROM daily_stats;

DROP TABLE daily_stats;
ALTER TABLE daily_stats_new RENAME TO daily_stats;
