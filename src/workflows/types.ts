/**
 * Tipi condivisi per i 4 workflow production-ready.
 */

export interface PreflightQuestion {
    id: string;
    prompt: string;
    type: 'string' | 'number' | 'boolean' | 'choice';
    choices?: string[];
    defaultValue?: string;
    required?: boolean;
}

export interface PreflightDbStats {
    totalLeads: number;
    byStatus: Record<string, number>;
    byList: Record<string, number>;
    withEmail: number;
    withoutEmail: number;
    withScore: number;
    withJobTitle: number;
    withPhone: number;
    withLocation: number;
    lastSyncAt: string | null;
}

export interface PreflightConfigStatus {
    proxyConfigured: boolean;
    apolloConfigured: boolean;
    hunterConfigured: boolean;
    clearbitConfigured: boolean;
    aiConfigured: boolean;
    supabaseConfigured: boolean;
    growthModelEnabled: boolean;
    weeklyStrategyEnabled: boolean;
    warmupEnabled: boolean;
    budgetInvites: number;
    budgetMessages: number;
    invitesSentToday: number;
    messagesSentToday: number;
    weeklyInvitesSent: number;
    weeklyInviteLimit: number;
    proxyIpReputation: {
        ip: string;
        abuseScore: number;
        isSafe: boolean;
        isp: string;
        country: string;
    } | null;
    staleAccounts: string[];
    noLoginAccounts: string[];
}

export interface PreflightWarning {
    level: 'info' | 'warn' | 'critical';
    message: string;
}

export type SessionRiskLevel = 'GO' | 'CAUTION' | 'STOP';

export interface SessionRiskAssessment {
    level: SessionRiskLevel;
    score: number;
    factors: Record<string, number>;
    recommendation: string;
}

export interface PreflightResult {
    answers: Record<string, string>;
    dbStats: PreflightDbStats;
    configStatus: PreflightConfigStatus;
    warnings: PreflightWarning[];
    confirmed: boolean;
    riskAssessment?: SessionRiskAssessment;
}

export interface WorkflowReportListBreakdown {
    listName: string;
    invitesSent: number;
    messagesSent: number;
    acceptanceRatePct: number;
    flag?: 'underperforming' | 'critical' | null;
}

export interface WorkflowReport {
    workflow: string;
    startedAt: Date;
    finishedAt: Date;
    success: boolean;
    summary: Record<string, number | string>;
    errors: string[];
    nextAction: string;
    listBreakdown?: WorkflowReportListBreakdown[];
    riskAssessment?: SessionRiskAssessment;
}
