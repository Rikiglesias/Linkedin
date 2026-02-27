import { createHash } from 'crypto';
import { config } from '../config';
import {
    applyControlPlaneCampaignConfigs,
    ControlPlaneCampaignConfigInput,
    getRuntimeFlag,
    setRuntimeFlag,
    applyCloudAccountUpdates,
    applyCloudLeadUpdates
} from '../core/repositories';
import { logInfo, logWarn } from '../telemetry/logger';
import {
    fetchCloudCampaignConfigs,
    fetchCloudAccountsUpdates,
    fetchCloudLeadsUpdates
} from './supabaseDataClient';

const CONTROL_PLANE_LAST_RUN_KEY = 'control_plane.campaigns.last_run_at';
const CONTROL_PLANE_LAST_HASH_KEY = 'control_plane.campaigns.last_hash';
const CONTROL_PLANE_ACCOUNTS_LAST_SYNC_KEY = 'control_plane.accounts.last_sync_at';
const CONTROL_PLANE_LEADS_LAST_SYNC_KEY = 'control_plane.leads.last_sync_at';

function isControlPlaneConfigured(): boolean {
    return !!(config.supabaseSyncEnabled && config.supabaseUrl && config.supabaseServiceRoleKey);
}

function normalizeControlPlaneCampaigns(
    campaigns: Array<{
        name: string;
        is_active: boolean;
        priority: number;
        daily_invite_cap: number | null;
        daily_message_cap: number | null;
    }>
): ControlPlaneCampaignConfigInput[] {
    const byName = new Map<string, ControlPlaneCampaignConfigInput>();
    for (const campaign of campaigns) {
        const name = campaign.name.trim();
        if (!name) continue;
        byName.set(name, {
            name,
            isActive: campaign.is_active,
            priority: Math.max(1, Math.floor(campaign.priority)),
            dailyInviteCap: campaign.daily_invite_cap === null ? null : Math.max(0, Math.floor(campaign.daily_invite_cap)),
            dailyMessageCap: campaign.daily_message_cap === null ? null : Math.max(0, Math.floor(campaign.daily_message_cap)),
        });
    }
    return Array.from(byName.values())
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function computeControlPlaneHash(configs: ControlPlaneCampaignConfigInput[]): string {
    const payload = JSON.stringify(configs);
    return createHash('sha256').update(payload).digest('hex');
}

export interface ControlPlaneStatus {
    enabled: boolean;
    configured: boolean;
    intervalMs: number;
    maxCampaigns: number;
    lastRunAt: string | null;
}

export interface ControlPlaneSyncReport {
    enabled: boolean;
    configured: boolean;
    executed: boolean;
    reason: string;
    lastRunAt: string | null;
    hashChanged: boolean;
    fetched: number;
    applied: number;
    created: number;
    updated: number;
    unchanged: number;
    skippedInvalid: number;
}

export async function getControlPlaneStatus(): Promise<ControlPlaneStatus> {
    const lastRunAt = await getRuntimeFlag(CONTROL_PLANE_LAST_RUN_KEY);
    return {
        enabled: config.supabaseControlPlaneEnabled,
        configured: isControlPlaneConfigured(),
        intervalMs: config.supabaseControlPlaneSyncIntervalMs,
        maxCampaigns: config.supabaseControlPlaneMaxCampaigns,
        lastRunAt,
    };
}

async function syncAccountsDown() {
    const lastSyncAt = await getRuntimeFlag(CONTROL_PLANE_ACCOUNTS_LAST_SYNC_KEY);
    const updates = await fetchCloudAccountsUpdates(lastSyncAt, 100);
    if (updates.length > 0) {
        await applyCloudAccountUpdates(updates);
        // Calcola il max updated_at
        let maxUpdatedAt = lastSyncAt || new Date(0).toISOString();
        for (const u of updates) {
            if (u.updated_at && u.updated_at > maxUpdatedAt) {
                maxUpdatedAt = u.updated_at;
            }
        }
        await setRuntimeFlag(CONTROL_PLANE_ACCOUNTS_LAST_SYNC_KEY, maxUpdatedAt);
        await logInfo('control_plane.accounts.downsync', { count: updates.length });
    }
}

async function syncLeadsDown() {
    const lastSyncAt = await getRuntimeFlag(CONTROL_PLANE_LEADS_LAST_SYNC_KEY);
    const updates = await fetchCloudLeadsUpdates(lastSyncAt, 500);
    if (updates.length > 0) {
        await applyCloudLeadUpdates(updates);
        // Calcola il max updated_at
        let maxUpdatedAt = lastSyncAt || new Date(0).toISOString();
        for (const u of updates) {
            if (u.updated_at && u.updated_at > maxUpdatedAt) {
                maxUpdatedAt = u.updated_at;
            }
        }
        await setRuntimeFlag(CONTROL_PLANE_LEADS_LAST_SYNC_KEY, maxUpdatedAt);
        await logInfo('control_plane.leads.downsync', { count: updates.length });
    }
}

export async function runControlPlaneSync(options: { force?: boolean } = {}): Promise<ControlPlaneSyncReport> {
    const enabled = config.supabaseControlPlaneEnabled;
    const configured = isControlPlaneConfigured();
    const force = options.force === true;
    const nowIso = new Date().toISOString();
    const lastRunAt = await getRuntimeFlag(CONTROL_PLANE_LAST_RUN_KEY);

    const baseReport: ControlPlaneSyncReport = {
        enabled,
        configured,
        executed: false,
        reason: 'noop',
        lastRunAt,
        hashChanged: false,
        fetched: 0,
        applied: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedInvalid: 0,
    };

    if (!enabled) {
        return { ...baseReport, reason: 'control_plane_disabled' };
    }
    if (!configured) {
        return { ...baseReport, reason: 'supabase_not_configured' };
    }

    if (!force && lastRunAt) {
        const elapsedMs = Date.now() - Date.parse(lastRunAt);
        if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < config.supabaseControlPlaneSyncIntervalMs) {
            return { ...baseReport, reason: 'interval_not_elapsed' };
        }
    }

    try {
        const remoteCampaigns = await fetchCloudCampaignConfigs(config.supabaseControlPlaneMaxCampaigns);
        const normalized = normalizeControlPlaneCampaigns(remoteCampaigns);
        const nextHash = computeControlPlaneHash(normalized);
        const prevHash = await getRuntimeFlag(CONTROL_PLANE_LAST_HASH_KEY);
        const hashChanged = nextHash !== prevHash;

        let applyResult = {
            fetched: normalized.length,
            applied: 0,
            created: 0,
            updated: 0,
            unchanged: normalized.length,
            skippedInvalid: 0,
        };
        let reason = 'hash_unchanged';

        if (force || hashChanged) {
            applyResult = await applyControlPlaneCampaignConfigs(normalized);
            reason = force ? 'forced_sync' : 'synced';
        }

        // Downsync entità addizionali
        await syncAccountsDown();
        await syncLeadsDown();

        await setRuntimeFlag(CONTROL_PLANE_LAST_RUN_KEY, nowIso);
        await setRuntimeFlag(CONTROL_PLANE_LAST_HASH_KEY, nextHash);

        await logInfo('control_plane.campaigns.sync', {
            reason,
            force,
            hashChanged,
            ...applyResult,
            intervalMs: config.supabaseControlPlaneSyncIntervalMs,
            maxCampaigns: config.supabaseControlPlaneMaxCampaigns,
        });

        return {
            ...baseReport,
            executed: true,
            reason,
            lastRunAt: nowIso,
            hashChanged,
            ...applyResult,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await logWarn('control_plane.campaigns.sync.error', { error: message });
        return {
            ...baseReport,
            reason: 'sync_error',
        };
    }
}
