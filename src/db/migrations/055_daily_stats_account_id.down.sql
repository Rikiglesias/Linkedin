-- Rollback migration 055: rimuove account_id da daily_stats, ripristina PK solo date.
-- ATTENZIONE: se esistono dati multi-account, verranno aggregati con SUM per data.

CREATE TABLE IF NOT EXISTS daily_stats_old (
    date TEXT PRIMARY KEY,
    invites_sent INTEGER NOT NULL DEFAULT 0,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    challenges_count INTEGER NOT NULL DEFAULT 0,
    selector_failures INTEGER NOT NULL DEFAULT 0,
    run_errors INTEGER NOT NULL DEFAULT 0,
    acceptances INTEGER NOT NULL DEFAULT 0,
    follow_ups_sent INTEGER NOT NULL DEFAULT 0,
    profile_views INTEGER NOT NULL DEFAULT 0,
    likes_given INTEGER NOT NULL DEFAULT 0,
    follows_given INTEGER NOT NULL DEFAULT 0
);

INSERT INTO daily_stats_old (
    date,
    invites_sent, messages_sent, challenges_count, selector_failures, run_errors,
    acceptances, follow_ups_sent, profile_views, likes_given, follows_given
)
SELECT
    date,
    SUM(invites_sent), SUM(messages_sent), SUM(challenges_count), SUM(selector_failures), SUM(run_errors),
    SUM(acceptances), SUM(follow_ups_sent), SUM(profile_views), SUM(likes_given), SUM(follows_given)
FROM daily_stats
GROUP BY date;

DROP TABLE daily_stats;
ALTER TABLE daily_stats_old RENAME TO daily_stats;
