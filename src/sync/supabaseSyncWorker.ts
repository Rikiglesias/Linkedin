import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logInfo, logWarn } from '../telemetry/logger';
import { executeWithRetryPolicy, isLikelyTransientError } from '../core/integrationPolicy';
import {
    claimPendingOutboxEvents,
    countPendingOutboxEvents,
    getRuntimeFlag,
    markOutboxDeliveredClaimed,
    markOutboxPermanentFailureClaimed,
    markOutboxRetryClaimed,
    setRuntimeFlag,
} from '../core/repositories';
import {
    clampBackpressureLevel,
    computeBackpressureBatchSize,
    computeNextBackpressureLevel,
} from './backpressure';

let client: SupabaseClient | null = null;
const SUPABASE_BACKPRESSURE_LEVEL_KEY = 'sync.backpressure.supabase.level';

class TerminalSupabaseSyncError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TerminalSupabaseSyncError';
    }
}

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
    backpressureLevel: number;
    effectiveBatchSize: number;
}

async function getSupabaseBackpressureLevel(): Promise<number> {
    const raw = await getRuntimeFlag(SUPABASE_BACKPRESSURE_LEVEL_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 1;
    return clampBackpressureLevel(parsed);
}

async function setSupabaseBackpressureLevel(level: number): Promise<void> {
    await setRuntimeFlag(SUPABASE_BACKPRESSURE_LEVEL_KEY, String(clampBackpressureLevel(level)));
}

export async function getSyncStatus(): Promise<SyncStatus> {
    const pendingOutbox = await countPendingOutboxEvents();
    const backpressureLevel = await getSupabaseBackpressureLevel();
    return {
        enabled: config.supabaseSyncEnabled,
        configured: !!(config.supabaseUrl && config.supabaseServiceRoleKey),
        pendingOutbox,
        backpressureLevel,
        effectiveBatchSize: computeBackpressureBatchSize(config.supabaseSyncBatchSize, backpressureLevel),
    };
}

export async function runSupabaseSyncOnce(): Promise<void> {
    const supabase = getClient();
    if (!supabase) {
        return;
    }

    const backpressureLevel = await getSupabaseBackpressureLevel();
    const effectiveBatchSize = computeBackpressureBatchSize(config.supabaseSyncBatchSize, backpressureLevel);
    const ownerId = `supabase-sync:${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const leaseSeconds = Math.max(30, Math.ceil(config.integrationRequestTimeoutMs / 1000) * 3);
    const events = await claimPendingOutboxEvents(effectiveBatchSize, ownerId, leaseSeconds);
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

        try {
            await executeWithRetryPolicy(
                async () => {
                    const { error } = await supabase.from('cp_events').upsert(payload, {
                        onConflict: 'idempotency_key',
                        ignoreDuplicates: false,
                    });
                    if (!error) return;
                    if (isLikelyTransientError(error.message)) {
                        throw new Error(error.message);
                    }
                    throw new TerminalSupabaseSyncError(error.message);
                },
                {
                    integration: 'supabase.cp_events_upsert',
                    circuitKey: 'supabase.cp_events',
                    maxAttempts: 2,
                    classifyError: (error) => (error instanceof TerminalSupabaseSyncError ? 'terminal' : 'transient'),
                }
            );
            sent += 1;
            const delivered = await markOutboxDeliveredClaimed(event.id, ownerId);
            if (!delivered) {
                await logWarn('supabase.sync.event.claim_lost', {
                    eventId: event.id,
                    idempotencyKey: event.idempotency_key,
                    ownerId,
                    phase: 'delivered',
                });
            }
        } catch (error) {
            failed += 1;
            const attempts = event.attempts + 1;
            const message = error instanceof Error ? error.message : String(error);
            if (attempts >= config.supabaseSyncMaxRetries) {
                permanentFailures += 1;
                const marked = await markOutboxPermanentFailureClaimed(event.id, ownerId, attempts, message);
                if (!marked) {
                    await logWarn('supabase.sync.event.claim_lost', {
                        eventId: event.id,
                        idempotencyKey: event.idempotency_key,
                        ownerId,
                        phase: 'permanent_failure',
                    });
                    continue;
                }
                await logWarn('supabase.sync.event.permanent_failure', {
                    eventId: event.id,
                    idempotencyKey: event.idempotency_key,
                    attempts,
                    maxRetries: config.supabaseSyncMaxRetries,
                    error: message,
                });
            } else {
                const delay = retryDelayMs(attempts);
                const marked = await markOutboxRetryClaimed(event.id, ownerId, attempts, delay, message);
                if (!marked) {
                    await logWarn('supabase.sync.event.claim_lost', {
                        eventId: event.id,
                        idempotencyKey: event.idempotency_key,
                        ownerId,
                        phase: 'retry',
                    });
                }
            }
        }
    }

    await logInfo('supabase.sync.batch', {
        sent,
        failed,
        permanentFailures,
        batchSize: events.length,
        baseBatchSize: config.supabaseSyncBatchSize,
        effectiveBatchSize,
        backpressureLevel,
        maxRetries: config.supabaseSyncMaxRetries,
    });

    const nextBackpressureLevel = computeNextBackpressureLevel({
        currentLevel: backpressureLevel,
        sent,
        failed,
        permanentFailures,
    });
    if (nextBackpressureLevel !== backpressureLevel) {
        await setSupabaseBackpressureLevel(nextBackpressureLevel);
        await logInfo('supabase.sync.backpressure.adjusted', {
            previousLevel: backpressureLevel,
            nextLevel: nextBackpressureLevel,
            sent,
            failed,
            permanentFailures,
        });
    }

    const pending = await countPendingOutboxEvents();
    if (pending > config.outboxAlertBacklog) {
        await logWarn('supabase.sync.backlog_high', { pending, threshold: config.outboxAlertBacklog });
        await sendTelegramAlert(`${pending} eventi pendenti non sincronizzati col cloud Supabase.`, 'Outbox Backlog Alto', 'warn');
    }
}
