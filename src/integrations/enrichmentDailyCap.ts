/**
 * integrations/enrichmentDailyCap.ts
 * SSOT del contatore giornaliero di enrichment COMPLETATI (`enrichment_count:${localDate}`),
 * che lo scheduler legge per applicare ENRICHMENT_DAILY_HARD_CAP (M19, anti-ban budget query/die).
 *
 * Esiste perché i due path di enrichment NON condividono un punto di persistenza unico
 * (job schedulato → persistEnrichmentResult; live → INSERT diretti in parallelEnricher):
 * questo helper è il punto unico della LOGICA di incremento, chiamato da entrambi i punti di
 * completamento così il cap copre TUTTE le query consumate verso le API esterne.
 *
 * Conta SOLO i completati: i fallimenti transient NON lo chiamano (sono ri-tentabili e non
 * devono bruciare il cap — coerente con b4b551b). Best-effort: un errore qui non deve mai far
 * fallire un enrichment già persistito.
 */

import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { getLocalDateString } from '../config';
import { logWarn } from '../telemetry/logger';

/**
 * Incrementa di 1 il contatore giornaliero di enrichment completati.
 * @param localDate data del reader (scheduler). I path con context la passano (coerenza esatta della
 *   chiave); i path senza context usano il default `getLocalDateString()` — la stessa funzione che lo
 *   scheduler usa per leggere, quindi la chiave combacia.
 */
export async function incrementEnrichmentDailyCount(localDate?: string): Promise<void> {
    try {
        const capKey = `enrichment_count:${localDate ?? getLocalDateString()}`;
        const priorCount = parseInt((await getRuntimeFlag(capKey)) ?? '0', 10) || 0;
        await setRuntimeFlag(capKey, String(priorCount + 1));
    } catch (capError) {
        await logWarn('enrichment.cap_increment_failed', {
            error: capError instanceof Error ? capError.message : String(capError),
        });
    }
}
