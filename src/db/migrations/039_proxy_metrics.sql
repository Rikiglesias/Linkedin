-- Migration 039: Proxy Metrics — tracks proxy performance for intelligent ordering
CREATE TABLE IF NOT EXISTS proxy_metrics (
    proxy_url TEXT PRIMARY KEY,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    avg_latency_ms INTEGER DEFAULT 0,
    last_success_at DATETIME,
    last_fail_at DATETIME
);
