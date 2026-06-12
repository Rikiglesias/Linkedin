import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { retryDelayMs } from '../utils/async';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logInfo, logWarn } from '../telemetry/logger';
import { executeWithRetryPolicy, isLikelyTransientError } from '../core/integrationPolicy';
import {
    claimPendingOutboxDeliveries,
    countPendingOutboxDeliveries,
    getRuntimeFlag,
    markOutboxDeliveryDeliveredClaimed,
    markOutboxDeliveryPermanentFailureClaimed,
    markOutboxDeliveryRetryClaimed,
    setRuntimeFlag,
} from '../core/repositories';
import {
    upsertCloudLead,
    updateCloudLeadStatus,
    updateCloudAccountHealth,
    incrementCloudDailyStatIdem,
    eraseCloudLead,
    type CloudLeadUpsert,
    type CloudDailyStatIncrement,
} from '../cloud/supabaseDataClient';
import { clampBackpressureLevel, computeBackpressureBatchSize, computeNextBackpressureLevel } from './backpressure';

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

/**
 * D2: ri-applica l'OPERAZIONE cloud originale associata a un evento outbox `cloud.*`, oltre a
 * loggarlo in cp_events. Senza questo, il fallback outbox scriveva solo l'evento in cp_events
 * (event-log) e il dato (lead/status/health) non arrivava MAI alle tabelle cloud → dato perso.
 *
 * Idempotenza: ri-applica le operazioni di upsert (idempotenti via onConflict) e — dal follow-up D2
 * — anche `cloud.daily_stat` via incrementCloudDailyStatIdem: la RPC claima l'idempotency_key
 * dell'evento outbox e fa l'increment nella stessa transazione, quindi un re-apply al retry è no-op
 * (il drain usa executeWithRetryPolicy: il re-apply DEVE essere safe). Senza idempotencyKey
 * (caller legacy) il topic resta solo-log: mai increment non-idempotente.
 * Gli altri topic (risk.*, scheduler.*, ai.*) sono eventi di telemetria: solo log in cp_events.
 */
const DAILY_STAT_FIELDS: ReadonlyArray<CloudDailyStatIncrement['field']> = [
    'invites_sent',
    'messages_sent',
    'acceptances',
    'replies',
    'challenges_count',
    'selector_failures',
    'run_errors',
];

export async function applyOutboxOperation(
    topic: string,
    rawPayload: unknown,
    idempotencyKey?: string,
): Promise<void> {
    if (!rawPayload || typeof rawPayload !== 'object') return;
    const p = rawPayload as Record<string, unknown>;
    switch (topic) {
        case 'cloud.lead.upsert': {
            if (p.lead && typeof p.lead === 'object') {
                await upsertCloudLead(p.lead as CloudLeadUpsert);
            }
            return;
        }
        case 'cloud.lead.status': {
            if (typeof p.linkedinUrl === 'string' && typeof p.status === 'string') {
                await updateCloudLeadStatus(
                    p.linkedinUrl,
                    p.status,
                    (p.timestamps as Parameters<typeof updateCloudLeadStatus>[2]) ?? undefined,
                );
            }
            return;
        }
        case 'cloud.account.health': {
            if (
                typeof p.accountId === 'string' &&
                (p.health === 'GREEN' || p.health === 'YELLOW' || p.health === 'RED')
            ) {
                await updateCloudAccountHealth(
                    p.accountId,
                    p.health,
                    (p.quarantineReason as string | null | undefined) ?? null,
                    (p.quarantineUntil as string | null | undefined) ?? null,
                );
            }
            return;
        }
        case 'cloud.lead.erase': {
            // GDPR Art.17 (goal gdpr-erasure-cloud): propaga l'erasure alla copia cloud.
            // FAIL-LOUD: payload malformato o errore cloud → throw → retry e, a esaurimento,
            // DLQ + alert Telegram. Un'erasure persa in silenzio = violazione, mai swallow.
            if (
                typeof p.linkedinUrl !== 'string' ||
                p.linkedinUrl.length === 0 ||
                typeof p.urlHash !== 'string' ||
                p.urlHash.length === 0
            ) {
                throw new Error('cloud.lead.erase: payload non valido (attesi linkedinUrl e urlHash)');
            }
            await eraseCloudLead(p.linkedinUrl, p.urlHash);
            return;
        }
        case 'cloud.daily_stat': {
            if (
                typeof idempotencyKey === 'string' &&
                idempotencyKey.length > 0 &&
                typeof p.localDate === 'string' &&
                typeof p.accountId === 'string' &&
                DAILY_STAT_FIELDS.includes(p.field as CloudDailyStatIncrement['field'])
            ) {
                await incrementCloudDailyStatIdem({
                    local_date: p.localDate,
                    account_id: p.accountId,
                    field: p.field as CloudDailyStatIncrement['field'],
                    amount: typeof p.amount === 'number' ? p.amount : 1,
                    idempotencyKey,
                });
            }
            return;
        }
        default:
            // Eventi di telemetria → solo cp_events.
            return;
    }
}

