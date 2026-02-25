UPDATE leads
SET status = 'READY_INVITE',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'PENDING';

