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

import {
    CloudAccount,
    CloudLeadUpsert,
    CloudJobUpsert,
    CloudDailyStatIncrement,
    PendingTelegramCommand,
    CloudCampaignConfig,
    CloudSalesNavMember,
} from './types';

export * from './types';

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

    const { error } = await sb
        .from('accounts')
        .upsert({ ...account, updated_at: new Date().toISOString() }, { onConflict: 'id' });
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
    quarantineUntil?: string | null,
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
    amount: number = 1,
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
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const { data } = await sb.from('accounts').select(field).eq('id', accountId).single();
            const current = (data as Record<string, number> | null)?.[field] ?? 0;
            const { error: updateErr } = await sb
                .from('accounts')
                .update({
                    [field]: current + amount,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', accountId);
            if (!updateErr) break;
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
            }
        }
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

    const { error } = await sb
        .from('leads')
        .upsert({ ...lead, updated_at: new Date().toISOString() }, { onConflict: 'linkedin_url' });
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
    patch?: Partial<CloudLeadUpsert>,
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

    const { error } = await sb
        .from('jobs_cloud')
        .upsert({ ...job, updated_at: new Date().toISOString() }, { onConflict: 'idempotency_key' });
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
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const { data } = await sb
                .from('daily_stats_cloud')
                .select(opts.field)
                .eq('local_date', opts.local_date)
                .eq('account_id', opts.account_id)
                .single();
            const current = (data as Record<string, number> | null)?.[opts.field] ?? 0;
            const { error: upsertErr } = await sb.from('daily_stats_cloud').upsert(
                {
                    local_date: opts.local_date,
                    account_id: opts.account_id,
                    [opts.field]: current + amount,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'local_date,account_id' },
            );
            if (!upsertErr) break;
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
            }
        }
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

    await sb
        .from('telegram_commands')
        .update({
            status: 'PROCESSED',
            processed_at: new Date().toISOString(),
        })
        .eq('id', commandId);
}

// ──────────────────────────────────────────────────────────────
// SalesNav list members sync
// ──────────────────────────────────────────────────────────────

/**
 * Batch upsert di profili SalesNav estratti verso Supabase.
 * Usa salesnav_url come chiave di conflitto per dedup.
 * Non-bloccante: errori loggati ma non propagati.
 */
export async function batchUpsertCloudSalesNavMembers(members: CloudSalesNavMember[]): Promise<number> {
    if (members.length === 0) return 0;
    const sb = getClient();
    if (!sb) return 0;

    const records = members.map((m) => ({
        ...m,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }));

    const CHUNK_SIZE = 200;
    let synced = 0;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        const { error, count } = await sb
            .from('salesnav_list_members')
            .upsert(chunk, { onConflict: 'list_name,salesnav_url', ignoreDuplicates: false })
            .select('id');
        if (error) {
            await logWarn('cloud.salesnav_members.batch_upsert.error', {
                chunk: i / CHUNK_SIZE,
                count: chunk.length,
                error: error.message,
            });
        } else {
            synced += count ?? chunk.length;
        }
    }

    return synced;
}

/**
 * Sincronizza i profili SalesNav non ancora sincronizzati dal DB locale a Supabase.
 * Legge dal DB locale i record con synced_at IS NULL o più vecchi di lastSyncAt.
 * Ritorna il numero di record sincronizzati.
 */
export async function syncSalesNavMembersToCloud(
    localDb: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
): Promise<number> {
    if (!isConfigured()) return 0;

    const rows = await localDb.query(
        `SELECT id, list_name, linkedin_url, salesnav_url, profile_name,
                first_name, last_name, company, title, location,
                name_company_hash, run_id, search_index, page_number, source, added_at,
                invite_status, invited_at, accepted_at, rejected_at,
                message_sent_at, message_text, replied_at, reply_text,
                response_sent_at, response_text, outreach_notes
         FROM salesnav_list_members
         WHERE salesnav_url IS NOT NULL
         ORDER BY id ASC
         LIMIT 500`,
    );

    if (rows.length === 0) return 0;

    const members: CloudSalesNavMember[] = rows.map((r) => ({
        local_id: r.id as number,
        list_name: r.list_name as string,
        linkedin_url: (r.linkedin_url as string) || null,
        salesnav_url: (r.salesnav_url as string) || null,
        profile_name: (r.profile_name as string) || null,
        first_name: (r.first_name as string) || null,
        last_name: (r.last_name as string) || null,
        company: (r.company as string) || null,
        title: (r.title as string) || null,
        location: (r.location as string) || null,
        name_company_hash: (r.name_company_hash as string) || null,
        run_id: (r.run_id as number) || null,
        search_index: (r.search_index as number) || null,
        page_number: (r.page_number as number) || null,
        source: (r.source as string) || null,
        added_at: (r.added_at as string) || null,
        invite_status: (r.invite_status as string) || null,
        invited_at: (r.invited_at as string) || null,
        accepted_at: (r.accepted_at as string) || null,
        rejected_at: (r.rejected_at as string) || null,
        message_sent_at: (r.message_sent_at as string) || null,
        message_text: (r.message_text as string) || null,
        replied_at: (r.replied_at as string) || null,
        reply_text: (r.reply_text as string) || null,
        response_sent_at: (r.response_sent_at as string) || null,
        response_text: (r.response_text as string) || null,
        outreach_notes: (r.outreach_notes as string) || null,
    }));

    return batchUpsertCloudSalesNavMembers(members);
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

            const inviteCap =
                row.daily_invite_cap === null || row.daily_invite_cap === undefined
                    ? null
                    : Math.max(0, Number(row.daily_invite_cap));
            const messageCap =
                row.daily_message_cap === null || row.daily_message_cap === undefined
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
export async function fetchCloudAccountsUpdates(
    lastSyncAt: string | null,
    limit: number = 100,
): Promise<CloudAccount[]> {
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
export async function fetchCloudLeadsUpdates(
    lastSyncAt: string | null,
    limit: number = 500,
): Promise<CloudLeadUpsert[]> {
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
