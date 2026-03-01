/**
 * repositories.ts
 * Public barrel for repository layer.
 * Keeps the legacy import surface stable while implementation is modularized.
 */

export * from './repositories/leads';
export * from './repositories/jobs';
export * from './repositories/incidents';
export * from './repositories/stats';
export * from './repositories/system';
export * from './repositories/aiQuality';

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
} from './repositories.types';