import { parseOutboxPayload } from './outboxUtils';

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
    const pendingOutbox = await countPendingOutboxDeliveries('SUPABASE');
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
    const events = await claimPendingOutboxDeliveries('SUPABASE', effectiveBatchSize, ownerId, leaseSeconds);
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
                    // D2: ri-applica l'operazione cloud originale PRIMA di loggare l'evento in
                    // cp_events — altrimenti il dato (lead/status/health/daily_stat) andrebbe perso.
                    // L'idempotency_key permette il recupero di cloud.daily_stat senza doppio conteggio.
                    await applyOutboxOperation(payload.topic, payload.payload, payload.idempotency_key);
                    // GDPR: l'evento erase trasporta l'URL raw (serve alla query cloud) ma il LOG
                    // in cp_events non deve ri-depositare la PII appena cancellata → redazione
                    // hash-only del payload (la key è già hash-based all'emissione).
                    const loggedPayload =
                        payload.topic === 'cloud.lead.erase' && payload.payload && typeof payload.payload === 'object'
                            ? {
                                  ...payload,
                                  payload: {
                                      gdpr_redacted: true,
                                      urlHash: (payload.payload as Record<string, unknown>).urlHash ?? null,
                                  },
                              }
                            : payload;
                    const { error } = await supabase.from('cp_events').upsert(loggedPayload, {
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
                },
            );
            sent += 1;
            const delivered = await markOutboxDeliveryDeliveredClaimed(event.delivery_id, ownerId);
            if (!delivered) {
                await logWarn('supabase.sync.event.claim_lost', {
                    eventId: event.id,
                    deliveryId: event.delivery_id,
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
                const marked = await markOutboxDeliveryPermanentFailureClaimed(
                    event.delivery_id,
                    ownerId,
                    attempts,
                    message,
                );
                if (!marked) {
                    await logWarn('supabase.sync.event.claim_lost', {
                        eventId: event.id,
                        deliveryId: event.delivery_id,
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
                const delay = retryDelayMs(attempts, config.supabaseSyncIntervalMs);
                const marked = await markOutboxDeliveryRetryClaimed(event.delivery_id, ownerId, attempts, delay, message);
                if (!marked) {
                    await logWarn('supabase.sync.event.claim_lost', {
                        eventId: event.id,
                        deliveryId: event.delivery_id,
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

    const pending = await countPendingOutboxDeliveries('SUPABASE');
    if (pending > config.outboxAlertBacklog) {
        await logWarn('supabase.sync.backlog_high', { pending, threshold: config.outboxAlertBacklog });
        await sendTelegramAlert(
            `${pending} eventi pendenti non sincronizzati col cloud Supabase.`,
            'Outbox Backlog Alto',
            'warn',
        );
    }

    // I PERMANENT_FAILURE escono dal conteggio `pending` -> l'alert backlog è cieco ad essi.
    // Alert dedicato: ogni evento perso definitivamente verso il cloud va notificato (verifica DLQ).
    if (permanentFailures > 0) {
        await logWarn('supabase.sync.permanent_failures', { permanentFailures, sent, failed });
        await sendTelegramAlert(
            `${permanentFailures} eventi in PERMANENT_FAILURE verso Supabase: non verranno più ritentati. Verifica la DLQ.`,
            'Supabase Sync - Permanent Failures',
            'critical',
        );
    }
}
