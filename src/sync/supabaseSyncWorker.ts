import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logInfo, logWarn } from '../telemetry/logger';
import {
    countPendingOutboxEvents,
    getPendingOutboxEvents,
    markOutboxDelivered,
    markOutboxPermanentFailure,
    markOutboxRetry,
} from '../core/repositories';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
    if (!config.supabaseSyncEnabled) return null;
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
    if (!client) {
        client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }
    return client;
}

function retryDelayMs(attempt: number): number {
    const base = config.supabaseSyncIntervalMs;
    const jitter = Math.floor(Math.random() * 500);
    return base * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
}

function parseOutboxPayload(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // fallback sotto
    }
    return { raw };
}

export interface SyncStatus {
    enabled: boolean;
    configured: boolean;
    pendingOutbox: number;
}

export async function getSyncStatus(): Promise<SyncStatus> {
    const pendingOutbox = await countPendingOutboxEvents();
    return {
        enabled: config.supabaseSyncEnabled,
        configured: !!(config.supabaseUrl && config.supabaseServiceRoleKey),
        pendingOutbox,
    };
}

export async function runSupabaseSyncOnce(): Promise<void> {
    const supabase = getClient();
    if (!supabase) {
        return;
    }

    const events = await getPendingOutboxEvents(config.supabaseSyncBatchSize);
    if (events.length === 0) {
        return;
    }

    let sent = 0;
    let failed = 0;
    let permanentFailures = 0;
    for (const event of events) {
        const payload = {
            topic: event.topic,
            payload: parseOutboxPayload(event.payload_json),
            idempotency_key: event.idempotency_key,
            created_at: event.created_at,
        };

        const { error } = await supabase.from('cp_events').upsert(payload, {
            onConflict: 'idempotency_key',
            ignoreDuplicates: false,
        });

        if (error) {
            failed += 1;
            const attempts = event.attempts + 1;
            if (attempts >= config.supabaseSyncMaxRetries) {
                permanentFailures += 1;
                await markOutboxPermanentFailure(event.id, attempts, error.message);
                await logWarn('supabase.sync.event.permanent_failure', {
                    eventId: event.id,
                    idempotencyKey: event.idempotency_key,
                    attempts,
                    maxRetries: config.supabaseSyncMaxRetries,
                    error: error.message,
                });
            } else {
                const delay = retryDelayMs(attempts);
                await markOutboxRetry(event.id, attempts, delay, error.message);
            }
        } else {
            sent += 1;
            await markOutboxDelivered(event.id);
        }
    }

    await logInfo('supabase.sync.batch', {
        sent,
        failed,
        permanentFailures,
        batchSize: events.length,
        maxRetries: config.supabaseSyncMaxRetries,
    });

    const pending = await countPendingOutboxEvents();
    if (pending > config.outboxAlertBacklog) {
        await logWarn('supabase.sync.backlog_high', { pending, threshold: config.outboxAlertBacklog });
        await sendTelegramAlert(`${pending} eventi pendenti non sincronizzati col cloud Supabase.`, 'Outbox Backlog Alto', 'warn');
    }
}
