/**
 * utils/random.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per generazione numeri random e selezione
 * casuale da array. Consolidamento di funzioni duplicate
 * da humanBehavior.ts, organicContent.ts, jobRunner.ts, stealth.ts,
 * postContentGenerator.ts, scheduler.ts, fingerprint/pool.ts,
 * abBandit.ts, randomActivityWorker.ts.
 */

/**
 * Ritorna un intero casuale tra min e max (inclusi).
 * Gestisce correttamente min > max invertendo i valori.
 */
export function randomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * Seleziona un elemento casuale da un array readonly.
 * L'array DEVE avere almeno un elemento — il chiamante è responsabile.
 */
export function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}
