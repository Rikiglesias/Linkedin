/**
 * cloudBridge.ts
 *
 * Wrapper non-bloccanti che replicano le operazioni DB locali
 * verso Supabase in background. Il flusso principale NON è mai
 * interrotto da un errore cloud: i dati locali (SQLite) rimangono
 * la source of truth assoluta.
 *
 * Utilizzo tipico:
 *   // Operazione locale (bloccante)
 *   await setLeadStatus(leadId, 'INVITED');
 *   // Replica cloud (non-bloccante, fire-and-forget)
 *   void bridgeLeadStatus(lead.linkedin_url, 'INVITED', { invited_at: new Date().toISOString() });
 */

import {
    upsertCloudLead,
    updateCloudLeadStatus,
    incrementCloudDailyStat,
    updateCloudAccountHealth,
    CloudLeadUpsert,
} from './supabaseDataClient';

// ──────────────────────────────────────────────────────────────
// Lead Bridge
// ──────────────────────────────────────────────────────────────

/**
 * Replica l'upsert di un lead verso il cloud.
 * Chiamare dopo addLead() o upsertSalesNavigatorLead() locale.
 */
export function bridgeLeadUpsert(lead: CloudLeadUpsert): void {
    void upsertCloudLead(lead).catch(() => {
        // Silenzioso: l'outbox locale gestirà il retry se necessario
    });
}

/**
 * Replica una transizione di status di un lead verso il cloud.
 * Chiamare dopo setLeadStatus() locale.
 */
export function bridgeLeadStatus(
    linkedinUrl: string,
    status: string,
    timestamps?: {
        invited_at?: string | null;
        accepted_at?: string | null;
        messaged_at?: string | null;
        last_error?: string | null;
        blocked_reason?: string | null;
    }
): void {
    void updateCloudLeadStatus(linkedinUrl, status, timestamps).catch(() => {
        // Silenzioso
    });
}

// ──────────────────────────────────────────────────────────────
// Stats Bridge
// ──────────────────────────────────────────────────────────────

/**
 * Replica un incremento di statistica giornaliera verso il cloud.
 * Chiamare dopo incrementDailyStat() locale.
 */
export function bridgeDailyStat(
    localDate: string,
    accountId: string,
    field: 'invites_sent' | 'messages_sent' | 'acceptances' | 'replies' | 'challenges_count' | 'selector_failures' | 'run_errors',
    amount: number = 1
): void {
    void incrementCloudDailyStat({ local_date: localDate, account_id: accountId, field, amount }).catch(() => {
        // Silenzioso
    });
}

// ──────────────────────────────────────────────────────────────
// Account Bridge
// ──────────────────────────────────────────────────────────────

/**
 * Aggiorna la health di un account su Supabase.
 * Chiamare dopo quarantineAccount() o pauseAutomation().
 */
export function bridgeAccountHealth(
    accountId: string,
    health: 'GREEN' | 'YELLOW' | 'RED',
    quarantineReason?: string | null,
    quarantineUntil?: string | null
): void {
    void updateCloudAccountHealth(accountId, health, quarantineReason, quarantineUntil).catch(() => {
        // Silenzioso
    });
}
