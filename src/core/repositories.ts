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
export * from './repositories/automationCommands';
export * from './repositories/outboxDeliveries';
// A22: aiQuality rimosso dal barrel per rompere circular dependency chain:
// repositories → aiQuality → ai/* → openaiClient → integrationPolicy → repositories
// I consumer importano direttamente da './repositories/aiQuality'.
export * from './repositories/featureStore';
export * from './repositories/campaigns';
export * from './repositories/salesnavSync';
export * from './repositories/blacklist';

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
