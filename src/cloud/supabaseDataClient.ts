/**
 * supabaseDataClient.ts
 *
 * Client Supabase per operazioni sui dati operativi cloud.
 * Tutte le operazioni sono non-bloccanti: in assenza di config
 * o in caso di errore di rete, falliscono silenziosamente
 * senza interrompere il flusso principale del bot.
 *
 * Architettura: Dual-Write (SQLite locale è la source of truth,
 * Supabase è il mirror cloud per monitoring, analytics e Control Plane).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logWarn } from '../telemetry/logger';

// ──────────────────────────────────────────────────────────────
// Client singleton
// ──────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
    if (!config.supabaseSyncEnabled) return null;
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
    if (!_client) {
        _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
    return _client;
}

function isConfigured(): boolean {
    return !!(config.supabaseSyncEnabled && config.supabaseUrl && config.supabaseServiceRoleKey);
}

// ──────────────────────────────────────────────────────────────
// Tipi cloud
// ──────────────────────────────────────────────────────────────

export interface CloudAccount {
    id: string;
    display_name?: string | null;
    session_dir?: string | null;
    proxy_url?: string | null;
    tier: 'WARM_UP' | 'ACTIVE' | 'QUARANTINE' | 'BANNED';
    health: 'GREEN' | 'YELLOW' | 'RED';
    daily_invite_cap: number;
    daily_message_cap: number;
    daily_invites_sent: number;
    daily_messages_sent: number;
    farming_ends_at?: string | null;
    last_active_at?: string | null;
    quarantine_reason?: string | null;
    quarantine_until?: string | null;
    updated_at?: string | null;
}

export interface CloudLeadUpsert {
    local_id?: number | null;
    linkedin_url: string;
    first_name: string;
    last_name: string;
    job_title: string;
    account_name: string;
    website: string;
    list_name: string;
    status: string;
    invited_at?: string | null;
    accepted_at?: string | null;
    messaged_at?: string | null;
    last_error?: string | null;
    blocked_reason?: string | null;
    about?: string | null;
    experience?: string | null;
    invite_note_sent?: string | null;
    lead_score?: number | null;
    confidence_score?: number | null;
    updated_at?: string | null;
}

export interface CloudJobUpsert {
    local_job_id?: number | null;
    account_id: string;
    type: string;
    status: string;
    priority: number;
    payload: Record<string, unknown>;
    idempotency_key: string;
    attempts: number;
    max_attempts: number;
    next_run_at: string;
    error_message?: string | null;
    proof_screenshot_url?: string | null;
}

export interface CloudDailyStatIncrement {
    local_date: string;
    account_id: string;
    field: 'invites_sent' | 'messages_sent' | 'acceptances' | 'replies' | 'challenges_count' | 'selector_failures' | 'run_errors';
    amount?: number;
}

export interface PendingTelegramCommand {
    id: number;
    account_id: string | null;
    command: string;
    args: string | null;
}

export interface CloudCampaignConfig {
    name: string;
    is_active: boolean;
    priority: number;
    daily_invite_cap: number | null;
    daily_message_cap: number | null;
    updated_at?: string | null;
}

// ──────────────────────────────────────────────────────────────
// Account sync
// ──────────────────────────────────────────────────────────────

/**
 * Upserta un account nel cloud. Usare al boot del worker
 * per sincronizzare lo stato dell'account verso Supabase.
 */
export async function upsertCloudAccount(account: CloudAccount): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const { error } = await sb.from('accounts').upsert(
        { ...account, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
    );
    if (error) {
        await logWarn('cloud.accounts.upsert.error', { accountId: account.id, error: error.message });
    }
}

/**
 * Aggiorna health e tier di un account cloud.
 * Chiamare quando l'AI Guardian o l'Incident Manager cambia stato.
 */
export async function updateCloudAccountHealth(
    accountId: string,
    health: CloudAccount['health'],
    quarantineReason?: string | null,
    quarantineUntil?: string | null
): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const patch: Record<string, unknown> = { health, updated_at: new Date().toISOString() };
    if (quarantineReason !== undefined) patch['quarantine_reason'] = quarantineReason;
    if (quarantineUntil !== undefined) patch['quarantine_until'] = quarantineUntil;

    const { error } = await sb.from('accounts').update(patch).eq('id', accountId);
    if (error) {
        await logWarn('cloud.accounts.health.update.error', { accountId, error: error.message });
    }
}

/**
 * Aggiorna il contatore giornaliero inviti/messaggi su un account cloud.
 */
