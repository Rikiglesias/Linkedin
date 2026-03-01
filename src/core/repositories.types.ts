/**
 * repositories.types.ts — Tipi e interfacce del layer repository
 *
 * Separato da repositories.ts per mantenere il file delle query SQL
 * focalizzato sulla logica di accesso ai dati.
 *
 * Questi tipi sono riesportati da repositories.ts per retrocompatibilità.
 */

import { LeadStatus } from '../types/domain';

// ─── Lead ─────────────────────────────────────────────────────────────────────

export interface AddLeadInput {
    accountName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    website: string;
    linkedinUrl: string;
    listName: string;
    leadScore?: number | null;
    confidenceScore?: number | null;
    status?: LeadStatus;
}

export interface UpdateLeadLinkedinUrlResult {
    updated: boolean;
    conflictLeadId: number | null;
}

// ─── SalesNavigator ───────────────────────────────────────────────────────────

export interface UpsertSalesNavigatorLeadInput {
    accountName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    website: string;
    linkedinUrl: string;
    listName: string;
    leadScore?: number | null;
    confidenceScore?: number | null;
}

export interface UpsertSalesNavigatorLeadResult {
    leadId: number;
    action: 'inserted' | 'updated' | 'unchanged';
}

export interface SalesNavListRecord {
    id: number;
    name: string;
    url: string;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SalesNavListSummary extends SalesNavListRecord {
    leads_count: number;
}

// ─── Lead Lists / Campaign Config ─────────────────────────────────────────────

/** Tipo interno usato solo per normalizzare righe DB — non esportato. */
export interface LeadListRow {
    name: string;
    source: string;
    is_active: number;
    priority: number;
    daily_invite_cap: number | null;
    daily_message_cap: number | null;
    created_at: string;
}

export interface LeadListCampaignConfig {
    name: string;
    source: string;
    isActive: boolean;
    priority: number;
    dailyInviteCap: number | null;
    dailyMessageCap: number | null;
    createdAt: string;
}

export interface UpdateLeadListCampaignInput {
    isActive?: boolean;
    priority?: number;
    dailyInviteCap?: number | null;
    dailyMessageCap?: number | null;
}

export interface ControlPlaneCampaignConfigInput {
    name: string;
    isActive: boolean;
    priority: number;
    dailyInviteCap: number | null;
    dailyMessageCap: number | null;
}

export interface ApplyControlPlaneCampaignResult {
    fetched: number;
    applied: number;
    created: number;
    updated: number;
    unchanged: number;
    skippedInvalid: number;
}

// ─── Company Targets ──────────────────────────────────────────────────────────

export interface AddCompanyTargetInput {
    listName: string;
    accountName: string;
    website: string;
    sourceFile?: string | null;
}

export type CompanyTargetStatus = 'NEW' | 'ENRICHED' | 'NO_MATCH' | 'ERROR';

export interface CompanyTargetRecord {
    id: number;
    list_name: string;
    account_name: string;
    website: string;
    source_file: string | null;
    status: CompanyTargetStatus;
    attempts: number;
    last_error: string | null;
    processed_at: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Stats e Statistiche ──────────────────────────────────────────────────────

export interface DailyStatsSnapshot {
    date: string;
    invitesSent: number;
    messagesSent: number;
    challengesCount: number;
    selectorFailures: number;
    runErrors: number;
}

export interface LockMetricSnapshot {
    date: string;
    lockKey: string;
    metric: string;
    value: number;
}

export interface LockContentionSummary {
    acquireContended: number;
    acquireStaleTakeover: number;
    heartbeatMiss: number;
    releaseMiss: number;
    queueRaceLost: number;
}

export interface ObservabilityAlert {
    code: string;
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    message: string;
    current: number;
    threshold: number;
}

export interface OperationalObservabilitySnapshot {
    localDate: string;
    queuedJobs: number;
    runningJobs: number;
    queueLagSeconds: number;
    oldestRunningJobSeconds: number;
    pendingOutbox: number;
    invitesSent: number;
    messagesSent: number;
    runErrors: number;
    selectorFailures: number;
    challengesCount: number;
    errorRate: number;
    lockContention: LockContentionSummary;
    alerts: ObservabilityAlert[];
}

export interface JobStatusCounts {
    QUEUED: number;
    RUNNING: number;
    SUCCEEDED: number;
    FAILED: number;
    DEAD_LETTER: number;
    PAUSED: number;
}

export interface ListLeadStatusCount {
    list_name: string;
    status: LeadStatus;
    total: number;
}

export interface PrivacyCleanupStats {
    runLogs: number;
    jobAttempts: number;
    leadEvents: number;
    messageHistory: number;
    deliveredOutboxEvents: number;
    resolvedIncidents: number;
    staleListMemberships: number;
    staleLeadEvents: number;
    staleMessageHistory: number;
    staleLeads: number;
}

export interface BackupRunRecord {
    id: number;
    backup_type: string;
    target: string;
    status: string;
    backup_path: string | null;
    checksum_sha256: string | null;
    duration_ms: number | null;
    details_json: string;
    started_at: string;
    finished_at: string | null;
}

export interface SecurityAuditEventInput {
    category: string;
    action: string;
    actor?: string | null;
    accountId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    result: string;
    metadata?: Record<string, unknown>;
}

export interface SecurityAuditEventRecord {
    id: number;
    category: string;
    action: string;
    actor: string | null;
    account_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    result: string;
    correlation_id: string | null;
    metadata_json: string;
    created_at: string;
}

export interface AccountHealthSnapshotInput {
    accountId: string;
    queueProcessed: number;
    queueFailed: number;
    challenges: number;
    deadLetters: number;
    health: 'GREEN' | 'YELLOW' | 'RED';
    reason?: string | null;
    metadata?: Record<string, unknown>;
}

export interface AccountHealthSnapshotRecord {
    id: number;
    account_id: string;
    queue_processed: number;
    queue_failed: number;
    challenges: number;
    dead_letters: number;
    health: string;
    reason: string | null;
    metadata_json: string;
    observed_at: string;
}

export interface SecretRotationStatus {
    secretName: string;
    owner: string | null;
    rotatedAt: string;
    expiresAt: string | null;
    daysSinceRotation: number;
    daysToExpiry: number | null;
    status: 'OK' | 'WARN' | 'EXPIRED' | 'UNKNOWN';
    notes: string | null;
}

export type AiValidationTaskType = 'invite' | 'message' | 'sentiment';

export interface AiValidationSampleRecord {
    id: number;
    task_type: AiValidationTaskType;
    label: string;
    input_json: string;
    expected_json: string;
    tags_csv: string;
    active: number;
    created_at: string;
}

export interface AiValidationRunRecord {
    id: number;
    status: string;
    triggered_by: string | null;
    summary_json: string;
    started_at: string;
    finished_at: string | null;
}

export interface AiVariantMetric {
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
    acceptanceRate: number;
    replyRate: number;
}

export interface AiVariantComparison {
    metric: 'acceptance' | 'reply';
    baselineVariant: string;
    candidateVariant: string;
    baselineRate: number;
    candidateRate: number;
    absoluteLift: number;
    relativeLift: number;
    pValue: number | null;
    significant: boolean;
    alpha: number;
    minSampleSize: number;
}

export interface AiQualitySnapshot {
    localDate: string;
    lookbackDays: number;
    minSampleSize: number;
    alpha: number;
    intentFalsePositiveRate: number;
    intentFalsePositiveTotal: number;
    intentFalsePositiveCount: number;
    variants: AiVariantMetric[];
    comparisons: AiVariantComparison[];
    latestValidationRun: AiValidationRunRecord | null;
}

// ─── Automation / Runtime ─────────────────────────────────────────────────────

export interface AutomationPauseState {
    paused: boolean;
    pausedUntil: string | null;
    reason: string | null;
    remainingSeconds: number | null;
}

export interface RuntimeLockRecord {
    lock_key: string;
    owner_id: string;
    acquired_at: string;
    heartbeat_at: string;
    expires_at: string;
    metadata_json: string;
    updated_at: string;
}

export interface AcquireRuntimeLockResult {
    acquired: boolean;
    lock: RuntimeLockRecord | null;
}
