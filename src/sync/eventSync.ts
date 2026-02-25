import { config, EventSyncSink } from '../config';
import { SyncStatus, getSyncStatus as getSupabaseSyncStatus, runSupabaseSyncOnce } from './supabaseSyncWorker';
import { WebhookSyncStatus, getWebhookSyncStatus, runWebhookSyncOnce } from './webhookSyncWorker';

export interface EventSyncStatus {
    activeSink: EventSyncSink;
    enabled: boolean;
    configured: boolean;
    pendingOutbox: number;
    warning: string | null;
    supabase: SyncStatus;
    webhook: WebhookSyncStatus;
}

function buildSinkWarning(supabase: SyncStatus, webhook: WebhookSyncStatus): string | null {
    if (config.supabaseSyncEnabled && config.webhookSyncEnabled) {
        return `Entrambi i sink sono attivi ma verra usato solo EVENT_SYNC_SINK=${config.eventSyncSink}.`;
    }
    if (config.eventSyncSink === 'SUPABASE' && !config.supabaseSyncEnabled) {
        return 'EVENT_SYNC_SINK=SUPABASE ma SUPABASE_SYNC_ENABLED=false.';
    }
    if (config.eventSyncSink === 'WEBHOOK' && !config.webhookSyncEnabled) {
        return 'EVENT_SYNC_SINK=WEBHOOK ma WEBHOOK_SYNC_ENABLED=false.';
    }
    if (config.eventSyncSink === 'SUPABASE' && config.supabaseSyncEnabled && !supabase.configured) {
        return 'SUPABASE_SYNC_ENABLED=true ma SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY non configurati.';
    }
    if (config.eventSyncSink === 'WEBHOOK' && config.webhookSyncEnabled && !webhook.configured) {
        return 'WEBHOOK_SYNC_ENABLED=true ma WEBHOOK_SYNC_URL non configurato.';
    }
    return null;
}

export async function getEventSyncStatus(): Promise<EventSyncStatus> {
    const [supabase, webhook] = await Promise.all([getSupabaseSyncStatus(), getWebhookSyncStatus()]);
    const warning = buildSinkWarning(supabase, webhook);

    if (config.eventSyncSink === 'NONE') {
        return {
            activeSink: 'NONE',
            enabled: false,
            configured: true,
            pendingOutbox: supabase.pendingOutbox,
            warning,
            supabase,
            webhook,
        };
    }

    const active = config.eventSyncSink === 'WEBHOOK' ? webhook : supabase;
    return {
        activeSink: config.eventSyncSink,
        enabled: active.enabled,
        configured: active.configured,
        pendingOutbox: active.pendingOutbox,
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

    await runSupabaseSyncOnce();
}
