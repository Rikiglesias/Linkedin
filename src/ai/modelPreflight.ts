/**
 * ai/modelPreflight.ts
 * Verifica che il modello AI configurato ESISTA davvero sul provider configurato.
 *
 * Perché esiste (difetto misurato il 2026-08-05, non dedotto): il sistema sceglie il modello
 * per NOME (`config.aiModel`, o `aiGreenModel` in green mode) e non ha mai verificato che quel
 * nome corrisponda a qualcosa. Sulla macchina reale il default `llama3.1:8b` NON è installato
 * (ci sono `qwen2.5-coder:7b`, `qwen3:8b`, `qwen3-vl:8b`, `llava:latest`): ogni chiamata AI
 * fallisce, e il fallimento si manifesta solo come fallback PER-LEAD — `DEFER` quando la
 * decisione è strict, `PROCEED` altrimenti — con un `logWarn` per chiamata. Nessun preflight lo
 * dice: `runDoctor` non guardava affatto l'AI, e `ollamaLifecycle` interroga l'elenco dei modelli
 * (`/api/tags`) ma ne butta via il contenuto (`return res.ok`).
 *
 * Contratto:
 * - **TRE stati, non un booleano** — `ok` / `mancante` / `sconosciuto` (+ `non_applicabile`).
 *   Un provider irraggiungibile è «non so», MAI «il modello è sbagliato»: è la stessa primitiva
 *   già adottata per il canary dei selettori, dove trattare l'incertezza come colpa produceva
 *   quarantene spurie.
 * - **Non lancia mai e non blocca nulla**: un modello mancante degrada a template (lo fa già il
 *   registry). Abortire il run per questo sarebbe il difetto opposto — fail-closed cieco.
 * - Interroga `GET {openaiBaseUrl}/models`, cioè la **stessa base URL** che usa la chiamata di
 *   chat: un preflight su un endpoint dedotto potrebbe essere verde su un server diverso da
 *   quello poi usato. Forma della risposta (`{data:[{id}]}`) misurata dal vivo su Ollama 0.24.
 *
 * Confine dichiarato: qui si risponde a UNA domanda — «il modello configurato esiste
 * sull'endpoint configurato?». Il routing (guard zero-PII, fallback H28, green mode) resta di
 * `providerRegistry`; questo modulo non lo replica.
 */

import { config } from '../config';
import { resolveAiModel } from './openaiClient';

/** Allineato al probe di `ollamaLifecycle`: un preflight non deve far aspettare il run. */
const TIMEOUT_ELENCO_MS = 2_000;

export type StatoModelloAi = 'ok' | 'mancante' | 'sconosciuto' | 'non_applicabile';

export interface EsitoModelloAi {
    stato: StatoModelloAi;
    /** Il nome che la chiamata di chat userebbe davvero; `null` se l'AI non è in gioco. */
    modello: string | null;
    /** Modelli offerti dal provider; vuoto quando non lo sappiamo. */
    disponibili: string[];
    motivo: string;
}

/**
 * Ollama tratta il nome senza tag come `:latest` (docs ufficiali + `types/model/name.go`),
 * quindi `qwen3` e `qwen3:latest` sono lo stesso modello: confrontarli alla lettera
 * produrrebbe un «mancante» falso.
 */
function normalizzaNomeModello(nome: string): string {
    const pulito = nome.trim().toLowerCase();
    if (!pulito) return '';
    return pulito.includes(':') ? pulito : `${pulito}:latest`;
}

/** Elenco dei modelli del provider, oppure `null` se non è stato possibile saperlo. */
async function elencaModelli(baseUrl: string): Promise<string[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_ELENCO_MS);
    try {
        const headers: Record<string, string> = {};
        // Endpoint cloud: senza chiave `/models` risponde 401 e diventerebbe un finto «sconosciuto».
        if (config.openaiApiKey) headers.authorization = `Bearer ${config.openaiApiKey}`;
        const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { signal: controller.signal, headers });
        if (!res.ok) return null;
        const body: unknown = await res.json();
        const dati = (body as { data?: unknown })?.data;
        if (!Array.isArray(dati)) return null;
        return dati
            .map((voce) => {
                const id = (voce as { id?: unknown })?.id;
                return typeof id === 'string' ? id : '';
            })
            .filter((id) => id.length > 0);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Preflight del modello AI. Best-effort: non lancia, non blocca, non ha effetti collaterali.
 */
export async function verificaModelloAi(): Promise<EsitoModelloAi> {
    const nonApplicabile = (motivo: string): EsitoModelloAi => ({
        stato: 'non_applicabile',
        modello: null,
        disponibili: [],
        motivo,
    });

    // AI disattivata per scelta: non c'è nessun modello da verificare.
    if (config.aiProvider === 'template') return nonApplicabile('ai_disattivata_template');

    const baseUrl = (config.openaiBaseUrl ?? '').trim();
    if (!baseUrl) return nonApplicabile('endpoint_non_configurato');

    const modello = resolveAiModel().trim();
    if (!modello) return nonApplicabile('modello_non_configurato');

    const disponibili = await elencaModelli(baseUrl);
    if (disponibili === null) {
        return {
            stato: 'sconosciuto',
            modello,
            disponibili: [],
            motivo: 'elenco_modelli_non_ottenibile',
        };
    }

    const atteso = normalizzaNomeModello(modello);
    const presente = disponibili.some((id) => normalizzaNomeModello(id) === atteso);

    return {
        stato: presente ? 'ok' : 'mancante',
        modello,
        disponibili,
        motivo: presente ? 'modello_presente' : 'modello_assente_dal_provider',
    };
}

/** Riga leggibile per report e alert: dice cosa fare, non solo cosa è rotto (L5-LI.1). */
export function descriviEsitoModelloAi(esito: EsitoModelloAi): string {
    switch (esito.stato) {
        case 'ok':
            return `modello AI '${esito.modello}' disponibile`;
        case 'mancante':
            return `modello AI '${esito.modello}' NON esiste sul provider — ogni decisione AI cade nel fallback. Disponibili: ${esito.disponibili.join(', ') || '(nessuno)'}. Correggere AI_MODEL o scaricare il modello.`;
        case 'sconosciuto':
            return `provider AI non interrogabile: impossibile dire se '${esito.modello}' esiste (non è una prova che sia sbagliato)`;
        default:
            return `verifica modello AI non applicabile (${esito.motivo})`;
    }
}
