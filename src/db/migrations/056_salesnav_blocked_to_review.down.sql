-- Rollback migration 056: ripristina BLOCKED per lead SalesNav.
-- ATTENZIONE: se il lead è stato già processato dopo la migrazione (es. risolto URL),
-- il rollback potrebbe re-bloccare lead validi. Verificare prima del rollback.

UPDATE leads
SET status = 'BLOCKED',
    reason = REPLACE(reason, 'salesnav_url_needs_resolution', 'salesnav_url_requires_profile_invite'),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'REVIEW_REQUIRED'
  AND reason LIKE 'salesnav_url%';
