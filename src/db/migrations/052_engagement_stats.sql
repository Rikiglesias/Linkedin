-- Migration 052: Add engagement tracking columns to daily_stats.
-- Tracks likes_given and follows_given for ROI funnel visibility.
-- These actions were already performed by interactionWorker but never counted.

ALTER TABLE daily_stats ADD COLUMN likes_given INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN follows_given INTEGER NOT NULL DEFAULT 0;
