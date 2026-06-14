/**
 * salesnav/salesNavSaveDailyCap.ts
 * SSOT del contatore giornaliero di lead salvati via SalesNav bulk-save
 * (`salesnav_saves_count:${localDate}`), per applicare un cap anti-ban sul VOLUME
 * giornaliero di save CROSS-sessione — oltre al `sessionLimit` per-sessione esistente
 * (bulkSaveHelpers) e all'hard-limit 2500/lista. Senza questo, più run sync-search
 * nello stesso giorno superano il budget giornaliero di azioni SalesNav.
 *
 * Pattern replicato da integrations/enrichmentDailyCap.ts (runtime flag, best-effort):
 * un errore qui non deve mai far fallire un save già persistito. Il cap è OPT-IN:
 * config.salesNavSyncMaxSavesPerDay = 0 → disabilitato (default), > 0 → soglia attiva.
 */

import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { config, getLocalDateString } from '../config';
import { logWarn } from '../telemetry/logger';

function capKeyFor(localDate?: string): string {
    return `salesnav_saves_count:${localDate ?? getLocalDateString()}`;
}

/** Lead salvati oggi via SalesNav bulk-save (0 se il flag non esiste). */
export async function getSalesNavSaveDailyCount(localDate?: string): Promise<number> {
    const raw = await getRuntimeFlag(capKeyFor(localDate)).catch(() => null);
    return parseInt(raw ?? '0', 10) || 0;
}

/**
 * Incrementa di `amount` il contatore giornaliero dei lead salvati. Best-effort (no throw):
 * coerente con enrichmentDailyCap, conta solo i save effettivamente persistiti.
 */
export async function incrementSalesNavSaveDailyCount(amount: number, localDate?: string): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
        const key = capKeyFor(localDate);
        const prior = parseInt((await getRuntimeFlag(key)) ?? '0', 10) || 0;
        await setRuntimeFlag(key, String(prior + Math.floor(amount)));
    } catch (capError) {
        await logWarn('salesnav_save.cap_increment_failed', {
            error: capError instanceof Error ? capError.message : String(capError),
        });
    }
}

/**
 * true se il cap giornaliero è ATTIVO (config.salesNavSyncMaxSavesPerDay > 0) ed è stato
 * raggiunto/superato. Con cap 0/assente → sempre false (disabilitato).
 */
export async function isSalesNavSaveDailyCapReached(localDate?: string): Promise<boolean> {
    const cap = config.salesNavSyncMaxSavesPerDay;
    if (!cap || cap <= 0) return false;
    const current = await getSalesNavSaveDailyCount(localDate);
    return current >= cap;
}
