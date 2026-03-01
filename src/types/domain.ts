export type LeadStatus =
    | 'NEW'
    | 'READY_INVITE'
    | 'INVITED'
    | 'ACCEPTED'
    | 'READY_MESSAGE'
    | 'MESSAGED'
    | 'SKIPPED'
    | 'BLOCKED'
    | 'DEAD'
    | 'REPLIED'
    | 'CONNECTED'
    | 'REVIEW_REQUIRED'
    | 'WITHDRAWN'
    | 'PENDING'; // compat legacy

export type JobType = 'INVITE' | 'ACCEPTANCE_CHECK' | 'MESSAGE' | 'HYGIENE';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER' | 'PAUSED';

export interface LeadRecord {
    id: number;
    account_name: string;
    first_name: string;
    last_name: string;
    job_title: string;
    website: string;
    linkedin_url: string;
    status: LeadStatus;
    list_name: string;
    invited_at: string | null;
    accepted_at: string | null;
    messaged_at: string | null;
    last_site_check_at?: string | null;
    last_error: string | null;
    blocked_reason: string | null;
    about: string | null;
    experience: string | null;
    invite_prompt_variant: string | null;
    lead_score: number | null;
    confidence_score: number | null;
    created_at: string;
    updated_at: string | null;
}

export interface JobRecord {
    id: number;
    type: JobType;
    status: JobStatus;
    account_id: string;
    payload_json: string;
    idempotency_key: string;
    priority: number;
    attempts: number;
    max_attempts: number;
    next_run_at: string;
    locked_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string | null;
}

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PAUSED';

export interface CampaignRunRecord {
    id: number;
    start_time: string;
    end_time: string | null;
    status: RunStatus;
    profiles_discovered: number;
    invites_sent: number;
    messages_sent: number;
    errors_count: number;
    created_at: string;
}

export interface InviteJobPayload {
    leadId: number;
    localDate: string;
}

export interface AcceptanceJobPayload {
    leadId: number;
}

export interface MessageJobPayload {
    leadId: number;
    acceptedAtDate: string;
}

export type JobPayload = InviteJobPayload | AcceptanceJobPayload | MessageJobPayload;

export interface RiskInputs {
    pendingRatio: number;
    errorRate: number;
    selectorFailureRate: number;
    challengeCount: number;
    inviteVelocityRatio: number;
}

export interface RiskSnapshot {
    score: number;
    pendingRatio: number;
    errorRate: number;
    selectorFailureRate: number;
    challengeCount: number;
    inviteVelocityRatio: number;
    action: 'NORMAL' | 'WARN' | 'LOW_ACTIVITY' | 'STOP';
}

export interface IncidentRecord {
    id: number;
    type: string;
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    status: 'OPEN' | 'ACK' | 'RESOLVED';
    details_json: string;
    opened_at: string;
    acknowledged_at: string | null;
    resolved_at: string | null;
}

export interface OutboxEventRecord {
    id: number;
    topic: string;
    payload_json: string;
    idempotency_key: string;
    attempts: number;
    next_retry_at: string;
    delivered_at: string | null;
    last_error: string | null;
    created_at: string;
}

export interface MessageValidationResult {
    valid: boolean;
    reasons: string[];
}

export interface ABTestStats {
    variant: string;
    totalSent: number;
    totalAccepted: number;
    totalReplied: number;
    acceptanceRate: number;
    replyRate: number;
}
