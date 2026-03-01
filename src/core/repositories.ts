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

export type {
    AddLeadInput,
    AddCompanyTargetInput,
    ApplyControlPlaneCampaignResult,
    AcquireRuntimeLockResult,
    AutomationPauseState,
    CompanyTargetRecord,
    CompanyTargetStatus,
    ControlPlaneCampaignConfigInput,
    DailyStatsSnapshot,
    JobStatusCounts,
    LeadListCampaignConfig,
    ListLeadStatusCount,
    PrivacyCleanupStats,
    RuntimeLockRecord,
    SalesNavListRecord,
    SalesNavListSummary,
    UpdateLeadLinkedinUrlResult,
    UpdateLeadListCampaignInput,
    UpsertSalesNavigatorLeadInput,
    UpsertSalesNavigatorLeadResult,
} from './repositories.types';
