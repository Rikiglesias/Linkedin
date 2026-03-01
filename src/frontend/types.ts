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
    totalSent: number;
    accepted: number;
    replied: number;
    ucbScore: number;
}

export interface TimingSlotRow {
    hour: number;
    samples: number;
    score: number;
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
