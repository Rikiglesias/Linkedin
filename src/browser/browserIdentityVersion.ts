/**
 * browserIdentityVersion.ts — aritmetica di versione fra UA, binario e fingerprint (C22/C23 del contratto
 * `bot-operativo`). Estratto da `browserIdentity.ts` (la regola dell'identità persistita) per SRP e soglia di
 * dimensione: qui SOLO funzioni pure su stringhe/oggetti, nessun filesystem, nessuna config.
 */

/** Major della famiglia che conta per l'engine: `Firefox/NNN` su Gecko, `Chrome/NNN` su Blink (Edge inclusa). */
export function uaMajor(userAgent: string): number | null {
    const match = userAgent.match(/Firefox\/(\d+)/) ?? userAgent.match(/Chrome\/(\d+)/);
    return match ? Number(match[1]) : null;
}

export function engineBuildMajor(engineBuild: string): number | null {
    const match = engineBuild.match(/^(\d+)/);
    return match ? Number(match[1]) : null;
}

/**
 * La STESSA riscrittura che camoufox-js applica al fingerprint al lancio (`fingerprints.js:_castToProperties`):
 * ogni `1NN.0` nelle stringhe diventa `<major>.0`. Applicarla alla creazione rende il file uguale alla pagina.
 */
export function rewriteVersionStrings<T>(value: T, major: number): T {
    if (typeof value === 'string') {
        return value.replaceAll(/(?<!\d)(1[0-9]{2})(\.0)(?!\d)/gi, `${major}$2`) as T;
    }
    if (Array.isArray(value)) return value.map((item: unknown) => rewriteVersionStrings(item, major)) as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = rewriteVersionStrings(item, major);
        return out as T;
    }
    return value;
}
