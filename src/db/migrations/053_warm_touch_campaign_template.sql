-- Migration 053: Warm-touch campaign template
-- Pre-invite engagement sequence: VIEW_PROFILE → LIKE_POST → wait 2 days → INVITE
-- Increases acceptance rate 30-50% by making the target see "who viewed your profile"
-- before receiving the invite.

INSERT OR IGNORE INTO campaigns (name, active) VALUES ('warm-touch-invite', 1);

INSERT OR IGNORE INTO campaign_steps (campaign_id, step_order, action_type, delay_hours, metadata_json)
SELECT c.id, 1, 'VIEW_PROFILE', 0, '{"reason":"warm_touch_pre_invite"}'
FROM campaigns c WHERE c.name = 'warm-touch-invite';

INSERT OR IGNORE INTO campaign_steps (campaign_id, step_order, action_type, delay_hours, metadata_json)
SELECT c.id, 2, 'LIKE_POST', 24, '{"reason":"warm_touch_engagement"}'
FROM campaigns c WHERE c.name = 'warm-touch-invite';

INSERT OR IGNORE INTO campaign_steps (campaign_id, step_order, action_type, delay_hours, metadata_json)
SELECT c.id, 3, 'INVITE', 48, '{"reason":"warm_touch_final_invite"}'
FROM campaigns c WHERE c.name = 'warm-touch-invite';
