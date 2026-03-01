CREATE TABLE IF NOT EXISTS lock_metrics (
    date TEXT NOT NULL,
    lock_key TEXT NOT NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, lock_key, metric)
);

CREATE INDEX IF NOT EXISTS idx_lock_metrics_date_metric ON lock_metrics(date, metric);