export async function incrementCloudAccountCounter(
    accountId: string,
    field: 'daily_invites_sent' | 'daily_messages_sent',
    amount: number = 1
): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    // PostgreSQL: usiamo rpc per fare incremento atomico
    const { error } = await sb.rpc('increment_account_counter', {
        p_account_id: accountId,
        p_field: field,
        p_amount: amount,
    });
    if (error) {
        // Fallback: leggi il valore corrente e fai update manuale
        const { data } = await sb.from('accounts').select(field).eq('id', accountId).single();
        const current = (data as Record<string, number> | null)?.[field] ?? 0;
        await sb.from('accounts').update({
            [field]: current + amount,
            updated_at: new Date().toISOString(),
        }).eq('id', accountId);
    }
}

// ──────────────────────────────────────────────────────────────
// Lead sync
// ──────────────────────────────────────────────────────────────

/**
 * Upserta un lead nel cloud. linkedin_url è la chiave di conflitto.
 * Non-bloccante: errori sono loggati ma non propagati.
 */
export async function upsertCloudLead(lead: CloudLeadUpsert): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const { error } = await sb.from('leads').upsert(
        { ...lead, updated_at: new Date().toISOString() },
        { onConflict: 'linkedin_url' }
    );
    if (error) {
        await logWarn('cloud.leads.upsert.error', { linkedinUrl: lead.linkedin_url, error: error.message });
    }
}

/**
 * Aggiorna lo status di un lead cloud (es. da INVITED a CONNECTED).
 * Chiamare dopo ogni setLeadStatus locale riuscito.
 */
export async function updateCloudLeadStatus(
    linkedinUrl: string,
    status: string,
    patch?: Partial<CloudLeadUpsert>
): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const record: Record<string, unknown> = {
        ...patch,
        status,
        updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from('leads').update(record).eq('linkedin_url', linkedinUrl);
    if (error) {
        await logWarn('cloud.leads.status.update.error', { linkedinUrl, status, error: error.message });
    }
}

/**
 * Batch upsert di un array di lead. Usare nella prima sync
 * o durante l'importazione CSV massiva.
 */
export async function batchUpsertCloudLeads(leads: CloudLeadUpsert[]): Promise<void> {
    if (leads.length === 0) return;
    const sb = getClient();
    if (!sb) return;

    const records = leads.map((l) => ({ ...l, updated_at: new Date().toISOString() }));
    const CHUNK_SIZE = 200;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        const { error } = await sb.from('leads').upsert(chunk, { onConflict: 'linkedin_url' });
        if (error) {
            await logWarn('cloud.leads.batch_upsert.error', {
                chunk: i / CHUNK_SIZE,
                count: chunk.length,
                error: error.message,
            });
        }
    }
}

// ──────────────────────────────────────────────────────────────
// Job sync
// ──────────────────────────────────────────────────────────────

/**
 * Upserta un job nel cloud. Usare al momento della creazione
 * e aggiornamento dello stato del job.
 */
export async function upsertCloudJob(job: CloudJobUpsert): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const { error } = await sb.from('jobs_cloud').upsert(
        { ...job, updated_at: new Date().toISOString() },
        { onConflict: 'idempotency_key' }
    );
    if (error) {
        await logWarn('cloud.jobs.upsert.error', { idempotencyKey: job.idempotency_key, error: error.message });
    }
}

// ──────────────────────────────────────────────────────────────
// Daily stats cloud sync
// ──────────────────────────────────────────────────────────────

/**
 * Incrementa una statistica giornaliera nel cloud.
 * Replica di incrementDailyStat locale in formato cloud.
 */
export async function incrementCloudDailyStat(opts: CloudDailyStatIncrement): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    const amount = opts.amount ?? 1;
    const { error } = await sb.rpc('increment_daily_stat_cloud', {
        p_local_date: opts.local_date,
        p_account_id: opts.account_id,
        p_field: opts.field,
        p_amount: amount,
    });
    if (error) {
        // Fallback: upsert manuale
        const { data } = await sb
            .from('daily_stats_cloud')
            .select(opts.field)
            .eq('local_date', opts.local_date)
            .eq('account_id', opts.account_id)
            .single();
        const current = (data as Record<string, number> | null)?.[opts.field] ?? 0;
        await sb.from('daily_stats_cloud').upsert(
            {
                local_date: opts.local_date,
                account_id: opts.account_id,
                [opts.field]: current + amount,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'local_date,account_id' }
        );
    }
}

// ──────────────────────────────────────────────────────────────
// Telegram Command polling (Control Plane)
// ──────────────────────────────────────────────────────────────

/**
 * Preleva il primo comando Telegram pendente per un determinato account.
 * Usare nel loop principale per intercettare interventi umani (es. pin 2FA).
 */
export async function pollPendingTelegramCommand(accountId: string): Promise<PendingTelegramCommand | null> {
    const sb = getClient();
    if (!sb) return null;

    const { data, error } = await sb
        .from('telegram_commands')
        .select('id, account_id, command, args')
        .eq('status', 'PENDING')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (error || !data) return null;
    return data as PendingTelegramCommand;
}

