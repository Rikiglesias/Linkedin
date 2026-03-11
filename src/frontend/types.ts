// ─── Data Layer Types ─────────────────────────────────────────────────────────

export type FetchState = 'idle' | 'loading' | 'success' | 'error';

export interface FetchResult<T> {
    state: FetchState;
    data: T;
    error: ApiError | null;
}

export interface ApiError {
    status: number;
    message: string;
    retryable: boolean;
}

export interface FunnelMetrics {
    totalLeads: number;
    invited: number;
    accepted: number;
    readyMessage: number;
    messaged: number;
    replied: number;
    withdrawn?: number;
}

export interface KpiResponse {
    funnel: FunnelMetrics;
    risk?: { score?: number };
    system: {
        pausedUntil: string | null;
        quarantined: boolean;
    };
}

export interface CampaignRunRecord {
    id: number;
    start_time: string;
    end_time: string | null;
    status: string;
    profiles_discovered: number;
    invites_sent: number;
    messages_sent: number;
    errors_count: number;
    created_at?: string;
}

export interface IncidentRecord {
    id: number;
    type: string;
    severity: 'INFO' | 'WARN' | 'CRITICAL' | string;
    opened_at: string;
    details_json?: string | null;
}

export interface TrendRow {
    date: string;
    invitesSent: number;
    messagesSent: number;
    acceptances: number;
    runErrors: number;
    challenges: number;
    estimatedRiskScore: number;
}

export interface PredictiveRiskAlert {
    metric: string;
    zScore: number;
}

export interface PredictiveRiskResponse {
    enabled: boolean;
    lookbackDays: number;
    alerts: PredictiveRiskAlert[];
}

export interface ReviewQueueLead {
    id: number;
    status: string;
    listName: string;
    firstName: string;
    lastName: string;
    linkedinUrl: string;
    updatedAt: string;
    lastError?: string | null;
}

export interface ReviewQueueResponse {
    pending: boolean;
    lastIncidentId: number | null;
    reviewLeadCount: number;
    challengeIncidentCount: number;
    leads: ReviewQueueLead[];
    incidents: IncidentRecord[];
}

export interface AbLeaderboardRow {
    variantId: string;
    totalSent?: number;
    sent?: number;
    accepted: number;
    replied: number;
    ucbScore?: number;
    bayesScore?: number;
    significanceWinner?: boolean;
}

export interface TimingSlotRow {
    hour: number;
    samples: number;
    score: number;
}

export interface OperationalSloWindow {
    windowDays: number;
    status: 'OK' | 'WARN' | 'CRITICAL';
    errorRate: number;
    challengeRate: number;
    selectorFailureRate: number;
}

export interface OperationalSloSnapshot {
    status: 'OK' | 'WARN' | 'CRITICAL';
    current: {
        status: 'OK' | 'WARN' | 'CRITICAL';
        queueLagSeconds: number;
        oldestRunningJobSeconds: number;
    };
    windows: OperationalSloWindow[];
}

export interface SelectorCacheKpiSnapshot {
    windowDays: number;
    previousWindowDays: number;
    currentFailures: number;
    previousFailures: number;
    reductionRate: number | null;
    reductionPct: number | null;
    targetReductionRate: number;
    minBaselineFailures: number;
    baselineSufficient: boolean;
    validationStatus: 'PASS' | 'WARN' | 'INSUFFICIENT_DATA';
    targetMet: boolean;
}

export interface ProxyPoolSnapshot {
    configured: boolean;
    total: number;
    ready: number;
    cooling: number;
    mobile: number;
    residential: number;
    unknown: number;
    rotationCursor: number;
}

export interface ObservabilitySnapshot {
    slo?: OperationalSloSnapshot;
    selectorCacheKpi?: SelectorCacheKpiSnapshot;
    proxyPool?: ProxyPoolSnapshot;
}

export interface CommentSuggestionItem {
    leadId: number;
    firstName: string;
    lastName: string;
    listName: string;
    linkedinUrl: string;
    suggestionIndex: number;
    postIndex: number;
    postSnippet: string;
    comment: string;
    confidence: number;
    source: string;
    model: string | null;
    status: 'REVIEW_PENDING' | 'APPROVED' | 'REJECTED';
    generatedAt: string | null;
}

export interface CommentSuggestionQueueResponse {
    status: string;
    count: number;
    rows: CommentSuggestionItem[];
}

export interface DashboardSnapshot {
    kpis: KpiResponse;
    runs: CampaignRunRecord[];
    incidents: IncidentRecord[];
    trend: TrendRow[];
    predictive: PredictiveRiskResponse;
    reviewQueue: ReviewQueueResponse;
    ab: AbLeaderboardRow[];
    timingSlots: TimingSlotRow[];
    observability: ObservabilitySnapshot;
    commentSuggestions: CommentSuggestionQueueResponse;
}

export interface LeadSearchRecord {
    id: number;
    account_name: string | null;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    linkedin_url: string;
    status: string;
    list_name: string | null;
    lead_score: number | null;
    email: string | null;
    updated_at: string;
}

export interface LeadSearchResponse {
    leads: LeadSearchRecord[];
    total: number;
    page: number;
    pageSize: number;
}

export interface LeadTimelineEvent {
    from_status: string;
    to_status: string;
    reason: string;
    metadata_json: string;
    created_at: string;
}

export interface LeadDetailResponse {
    lead: LeadSearchRecord;
    timeline: LeadTimelineEvent[];
}

export interface TimelineEntry {
    id: string;
    type: string;
    timestamp: string;
    accountId: string | null;
    listName: string | null;
    summary: string;
    payload: Record<string, unknown>;
}

export interface TimelineFilter {
    type: string;
    accountId: string;
    listName: string;
}
