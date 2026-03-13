-- Rollback migration 053: Remove warm-touch campaign template and its steps.

DELETE FROM campaign_steps WHERE campaign_id IN (SELECT id FROM campaigns WHERE name = 'warm-touch-invite');
DELETE FROM campaigns WHERE name = 'warm-touch-invite';
