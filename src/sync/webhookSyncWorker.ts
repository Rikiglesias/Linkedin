import { createHmac } from 'crypto';
import { config } from '../config';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logInfo, logWarn } from '../telemetry/logger';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import {
    countPendingOutboxEvents,
    getPendingOutboxEvents,
    markOutboxDelivered,
    markOutboxPermanentFailure,
    markOutboxRetry,
} from '../core/repositories';

function retryDelayMs(attempt: number): number {
    const base = Math.max(1000, config.webhookSyncTimeoutMs);
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
}

export async function getWebhookSyncStatus(): Promise<WebhookSyncStatus> {
    const pendingOutbox = await countPendingOutboxEvents();
    const configured = !!config.webhookSyncUrl;
    return {
        enabled: config.webhookSyncEnabled,
        configured,
        pendingOutbox,
        endpointHost: configured ? endpointHost(config.webhookSyncUrl) : null,
    };
}

export async function runWebhookSyncOnce(): Promise<void> {
    if (!config.webhookSyncEnabled || !config.webhookSyncUrl) {
        return;
    }

    const events = await getPendingOutboxEvents(config.webhookSyncBatchSize);
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
            idempotencyKey: event.idempotency_key,
            createdAt: event.created_at,
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
            const response = await fetchWithRetryPolicy(config.webhookSyncUrl, {
                method: 'POST',
                headers,
                body,
            }, {
                integration: 'webhook.outbox_sync',
                circuitKey: 'webhook.sync',
                timeoutMs: config.webhookSyncTimeoutMs,
                maxAttempts: 2,
            });

            if (!response.ok) {
                failed += 1;
                const responseText = (await response.text().catch(() => '')).slice(0, 500);
                const errorMessage = `HTTP_${response.status}:${response.statusText}${responseText ? `:${responseText}` : ''}`;
                const attempts = event.attempts + 1;
                if (attempts >= config.webhookSyncMaxRetries) {
                    permanentFailures += 1;
                    await markOutboxPermanentFailure(event.id, attempts, errorMessage);
                    await logWarn('webhook.sync.event.permanent_failure', {
                        eventId: event.id,
                        idempotencyKey: event.idempotency_key,
                        attempts,
                        maxRetries: config.webhookSyncMaxRetries,
                        error: errorMessage,
                    });
                } else {
                    const delay = retryDelayMs(attempts);
                    await markOutboxRetry(event.id, attempts, delay, errorMessage);
                }
                continue;
            }

            sent += 1;
            await markOutboxDelivered(event.id);
        } catch (error) {
            failed += 1;
            const attempts = event.attempts + 1;
            const message = error instanceof Error ? error.message : String(error);
            if (attempts >= config.webhookSyncMaxRetries) {
                permanentFailures += 1;
                await markOutboxPermanentFailure(event.id, attempts, message);
                await logWarn('webhook.sync.event.permanent_failure', {
                    eventId: event.id,
                    idempotencyKey: event.idempotency_key,
                    attempts,
                    maxRetries: config.webhookSyncMaxRetries,
                    error: message,
                });
            } else {
                const delay = retryDelayMs(attempts);
                await markOutboxRetry(event.id, attempts, delay, message);
            }
        }
    }

    await logInfo('webhook.sync.batch', {
        sent,
        failed,
        permanentFailures,
        batchSize: events.length,
        maxRetries: config.webhookSyncMaxRetries,
        endpointHost: endpointHost(config.webhookSyncUrl),
    });

    const pending = await countPendingOutboxEvents();
    if (pending > config.outboxAlertBacklog) {
        await logWarn('webhook.sync.backlog_high', { pending, threshold: config.outboxAlertBacklog });
        await sendTelegramAlert(`${pending} eventi pendenti non inviati al Webhook.`, 'Outbox Backlog Alto', 'warn');
    }
}
