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
    email?: string | null;
    phone?: string | null;
    location?: string | null;
    salesnav_url?: string | null;
    lead_score?: number | null;
    confidence_score?: number | null;
    company_domain?: string | null;
    business_email?: string | null;
    business_email_confidence?: number | null;
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

export interface CloudEnrichmentData {
    lead_id: number;       // Supabase leads.id (cloud)
    local_lead_id?: number | null; // SQLite leads.id (local)
    company_json?: Record<string, unknown> | null;
    phones_json?: Array<Record<string, unknown>> | null;
    socials_json?: Array<Record<string, unknown>> | null;
    seniority?: string | null;
    department?: string | null;
    data_points?: number;
    confidence?: number;
    sources_json?: string[] | null;
    enriched_at?: string | null;
    updated_at?: string | null;
}

export interface CloudSalesNavMember {
    local_id?: number | null;
    list_name: string;
    linkedin_url?: string | null;
    salesnav_url?: string | null;
    profile_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    title?: string | null;
    location?: string | null;
    name_company_hash?: string | null;
    run_id?: number | null;
    search_index?: number | null;
    page_number?: number | null;
    source?: string | null;
    added_at?: string | null;
    // Outreach lifecycle
    invite_status?: string | null;
    invited_at?: string | null;
    accepted_at?: string | null;
    rejected_at?: string | null;
    message_sent_at?: string | null;
    message_text?: string | null;
    replied_at?: string | null;
    reply_text?: string | null;
    response_sent_at?: string | null;
    response_text?: string | null;
    outreach_notes?: string | null;
}
