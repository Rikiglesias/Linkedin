-- Migration 043: Add outreach lifecycle tracking to salesnav_list_members
-- Tracks: invite sent → accepted/rejected → message sent → reply → response

ALTER TABLE salesnav_list_members ADD COLUMN invite_status TEXT DEFAULT 'PENDING';
ALTER TABLE salesnav_list_members ADD COLUMN invited_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN accepted_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN rejected_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN message_sent_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN message_text TEXT;
ALTER TABLE salesnav_list_members ADD COLUMN replied_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN reply_text TEXT;
ALTER TABLE salesnav_list_members ADD COLUMN response_sent_at DATETIME;
ALTER TABLE salesnav_list_members ADD COLUMN response_text TEXT;
ALTER TABLE salesnav_list_members ADD COLUMN outreach_notes TEXT;

-- Index for filtering by outreach status
CREATE INDEX IF NOT EXISTS idx_slm_invite_status
    ON salesnav_list_members(invite_status)
    WHERE invite_status IS NOT NULL;

-- Index for finding members awaiting follow-up
CREATE INDEX IF NOT EXISTS idx_slm_accepted_pending_msg
    ON salesnav_list_members(accepted_at)
    WHERE invite_status = 'ACCEPTED' AND message_sent_at IS NULL;
