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
export * from './repositories/featureStore';
export * from './repositories/campaigns';
export * from './repositories/salesnavSync';

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
    BuildFeatureDatasetOptions,
    BuildFeatureDatasetResult,
    CompanyTargetRecord,
    CompanyTargetStatus,
    ControlPlaneCampaignConfigInput,
    DailyStatsSnapshot,
    FeatureDatasetRowInput,
    FeatureDatasetRowRecord,
    FeatureDatasetSplit,
    FeatureDatasetVersionRecord,
    FeatureStoreAction,
    ImportFeatureDatasetInput,
    JobStatusCounts,
    LockContentionSummary,
    LockMetricSnapshot,
    LeadListCampaignConfig,
    ListLeadStatusCount,
    ObservabilityAlert,
    OperationalSloSnapshot,
    OperationalSloThresholds,
    OperationalSloWindowSnapshot,
    OperationalObservabilitySnapshot,
    PrivacyCleanupStats,
    SecretRotationStatus,
    SelectorLearningRollbackSnapshotEntry,
    SelectorLearningRunRecord,
    RuntimeLockRecord,
    SalesNavListRecord,
    SalesNavListSummary,
    SalesNavSyncItemRecord,
    SalesNavSyncItemStatus,
    SalesNavSyncRunRecord,
    SalesNavSyncRunStatus,
    SalesNavSyncRunSummary,
    CreateSalesNavSyncRunInput,
    UpdateSalesNavSyncRunProgressInput,
    AddSalesNavSyncItemInput,
    SecurityAuditEventInput,
    UpdateLeadLinkedinUrlResult,
    UpdateLeadListCampaignInput,
    UpsertSalesNavigatorLeadInput,
    UpsertSalesNavigatorLeadResult,
    CampaignStepActionType,
    LeadCampaignStatus,
    CampaignRecord,
    CampaignStepRecord,
    LeadCampaignStateRecord,
} from './repositories.types';