/**
 * Segna un comando Telegram come processato.
 */
export async function markTelegramCommandProcessed(commandId: number): Promise<void> {
    const sb = getClient();
    if (!sb) return;

    await sb.from('telegram_commands').update({
        status: 'PROCESSED',
        processed_at: new Date().toISOString(),
    }).eq('id', commandId);
}

// ──────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────

/**
 * Verifica la connettività con Supabase.
 * Ritorna true se il cloud è raggiungibile e configurato.
 */
export async function checkCloudConnectivity(): Promise<boolean> {
    if (!isConfigured()) return false;
    const sb = getClient();
    if (!sb) return false;

    try {
        const { error } = await sb.from('accounts').select('id').limit(1);
        return !error;
    } catch {
        return false;
    }
}

/**
 * Legge le configurazioni campagne dal Control Plane Supabase.
 * La tabella attesa e `campaigns`.
 */
export async function fetchCloudCampaignConfigs(limit: number): Promise<CloudCampaignConfig[]> {
    const sb = getClient();
    if (!sb) return [];

    const safeLimit = Math.max(1, limit);
    try {
        const { data, error } = await sb
            .from('campaigns')
            .select('name, is_active, priority, daily_invite_cap, daily_message_cap, updated_at')
            .order('priority', { ascending: true })
            .order('name', { ascending: true })
            .limit(safeLimit);

        if (error || !data) {
            await logWarn('cloud.campaigns.fetch.error', { error: error?.message ?? 'unknown' });
            return [];
        }

        const normalized: CloudCampaignConfig[] = [];
        for (const row of data as Array<Record<string, unknown>>) {
            const rawName = typeof row.name === 'string' ? row.name.trim() : '';
            if (!rawName) continue;

            const rawPriority = typeof row.priority === 'number' ? row.priority : Number(row.priority ?? 100);
            const priority = Number.isFinite(rawPriority) ? Math.max(1, Math.floor(rawPriority)) : 100;

            const inviteCap = row.daily_invite_cap === null || row.daily_invite_cap === undefined
                ? null
                : Math.max(0, Number(row.daily_invite_cap));
            const messageCap = row.daily_message_cap === null || row.daily_message_cap === undefined
                ? null
                : Math.max(0, Number(row.daily_message_cap));

            normalized.push({
                name: rawName,
                is_active: row.is_active === false ? false : true,
                priority,
                daily_invite_cap: inviteCap !== null && Number.isFinite(inviteCap) ? Math.floor(inviteCap) : null,
                daily_message_cap: messageCap !== null && Number.isFinite(messageCap) ? Math.floor(messageCap) : null,
                updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
            });
        }
        return normalized;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await logWarn('cloud.campaigns.fetch.exception', { error: message });
        return [];
    }
}

// ──────────────────────────────────────────────────────────────
// Downsync (Bidirectional Sync)
// ──────────────────────────────────────────────────────────────

/**
 * Legge gli accounts modificati sul cloud dopo lastSyncAt.
 */
export async function fetchCloudAccountsUpdates(lastSyncAt: string | null, limit: number = 100): Promise<CloudAccount[]> {
    const sb = getClient();
    if (!sb) return [];

    const safeLimit = Math.max(1, limit);
    try {
        let query = sb.from('accounts').select('*').order('updated_at', { ascending: true }).limit(safeLimit);

        if (lastSyncAt) {
            query = query.gt('updated_at', lastSyncAt);
        }

        const { data, error } = await query;

        if (error || !data) {
            await logWarn('cloud.accounts.fetch_updates.error', { error: error?.message ?? 'unknown' });
            return [];
        }

        // Cast safely
        return data as CloudAccount[];
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await logWarn('cloud.accounts.fetch_updates.exception', { error: message });
        return [];
    }
}

/**
 * Legge i leads modificati sul cloud dopo lastSyncAt.
 */
export async function fetchCloudLeadsUpdates(lastSyncAt: string | null, limit: number = 500): Promise<CloudLeadUpsert[]> {
    const sb = getClient();
    if (!sb) return [];

    const safeLimit = Math.max(1, limit);
    try {
        let query = sb.from('leads').select('*').order('updated_at', { ascending: true }).limit(safeLimit);

        if (lastSyncAt) {
            query = query.gt('updated_at', lastSyncAt);
        }

        const { data, error } = await query;

        if (error || !data) {
            await logWarn('cloud.leads.fetch_updates.error', { error: error?.message ?? 'unknown' });
            return [];
        }

        // Cast safely
        return data as CloudLeadUpsert[];
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await logWarn('cloud.leads.fetch_updates.exception', { error: message });
        return [];
    }
}
