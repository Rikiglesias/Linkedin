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
 * 🔴 LIMITE, e va letto prima di fidarsi di un `ok` (trovato dal critico avversariale, F-3c9a1f42):
 * questo modulo risponde a UNA domanda — «il nome del modello esiste sull'endpoint di
 * `openaiBaseUrl`?» — e NON a «il percorso AI funziona». `providerRegistry.resolveAiProvider`
 * può risolvere ALTROVE a seconda del purpose: i 7 purpose PII-sensitive cadono su `template`
 * (che LANCIA, `aiTextClient.ts:83`) quando non esiste un endpoint locale, e con
 * `AI_PROVIDER=anthropic` la chat usa `resolveAnthropicModelForPurpose` su api.anthropic.com.
 * In quei casi un `ok` qui è VERO sulla sua domanda e FUORVIANTE sulla salute dell'AI.
 * ⇒ Correzione pianificata (prima voce del prossimo blocco in `~/todos/audit-codebase.md`):
 * derivare endpoint e modello da `resolveAiProvider(purpose)` invece che da `config`, e
 * distinguere «modello assente» da «nessun provider per questo purpose».
 */

import { config, isGreenModeWindow } from '../config';
import { isLocalAiEndpoint, isLoopbackAiHost } from '../config/env';
import { resolveAiModel } from './openaiClient';

/** Allineato al probe di `ollamaLifecycle`: un preflight non deve far aspettare il run. */
const TIMEOUT_ELENCO_MS = 2_000;

/**
 * `bloccato_da_policy` è uno stato a sé e NON `non_applicabile`: quest'ultimo significa «non c'è
 * niente da controllare», mentre lì il 100% delle chiamate AI fallisce (`requestOpenAIText` lancia).
 * Confonderli rendeva il preflight MUTO proprio sul guasto più azionabile — regressione introdotta
 * dalla correzione di sicurezza e trovata dal critico avversariale (F-b7e2d941).
 */
export type StatoModelloAi = 'ok' | 'mancante' | 'sconosciuto' | 'bloccato_da_policy' | 'non_applicabile';

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
        // Ma la chiave esce SOLO verso loopback stretto o verso un remoto esplicitamente consentito:
        // `.local` è mDNS, cioè un host qualsiasi della LAN, e non merita le credenziali (F-0d84be2f).
        const puoRicevereLaChiave = config.aiAllowRemoteEndpoint || isLoopbackAiHost(baseUrl);
        if (config.openaiApiKey && puoRicevereLaChiave) headers.authorization = `Bearer ${config.openaiApiKey}`;
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

    // Stessa policy di `requestOpenAIText` (`openaiClient.ts:67-73`): con endpoint remoto e
    // `AI_ALLOW_REMOTE_ENDPOINT=false` il client NON chiama e NON manda la chiave. Un preflight che
    // lo facesse comunque manderebbe `Authorization: Bearer` dove la policy lo vieta, a ogni ciclo
    // del loop, e riferirebbe su un endpoint che nessuno userà. (Trovato dal critico, F-9f0c72ae.)
    if (!config.aiAllowRemoteEndpoint && !isLocalAiEndpoint(baseUrl)) {
        // NON `non_applicabile`: qui ogni chiamata AI fallisce, e tacere sarebbe il difetto opposto.
        return {
            stato: 'bloccato_da_policy',
            modello: resolveAiModel().trim() || null,
            disponibili: [],
            motivo: 'endpoint_remoto_bloccato_da_policy',
        };
    }

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

/** La variabile che l'utente deve davvero correggere: in green mode NON è `AI_MODEL`. */
function variabileDelModello(): string {
    return isGreenModeWindow() && config.aiGreenModel.trim().length > 0 ? 'AI_GREEN_MODEL' : 'AI_MODEL';
}

/** Riga leggibile per report e alert: dice cosa fare, non solo cosa è rotto (L5-LI.1). */
export function descriviEsitoModelloAi(esito: EsitoModelloAi): string {
    // Il catalogo di un provider cloud è ~80 voci: stamparlo intero a ogni ciclo del loop è rumore.
    const MAX_ELENCO = 10;
    const elenco =
        esito.disponibili.length === 0
            ? '(nessuno)'
            : esito.disponibili.slice(0, MAX_ELENCO).join(', ') +
              (esito.disponibili.length > MAX_ELENCO ? ` (+${esito.disponibili.length - MAX_ELENCO} altri)` : '');
    switch (esito.stato) {
        case 'ok':
            // Claim STRETTO di proposito: dice che il nome esiste su QUELL'endpoint, non che il
            // percorso AI funzioni (il registry può risolvere altrove — limite dichiarato in testa).
            return `modello AI '${esito.modello}' presente sull'endpoint configurato`;
        case 'mancante':
            return `modello AI '${esito.modello}' NON esiste sul provider — ogni decisione AI cade nel fallback. Disponibili: ${elenco}. Correggere ${variabileDelModello()} o scaricare il modello.`;
        case 'bloccato_da_policy':
            return "endpoint AI remoto vietato da AI_ALLOW_REMOTE_ENDPOINT=false: OGNI chiamata AI fallisce. Puntare OPENAI_BASE_URL su un endpoint locale, oppure mettere AI_ALLOW_REMOTE_ENDPOINT=true se il remoto e' voluto.";
        case 'sconosciuto':
            return `provider AI non interrogabile: impossibile dire se '${esito.modello}' esiste (non è una prova che sia sbagliato)`;
        default:
            return `verifica modello AI non applicabile (${esito.motivo})`;
    }
}
