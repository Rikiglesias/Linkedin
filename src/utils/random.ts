/**
 * utils/random.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per generazione numeri random e selezione
 * casuale da array. Consolidamento di funzioni duplicate
 * da humanBehavior.ts, organicContent.ts, jobRunner.ts, stealth.ts,
 * postContentGenerator.ts, scheduler.ts, fingerprint/pool.ts,
 * abBandit.ts, randomActivityWorker.ts.
 */

import { randomInt as cryptoRandomInt } from 'crypto';

/**
 * Ritorna un intero casuale tra min e max (inclusi).
 * Gestisce correttamente min > max invertendo i valori.
 * Usa crypto.randomInt per distribuzione uniforme non predicibile.
 */
export function randomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    if (low === high) return low;
    return cryptoRandomInt(low, high + 1);
}

/**
 * Seleziona un elemento casuale da un array readonly.
 * L'array DEVE avere almeno un elemento — il chiamante è responsabile.
 */
export function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[cryptoRandomInt(0, arr.length)] as T;
}
