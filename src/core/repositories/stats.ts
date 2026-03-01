/**
 * repositories/stats.ts
 * Domain exports: KPIs, daily stats, campaign runs, risk inputs.
 */

export {
    getDailyStat,
    getDailyStatsSnapshot,
    getRecentDailyStats,
    getListDailyStat,
    incrementDailyStat,
    incrementListDailyStat,
    countWeeklyInvites,
    getRiskInputs,
    getGlobalKPIData,
    startCampaignRun,
    finishCampaignRun,
    getABTestingStats,
    getAccountAgeDays,
} from './legacy';

export type { GlobalKPIData, CampaignRunMetrics } from './legacy';
