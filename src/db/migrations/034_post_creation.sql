-- Post creation tracking: storicizza i post pubblicati dall'account.
CREATE TABLE IF NOT EXISTS published_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL DEFAULT 'default',
    content TEXT NOT NULL,
    topic TEXT,
    source TEXT NOT NULL DEFAULT 'ai',
    model TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    scheduled_at DATETIME,
    published_at DATETIME,
    linkedin_post_url TEXT,
    engagement_likes INTEGER DEFAULT 0,
    engagement_comments INTEGER DEFAULT 0,
    metadata_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_published_posts_status ON published_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_published_posts_account ON published_posts(account_id, status);
