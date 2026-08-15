import { createHash } from 'crypto';
import { config } from '../config';
import {
    applyControlPlaneCampaignConfigs,
    ControlPlaneCampaignConfigInput,
    getRuntimeFlag,
    setRuntimeFlag,
    applyCloudLeadUpdates,
} from '../core/repositories';
import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';
import {
    fetchCloudCampaignConfigs,
    fetchCloudLeadsUpdates,
    syncSalesNavMembersToCloud,
} from './supabaseDataClient';

/**
 * Un ramo del control-plane sync: il nome e l'esecutore viaggiano nello STESSO oggetto.
 *
 * Perché non due array paralleli (com'era prima): `Promise.allSettled` restituisce solo la
 * posizione, quindi i nomi stavano in un array separato tenuto allineato alle promise da una
 * convenzione scritta in un commento. Rimuovere un ramo rinominava tutti gli altri esattamente come
 * aggiungerne uno — e il passo successivo di questa fase rimuove proprio un ramo.
 */
export type RamoSync = { nome: string; esegui: () => Promise<void> };

/**
 * Estrae i rami rigettati da un `Promise.allSettled`, con il loro nome e un messaggio sempre
 * valorizzato.
 *
 * Perché esiste: `Promise.allSettled` **non rigetta mai**, quindi un `await` sul suo risultato senza
 * ispezionarlo scarta ogni fallimento in silenzio — ed è ciò che accadeva qui, dove `syncLeadsDown`
 * non ha nemmeno un try/catch proprio.
 *
 * Puro di proposito: `runControlPlaneSync` richiederebbe di mockare config + supabase + db + runtime
 * flags per essere esercitato, quindi la REGOLA si prova qui e il wiring si legge sopra.
 */
export function ramiFallitiDaEsiti(
    nomi: string[],
    esiti: PromiseSettledResult<unknown>[],
): Array<{ ramo: string; errore: string }> {
    const falliti: Array<{ ramo: string; errore: string }> = [];
    for (let i = 0; i < esiti.length; i++) {
        const esito = esiti[i];
        if (esito.status !== 'rejected') continue;
        // Un ramo senza nome resta visibile con la sua posizione: se domani se ne aggiunge uno alle
        // promise e si dimentica il nome, il fallimento non deve tornare invisibile.
        const ramo = nomi[i] ?? `ramo_${i}`;
        const reason: unknown = esito.reason;
        const errore =
            reason instanceof Error
                ? reason.message
                : typeof reason === 'string' && reason.length > 0
                  ? reason
                  : `errore non descritto (${String(reason)})`;
        falliti.push({ ramo, errore });
    }
    return falliti;
}

const CONTROL_PLANE_LAST_RUN_KEY = 'control_plane.campaigns.last_run_at';
const CONTROL_PLANE_LAST_HASH_KEY = 'control_plane.campaigns.last_hash';
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
    }>,
): ControlPlaneCampaignConfigInput[] {
    const byName = new Map<string, ControlPlaneCampaignConfigInput>();
    for (const campaign of campaigns) {
        const name = campaign.name.trim();
        if (!name) continue;
        byName.set(name, {
            name,
            isActive: campaign.is_active,
            priority: Math.max(1, Math.floor(campaign.priority)),
            dailyInviteCap:
                campaign.daily_invite_cap === null ? null : Math.max(0, Math.floor(campaign.daily_invite_cap)),
            dailyMessageCap:
                campaign.daily_message_cap === null ? null : Math.max(0, Math.floor(campaign.daily_message_cap)),
        });
    }
    return Array.from(byName.values()).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function computeControlPlaneHash(configs: ControlPlaneCampaignConfigInput[]): string {
    const payload = JSON.stringify(configs);
    return createHash('sha256').update(payload).digest('hex');
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

async function syncSalesNavUp() {
    try {
        const db = await getDatabase();
        const { synced, failed } = await syncSalesNavMembersToCloud(db);
        if (synced > 0) {
            await logInfo('control_plane.salesnav.upsync', { count: synced });
        }
        if (failed > 0) {
            // Rifiutati dal cloud ≠ replica disattivata: prima uscivano entrambi da qui in silenzio,
            // perché si logga solo quando synced > 0. Nessun retry (non esiste un topic outbox per i
            // salesnav_list_members): il log È il rimedio, e va letto come perdita reale di dati.
            await logWarn('control_plane.salesnav.upsync.rejected', { count: failed });
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await logWarn('control_plane.salesnav.upsync.error', { error: message });
    }
}

/**
 * Registro UNICO dei rami lanciati insieme dal control-plane sync: è la sola fonte sia dei nomi sia
 * delle promise. Aggiungere o togliere un ramo qui non può più disallineare le etichette.
 *
 * ⚠️ NON reintrodurre un ramo `accounts_down`. Il downsync degli account è stato rimosso (F-CB.10,
 * D2 = Strada B+) perché dava a una tabella cloud senza comandante l'autorità di **rilasciare** la
 * quarantena: con un solo account configurato l'id degrada al sintetico `'default'`, e
 * `setAccountQuarantine('default', false)` scrive il flag GLOBALE che sblocca OGNI account. La
 * sentinella `src/tests/downsyncAccountRimosso.vitest.ts` fallisce se il ramo torna per inerzia.
 *
 * Il canale corretto per un comando remoto, quando servirà, è la tabella cloud `telegram_commands`
 * (per-account, one-shot, consumato ⇒ non può oscillare), con tre precondizioni da scrivere NEL
 * codice prima di usarla:
 *   1. **monotono-restrittivo**: il remoto può solo IMPORRE uno stop, mai rilasciarlo;
 *   2. **allow-list** esplicita degli id ammessi;
 *   3. **`'default'` rifiutato per costruzione** (e ogni id che vi normalizza: vuoto, whitespace),
 *      perché in locale è la wildcard «tutti gli account», non un identificatore.
 */
export const RAMI_SYNC: readonly RamoSync[] = [
    { nome: 'leads_down', esegui: syncLeadsDown },
    { nome: 'salesnav_up', esegui: syncSalesNavUp },
];

/**
 * Esegue i rami in parallelo e restituisce SOLO quelli rigettati, col nome preso dallo stesso
 * oggetto che ha fornito l'esecutore. Estratto per essere esercitabile con un registro finto:
 * `runControlPlaneSync` richiederebbe di mockare config + supabase + db + runtime flags.
 */
export async function eseguiRami(rami: readonly RamoSync[]): Promise<Array<{ ramo: string; errore: string }>> {
    const esiti = await Promise.allSettled(rami.map((ramo) => ramo.esegui()));
    return ramiFallitiDaEsiti(
        rami.map((ramo) => ramo.nome),
        esiti,
    );
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

        for (const fallito of await eseguiRami(RAMI_SYNC)) {
            // `allSettled` non rigetta MAI: senza questa ispezione un ramo morto era invisibile.
            // Nessun retry: `syncSalesNavUp` ha già il suo catch, gli altri due rigirano al ciclo
            // successivo del control plane. Il log È il rimedio, come per salesnav in F-CB.8.
            await logWarn('control_plane.branch.rejected', { branch: fallito.ramo, error: fallito.errore });
        }

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
