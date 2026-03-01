/**
 * repositories/legacy.ts
 * Backward-compatible barrel kept for imports that still reference "legacy".
 * Implementations are now split by bounded context modules.
 */

export * from './leads';
export * from './jobs';
export * from './incidents';
export * from './stats';
export * from './system';
export * from './aiQuality';
export * from './lockMetrics';

export type {
    AddLeadInput,
    AddCompanyTargetInput,
    ApplyControlPlaneCampaignResult,
    AiQualitySnapshot,
    AiValidationRunRecord,
    AiValidationSampleRecord,
    AiValidationTaskType,
    AiVariantComparison,
    AiVariantMetric,
    AcquireRuntimeLockResult,
    AccountHealthSnapshotInput,
    AutomationPauseState,
    BackupRunRecord,
    CompanyTargetRecord,
    CompanyTargetStatus,
    ControlPlaneCampaignConfigInput,
    DailyStatsSnapshot,
    JobStatusCounts,
    LockContentionSummary,
    LockMetricSnapshot,
    LeadListCampaignConfig,
    ListLeadStatusCount,
    ObservabilityAlert,
    OperationalObservabilitySnapshot,
    PrivacyCleanupStats,
    SecretRotationStatus,
    RuntimeLockRecord,
    SalesNavListRecord,
    SalesNavListSummary,
    SecurityAuditEventInput,
    UpdateLeadLinkedinUrlResult,
    UpdateLeadListCampaignInput,
    UpsertSalesNavigatorLeadInput,
    UpsertSalesNavigatorLeadResult,
} from '../repositories.types';
