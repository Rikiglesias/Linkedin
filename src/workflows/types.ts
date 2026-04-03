/**
 * Tipi condivisi per i 4 workflow production-ready.
 *
 * 6 LIVELLI DI CONTROLLO PRE-FLIGHT:
 *   L1: Account Selection — menu interattivo se >1 account configurato
 *   L2: DB Analysis       — scansione database, stats, data quality
 *   L3: Config Validation  — verifica API keys, proxy, budget residuo
 *   L4: Risk Assessment    — score 0-100 a 6 fattori ponderati
 *   L5: AI Advisor         — AI analizza L2+L3+L4 e raccomanda azione
 *   L6: Anti-Ban Checklist — checklist interattiva finale context-aware
 */

export interface PreflightQuestion {
    id: string;
    prompt: string;
    type: 'string' | 'number' | 'boolean' | 'choice';
    choices?: string[];
    defaultValue?: string;
    required?: boolean;
}

export type WorkflowKind = 'sync-search' | 'sync-list' | 'send-invites' | 'send-messages';

export type WorkflowBlockedReason =
    | 'USER_CANCELLED'
    | 'PRECONDITION_FAILED'
    | 'NO_WORK_AVAILABLE'
    | 'ACCOUNT_QUARANTINED'
    | 'AUTOMATION_PAUSED'
    | 'SESSION_VARIANCE_SKIP_DAY'
    | 'DISK_CRITICAL'
    | 'OUT_OF_HOURS'
    | 'SELECTOR_FAILURE_BURST'
    | 'RUN_ERROR_BURST'
    | 'SELECTOR_CANARY_FAILED'
    | 'COMPLIANCE_HEALTH_BLOCKED'
    | 'RISK_STOP_THRESHOLD'
    | 'AI_GUARDIAN_PREEMPTIVE'
    | 'RISK_COOLDOWN'
    | 'LOGIN_REQUIRED'
    | 'WORKFLOW_ERROR';

export interface WorkflowBlockedState {
    reason: WorkflowBlockedReason;
    message: string;
    details?: Record<string, unknown>;
}

export interface GuardDecision {
    allowed: boolean;
    blocked: WorkflowBlockedState | null;
}

export type WorkflowSummaryValue = string | number | boolean | null;
export type WorkflowSummary = Record<string, WorkflowSummaryValue>;

export interface WorkflowPreviewLead {
    label: string;
    secondary?: string | null;
    tertiary?: string | null;
}

export interface WorkflowExecutionArtifacts {
    preflight?: PreflightResult<object>;
    previewLeads?: WorkflowPreviewLead[];
    estimatedMinutes?: number;
    candidateCount?: number;
    report?: WorkflowReport;
    extra?: Record<string, unknown>;
}

export interface WorkflowExecutionResult {
    workflow: WorkflowKind;
    success: boolean;
    blocked: WorkflowBlockedState | null;
    summary: WorkflowSummary;
    errors: string[];
    nextAction: string;
    riskAssessment?: SessionRiskAssessment;
    artifacts?: WorkflowExecutionArtifacts;
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
    /** Trend vs ieri (da daily_stats). Null se non ci sono dati di ieri. */
    trend: {
        invitesYesterday: number;
        messagesYesterday: number;
        acceptancesYesterday: number;
        challengesYesterday: number;
        leadsDelta: number | null;
    } | null;
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

/** Risultato dell'AI Advisor (L5). */
export interface AiAdvisorResult {
    available: boolean;
    recommendation: 'PROCEED' | 'PROCEED_CAUTION' | 'ABORT';
    reasoning: string;
    suggestedActions: string[];
    suggestedParams?: {
        limit?: number | null;
        budgetInvites?: number | null;
        budgetMessages?: number | null;
    };
}

export interface PreflightResult<TAnswers extends object = Record<string, string>> {
    answers: TAnswers;
    rawAnswers: Record<string, string>;
    dbStats: PreflightDbStats;
    configStatus: PreflightConfigStatus;
    warnings: PreflightWarning[];
    confirmed: boolean;
    riskAssessment?: SessionRiskAssessment;
    /** L1: Account selezionato (null se single-account o non interattivo). */
    selectedAccountId?: string;
    /** L5: Consiglio AI pre-flight. */
    aiAdvice?: AiAdvisorResult;
}

export interface PreflightInput<TAnswers extends object = Record<string, string>> {
    workflowName: WorkflowKind;
    questions: PreflightQuestion[];
    listFilter?: string;
    generateWarnings: (
        stats: PreflightDbStats,
        config: PreflightConfigStatus,
        answers: Record<string, string>,
    ) => PreflightWarning[];
    skipPreflight?: boolean;
    cliOverrides?: Record<string, string>;
    cliAccountId?: string;
    parseAnswers?: (answers: Record<string, string>) => TAnswers;
}

export interface SyncSearchWorkflowRequest {
    workflow: 'sync-search';
    searchName?: string;
    listName?: string;
    maxPages?: number;
    limit?: number;
    enrichment?: boolean;
    dryRun?: boolean;
    accountId?: string;
    noProxy?: boolean;
    skipPreflight?: boolean;
}

export interface SyncListWorkflowRequest {
    workflow: 'sync-list';
    listName?: string;
    listUrl?: string;
    maxPages?: number;
    maxLeads?: number;
    enrichment?: boolean;
    dryRun?: boolean;
    interactive?: boolean;
    accountId?: string;
    noProxy?: boolean;
    skipPreflight?: boolean;
}

export interface SendInvitesWorkflowRequest {
    workflow: 'send-invites';
    listName?: string;
    noteMode?: 'ai' | 'template' | 'none';
    minScore?: number;
    limit?: number;
    dryRun?: boolean;
    skipPreflight?: boolean;
    accountId?: string;
    skipEnrichment?: boolean;
}

export interface SendMessagesWorkflowRequest {
    workflow: 'send-messages';
    listName?: string;
    template?: string;
    lang?: string;
    limit?: number;
    dryRun?: boolean;
    skipPreflight?: boolean;
    accountId?: string;
    skipEnrichment?: boolean;
}

export type WorkflowExecutionRequest =
    | SyncSearchWorkflowRequest
    | SyncListWorkflowRequest
    | SendInvitesWorkflowRequest
    | SendMessagesWorkflowRequest;

export interface WorkflowExecutionRequestMap {
    'sync-search': SyncSearchWorkflowRequest;
    'sync-list': SyncListWorkflowRequest;
    'send-invites': SendInvitesWorkflowRequest;
    'send-messages': SendMessagesWorkflowRequest;
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
    summary: WorkflowSummary;
    errors: string[];
    nextAction: string;
    listBreakdown?: WorkflowReportListBreakdown[];
    riskAssessment?: SessionRiskAssessment;
}
