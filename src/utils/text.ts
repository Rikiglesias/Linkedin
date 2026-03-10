/**
 * utils/text.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per manipolazione testo.
 * Consolidamento di funzioni duplicate da salesNavigatorSync.ts,
 * personDataFinder.ts, bulkSaveOrchestrator.ts, listActions.ts, listScraper.ts.
 */

/**
 * Normalizza whitespace: collassa spazi multipli in uno e trimma.
 */
export function cleanText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Splitta una stringa CSV in array di stringhe trimmate e non vuote.
 * Accetta direttamente il valore (non il nome della variabile env).
 */
export function splitCsv(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
