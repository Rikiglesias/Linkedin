export interface CloudAccount {
    id: string;
    display_name?: string | null;
    session_dir?: string | null;
    proxy_url?: string | null;
    tier: 'WARM_UP' | 'ACTIVE' | 'QUARANTINE' | 'BANNED';
    health: 'GREEN' | 'YELLOW' | 'RED';
    daily_invite_cap: number;
    daily_message_cap: number;
    daily_invites_sent: number;
    daily_messages_sent: number;
    farming_ends_at?: string | null;
    last_active_at?: string | null;
    quarantine_reason?: string | null;
    quarantine_until?: string | null;
    updated_at?: string | null;
}

export interface CloudLeadUpsert {
    local_id?: number | null;
    linkedin_url: string;
    first_name: string;
    last_name: string;
    job_title: string;
    account_name: string;
    website: string;
    list_name: string;
    status: string;
    invited_at?: string | null;
    accepted_at?: string | null;
    messaged_at?: string | null;
    last_error?: string | null;
    blocked_reason?: string | null;
    about?: string | null;
    experience?: string | null;
    invite_note_sent?: string | null;
    lead_score?: number | null;
    confidence_score?: number | null;
    updated_at?: string | null;
}

export interface CloudJobUpsert {
    local_job_id?: number | null;
    account_id: string;
    type: string;
    status: string;
    priority: number;
    payload: Record<string, unknown>;
    idempotency_key: string;
    attempts: number;
    max_attempts: number;
    next_run_at: string;
    error_message?: string | null;
    proof_screenshot_url?: string | null;
}

export interface CloudDailyStatIncrement {
    local_date: string;
    account_id: string;
    field:
        | 'invites_sent'
        | 'messages_sent'
        | 'acceptances'
        | 'replies'
        | 'challenges_count'
        | 'selector_failures'
        | 'run_errors';
    amount?: number;
}

export interface PendingTelegramCommand {
    id: number;
    account_id: string | null;
    command: string;
    args: string | null;
}

export interface CloudCampaignConfig {
    name: string;
    is_active: boolean;
    priority: number;
    daily_invite_cap: number | null;
    daily_message_cap: number | null;
    updated_at?: string | null;
}
