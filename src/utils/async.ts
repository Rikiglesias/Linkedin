/**
 * utils/async.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per operazioni asincrone: sleep e retry delay.
 * Consolidamento di funzioni duplicate.
 */

/**
 * Pausa asincrona per il numero di millisecondi specificato.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calcola il delay per un retry con exponential backoff + jitter.
 * @param attempt - Numero del tentativo (1-based)
 * @param baseDelayMs - Delay base in millisecondi
 * @param jitterMaxMs - Jitter massimo in millisecondi (default 500)
 */
export function retryDelayMs(attempt: number, baseDelayMs: number, jitterMaxMs: number = 500): number {
    const jitter = Math.floor(Math.random() * jitterMaxMs);
    return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
}
