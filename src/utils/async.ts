/**
 * utils/async.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per operazioni asincrone: sleep, retry delay,
 * safe async execution. Consolidamento di funzioni duplicate.
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

/**
 * Esegue una funzione asincrona catturando eventuali errori.
 * A differenza di `.catch(() => null)`, logga sempre l'errore a console
 * a livello debug/warn così non si perde mai traccia del fallimento.
 *
 * @param fn - Funzione asincrona da eseguire
 * @param fallback - Valore di ritorno in caso di errore (default: undefined)
 * @param label - Etichetta per il log (opzionale, aiuta il debugging)
 */
export async function safeAsync<T>(fn: () => Promise<T>, fallback?: T, label?: string): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const tag = label ? `[safeAsync:${label}]` : '[safeAsync]';
        console.warn(`${tag} ${message}`);
        return fallback;
    }
}
