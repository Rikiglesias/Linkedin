/**
 * A17: Indice organizzato per le operazioni di SCRITTURA lead.
 * Re-esporta le funzioni mutation da leadsCore.ts per navigabilità.
 */
export {
    addLead,
    ensureLeadList,
    syncLeadListsFromLeads,
    updateLeadCampaignConfig,
    applyControlPlaneCampaignConfigs,
    upsertSalesNavList,
    markSalesNavListSynced,
    linkLeadToSalesNavList,
    upsertSalesNavigatorLead,
    addCompanyTarget,
    setCompanyTargetStatus,
    promoteNewLeadsToReadyInvite,
    updateLeadScrapedContext,
    updateLeadPromptVariant,
    updateLeadProfileData,
    adjustLeadScore,
    updateLeadScores,
    upsertLeadEnrichmentData,
    recordLeadTimingAttribution,
    updateLeadLinkedinUrl,
    recordFollowUpSent,
    touchLeadSiteCheckAt,
    setLeadStatus,
    appendLeadEvent,
} from './leadsCore';
