/**
 * A17: Indice organizzato per le operazioni di LETTURA lead.
 * Re-esporta le funzioni query da leadsCore.ts per navigabilità.
 * I consumer possono importare da qui per chiarezza, o continuare a usare
 * il barrel repositories.ts (retrocompatibilità totale).
 */
export {
    getLeadById,
    getLeadByLinkedinUrl,
    getLeadsByStatus,
    getLeadsByStatusForList,
    getLeadsByStatusForSiteCheck,
    getLeadsForFollowUp,
    getLeadsNeedingEnrichment,
    getLeadsWithSalesNavigatorUrls,
    getLeadTimeline,
    getExpiredInvitedLeads,
    getListScoringCriteria,
    getLeadStatusCountsForLists,
    getSalesNavListByName,
    getCompanyTargetsForEnrichment,
    listLeadCampaignConfigs,
    listSalesNavLists,
    listCompanyTargets,
    listReviewQueue,
    countLeadsByStatuses,
    countCompanyTargets,
    countCompanyTargetsByStatuses,
    hasOtherAccountTargeted,
    searchLeads,
} from './leadsCore';
