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

/**
 * Normalizza un nome per confronto: lowercase, rimuove accenti, collassa spazi.
 * "María Elena López" → "maria elena lopez"
 */
export function normalizeNameForComparison(name: string | null | undefined): string {
    if (!name) return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ') // non-alfanumerici → spazio
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Similarità Jaro-Winkler tra due stringhe (0.0 = diversi, 1.0 = identici).
 * Usata per identity check: confronto nome lead vs h1 pagina LinkedIn.
 * Jaro-Winkler dà bonus al prefisso comune (tipico dei nomi: "Mario" vs "Mário").
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, s2.length);
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

    // Winkler bonus: prefisso comune (max 4 chars)
    let prefix = 0;
    for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
}
