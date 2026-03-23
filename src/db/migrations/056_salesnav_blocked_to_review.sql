-- Migration 056: C10 fix — lead SalesNav bloccati in BLOCKED → REVIEW_REQUIRED.
-- BLOCKED ha zero transizioni nella state machine = dead-end irrecuperabile.
-- REVIEW_REQUIRED permette risoluzione manuale o automatica (salesnav resolve).
-- Reversibile: down migration ripristina BLOCKED.

UPDATE leads
SET status = 'REVIEW_REQUIRED',
    blocked_reason = REPLACE(blocked_reason, 'salesnav_url_requires_profile_invite', 'salesnav_url_needs_resolution'),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'BLOCKED'
  AND blocked_reason LIKE 'salesnav_url%';
