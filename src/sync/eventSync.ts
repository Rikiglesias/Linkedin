import { config, EventSyncSink } from '../config';
import { SyncStatus, getSyncStatus as getSupabaseSyncStatus, runSupabaseSyncOnce } from './supabaseSyncWorker';
import { WebhookSyncStatus, getWebhookSyncStatus, runWebhookSyncOnce } from './webhookSyncWorker';
import { countPendingOutboxEvents, getPendingOutboxDeliveriesBySink } from '../core/repositories';

export interface EventSyncStatus {
    activeSink: EventSyncSink;
    enabled: boolean;
    configured: boolean;
    pendingOutbox: number;
    pendingBySink: {
        SUPABASE: number;
        WEBHOOK: number;
    };
    warning: string | null;
    supabase: SyncStatus;
    webhook: WebhookSyncStatus;
}

function buildSinkWarning(supabase: SyncStatus, webhook: WebhookSyncStatus): string | null {
    if (config.eventSyncSink === 'SUPABASE' && !config.supabaseSyncEnabled) {
        return 'EVENT_SYNC_SINK=SUPABASE ma SUPABASE_SYNC_ENABLED=false.';
    }
    if (config.eventSyncSink === 'WEBHOOK' && !config.webhookSyncEnabled) {
        return 'EVENT_SYNC_SINK=WEBHOOK ma WEBHOOK_SYNC_ENABLED=false.';
    }
    if (config.eventSyncSink === 'BOTH') {
        if (!config.supabaseSyncEnabled && !config.webhookSyncEnabled) {
            return 'EVENT_SYNC_SINK=BOTH ma entrambi i sink sono disabilitati.';
        }
        if (!config.supabaseSyncEnabled) {
            return 'EVENT_SYNC_SINK=BOTH ma SUPABASE_SYNC_ENABLED=false.';
        }
        if (!config.webhookSyncEnabled) {
            return 'EVENT_SYNC_SINK=BOTH ma WEBHOOK_SYNC_ENABLED=false.';
        }
    }
    if (config.eventSyncSink === 'SUPABASE' && config.supabaseSyncEnabled && !supabase.configured) {
        return 'SUPABASE_SYNC_ENABLED=true ma SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY non configurati.';
    }
    if (config.eventSyncSink === 'WEBHOOK' && config.webhookSyncEnabled && !webhook.configured) {
        return 'WEBHOOK_SYNC_ENABLED=true ma WEBHOOK_SYNC_URL non configurato.';
    }
    if (config.eventSyncSink === 'BOTH') {
        if (config.supabaseSyncEnabled && !supabase.configured) {
            return 'EVENT_SYNC_SINK=BOTH ma Supabase non è configurato.';
        }
        if (config.webhookSyncEnabled && !webhook.configured) {
            return 'EVENT_SYNC_SINK=BOTH ma Webhook non è configurato.';
        }
    }
    return null;
}

export async function getEventSyncStatus(): Promise<EventSyncStatus> {
    const [supabase, webhook, pendingOutbox, pendingBySink] = await Promise.all([
        getSupabaseSyncStatus(),
        getWebhookSyncStatus(),
        countPendingOutboxEvents(),
        getPendingOutboxDeliveriesBySink(),
    ]);
    const warning = buildSinkWarning(supabase, webhook);

    if (config.eventSyncSink === 'NONE') {
        return {
            activeSink: 'NONE',
            enabled: false,
            configured: true,
            pendingOutbox,
            pendingBySink,
            warning,
            supabase,
            webhook,
        };
    }

    const active =
        config.eventSyncSink === 'WEBHOOK'
            ? webhook
            : config.eventSyncSink === 'SUPABASE'
              ? supabase
              : {
                    enabled: supabase.enabled || webhook.enabled,
                    configured: supabase.configured && webhook.configured,
                    pendingOutbox,
                };
    return {
        activeSink: config.eventSyncSink,
        enabled: active.enabled,
        configured: active.configured,
        pendingOutbox,
        pendingBySink,
        warning,
        supabase,
        webhook,
    };
}

export async function runEventSyncOnce(): Promise<void> {
    if (config.eventSyncSink === 'NONE') {
        return;
    }

    if (config.eventSyncSink === 'WEBHOOK') {
        await runWebhookSyncOnce();
        return;
    }

    if (config.eventSyncSink === 'BOTH') {
        await Promise.allSettled([runSupabaseSyncOnce(), runWebhookSyncOnce()]);
        return;
    }

    await runSupabaseSyncOnce();
}
