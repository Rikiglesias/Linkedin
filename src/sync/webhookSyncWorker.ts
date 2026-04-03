import { createHmac } from 'crypto';
import { config } from '../config';
import { retryDelayMs } from '../utils/async';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logInfo, logWarn } from '../telemetry/logger';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import {
    claimPendingOutboxDeliveries,
    countPendingOutboxDeliveries,
    getRuntimeFlag,
    markOutboxDeliveryDeliveredClaimed,
    markOutboxDeliveryPermanentFailureClaimed,
    markOutboxDeliveryRetryClaimed,
    setRuntimeFlag,
} from '../core/repositories';
import { clampBackpressureLevel, computeBackpressureBatchSize, computeNextBackpressureLevel } from './backpressure';

import { parseOutboxPayload } from './outboxUtils';

function buildWebhookSignature(payload: string): string | null {
    const secret = config.webhookSyncSecret;
    if (!secret) {
        return null;
    }
    const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    return `sha256=${signature}`;
}

function endpointHost(rawUrl: string): string | null {
    try {
        return new URL(rawUrl).host;
    } catch {
        return null;
    }
}

export interface WebhookSyncStatus {
    enabled: boolean;
    configured: boolean;
    pendingOutbox: number;
    endpointHost: string | null;
    backpressureLevel: number;
    effectiveBatchSize: number;
}

const WEBHOOK_BACKPRESSURE_LEVEL_KEY = 'sync.backpressure.webhook.level';

