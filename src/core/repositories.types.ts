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