async function getWebhookBackpressureLevel(): Promise<number> {
    const raw = await getRuntimeFlag(WEBHOOK_BACKPRESSURE_LEVEL_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 1;
    return clampBackpressureLevel(parsed);
}

async function setWebhookBackpressureLevel(level: number): Promise<void> {
    await setRuntimeFlag(WEBHOOK_BACKPRESSURE_LEVEL_KEY, String(clampBackpressureLevel(level)));
}

export async function getWebhookSyncStatus(): Promise<WebhookSyncStatus> {
    const pendingOutbox = await countPendingOutboxDeliveries('WEBHOOK');
    const configured = !!config.webhookSyncUrl;
    const backpressureLevel = await getWebhookBackpressureLevel();
    return {
        enabled: config.webhookSyncEnabled,
        configured,
        pendingOutbox,
        endpointHost: configured ? endpointHost(config.webhookSyncUrl) : null,
        backpressureLevel,
        effectiveBatchSize: computeBackpressureBatchSize(config.webhookSyncBatchSize, backpressureLevel),
    };
}

export async function runWebhookSyncOnce(): Promise<void> {
    if (!config.webhookSyncEnabled || !config.webhookSyncUrl) {
        return;
    }

    const backpressureLevel = await getWebhookBackpressureLevel();
    const effectiveBatchSize = computeBackpressureBatchSize(config.webhookSyncBatchSize, backpressureLevel);
    const ownerId = `webhook-sync:${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const leaseSeconds = Math.max(30, Math.ceil(config.webhookSyncTimeoutMs / 1000) * 3);
    const events = await claimPendingOutboxDeliveries('WEBHOOK', effectiveBatchSize, ownerId, leaseSeconds);
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

        const body = JSON.stringify(payload);
        const signature = buildWebhookSignature(body);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-idempotency-key': event.idempotency_key,
            'x-event-topic': event.topic,
        };
        if (signature) {
            headers['x-signature-sha256'] = signature;
        }

        try {
            const response = await fetchWithRetryPolicy(
                config.webhookSyncUrl,
                {
                    method: 'POST',
                    headers,
                    body,
                },
                {
                    integration: 'webhook.outbox_sync',
                    circuitKey: 'webhook.sync',
                    timeoutMs: config.webhookSyncTimeoutMs,
                    maxAttempts: 2,
                },
            );

            if (!response.ok) {
                failed += 1;
                const responseText = (await response.text().catch(() => '')).slice(0, 500);
                const errorMessage = `HTTP_${response.status}:${response.statusText}${responseText ? `:${responseText}` : ''}`;
                const attempts = event.attempts + 1;
                if (attempts >= config.webhookSyncMaxRetries) {
                    permanentFailures += 1;
                    const marked = await markOutboxDeliveryPermanentFailureClaimed(
                        event.delivery_id,
                        ownerId,
                        attempts,
                        errorMessage,
                    );
                    if (!marked) {
                        await logWarn('webhook.sync.event.claim_lost', {
                            eventId: event.id,
                            deliveryId: event.delivery_id,
                            idempotencyKey: event.idempotency_key,
                            ownerId,
                            phase: 'permanent_failure',
                        });
                        continue;
                    }
                    await logWarn('webhook.sync.event.permanent_failure', {
                        eventId: event.id,
                        idempotencyKey: event.idempotency_key,
                        attempts,
                        maxRetries: config.webhookSyncMaxRetries,
                        error: errorMessage,
                    });
                } else {
                    const delay = retryDelayMs(attempts, Math.max(1000, config.webhookSyncTimeoutMs));
                    const marked = await markOutboxDeliveryRetryClaimed(
                        event.delivery_id,
                        ownerId,
                        attempts,
                        delay,
                        errorMessage,
                    );
                    if (!marked) {
                        await logWarn('webhook.sync.event.claim_lost', {
                            eventId: event.id,
                            deliveryId: event.delivery_id,
                            idempotencyKey: event.idempotency_key,
                            ownerId,
                            phase: 'retry',
                        });
                    }
                }
                continue;
            }

            sent += 1;
            const delivered = await markOutboxDeliveryDeliveredClaimed(event.delivery_id, ownerId);
            if (!delivered) {
                await logWarn('webhook.sync.event.claim_lost', {
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
            if (attempts >= config.webhookSyncMaxRetries) {
                permanentFailures += 1;
                const marked = await markOutboxDeliveryPermanentFailureClaimed(
                    event.delivery_id,
                    ownerId,
                    attempts,
                    message,
                );
                if (!marked) {
                    await logWarn('webhook.sync.event.claim_lost', {
                        eventId: event.id,
                        deliveryId: event.delivery_id,
                        idempotencyKey: event.idempotency_key,
                        ownerId,
                        phase: 'exception_permanent_failure',
                    });
                    continue;
                }
                await logWarn('webhook.sync.event.permanent_failure', {
                    eventId: event.id,
                    idempotencyKey: event.idempotency_key,
                    attempts,
                    maxRetries: config.webhookSyncMaxRetries,
                    error: message,
                });
            } else {
                const delay = retryDelayMs(attempts, Math.max(1000, config.webhookSyncTimeoutMs));
                const marked = await markOutboxDeliveryRetryClaimed(event.delivery_id, ownerId, attempts, delay, message);
                if (!marked) {
                    await logWarn('webhook.sync.event.claim_lost', {
                        eventId: event.id,
                        deliveryId: event.delivery_id,
                        idempotencyKey: event.idempotency_key,
                        ownerId,
                        phase: 'exception_retry',
                    });
                }
            }
        }
    }

    await logInfo('webhook.sync.batch', {
        sent,
        failed,
        permanentFailures,
        batchSize: events.length,
        baseBatchSize: config.webhookSyncBatchSize,
        effectiveBatchSize,
        backpressureLevel,
        maxRetries: config.webhookSyncMaxRetries,
        endpointHost: endpointHost(config.webhookSyncUrl),
    });

    const nextBackpressureLevel = computeNextBackpressureLevel({
        currentLevel: backpressureLevel,
        sent,
        failed,
        permanentFailures,
    });
    if (nextBackpressureLevel !== backpressureLevel) {
        await setWebhookBackpressureLevel(nextBackpressureLevel);
        await logInfo('webhook.sync.backpressure.adjusted', {
            previousLevel: backpressureLevel,
            nextLevel: nextBackpressureLevel,
            sent,
            failed,
            permanentFailures,
        });
    }

    const pending = await countPendingOutboxDeliveries('WEBHOOK');
    if (pending > config.outboxAlertBacklog) {
        await logWarn('webhook.sync.backlog_high', { pending, threshold: config.outboxAlertBacklog });
        await sendTelegramAlert(`${pending} eventi pendenti non inviati al Webhook.`, 'Outbox Backlog Alto', 'warn');
    }
}
