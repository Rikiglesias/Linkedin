/**
 * Rosso di controllo per il preflight del modello AI (C3 — «catena sbloccata», voce AI model).
 *
 * Difetto misurato sulla macchina reale il 2026-08-05: `AI_MODEL` di default vale `llama3.1:8b`,
 * ma i modelli installati sono `qwen2.5-coder:7b`, `qwen3:8b`, `qwen3-vl:8b`, `llava:latest`.
 * Ogni chiamata AI fallisce quindi con «model not found», e il sistema lo trasforma in un
 * fallback per-lead (DEFER se strict, PROCEED altrimenti) con un solo `logWarn` per chiamata:
 * nessun preflight lo dichiara, `runDoctor` non guarda affatto l'AI e `ollamaLifecycle` interroga
 * `/api/tags` — cioè proprio l'elenco dei modelli — ma ne butta via il contenuto (`return res.ok`).
 *
 * Contratto verificato qui: l'esito ha TRE stati e «non so» non vale «rotto» (stessa primitiva
 * già ratificata per il canary dei selettori), e il preflight non lancia mai.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `vi.mock` è issato in cima al file: la factory non può leggere variabili di modulo normali
// (ReferenceError). `vi.hoisted` è la primitiva ufficiale per condividere stato con la factory.
const stato = vi.hoisted(() => ({
    config: {
        openaiBaseUrl: 'http://127.0.0.1:11434/v1',
        openaiApiKey: '',
        aiModel: 'llama3.1:8b',
        aiGreenModel: '',
        aiProvider: 'auto' as string,
        aiAllowRemoteEndpoint: false,
    },
    greenMode: false,
}));
const configMock = stato.config;

vi.mock('../config', () => ({ config: stato.config, isGreenModeWindow: () => stato.greenMode }));
vi.mock('../telemetry/logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
// `modelPreflight` importa `resolveAiModel` da openaiClient, che a sua volta tira dentro la
// policy di retry: qui interessa solo la scelta del nome, non la rete del client.
vi.mock('../core/integrationPolicy', () => ({ fetchWithRetryPolicy: vi.fn() }));

import { descriviEsitoModelloAi, verificaModelloAi } from '../ai/modelPreflight';
import { isLocalAiEndpoint, isLoopbackAiHost } from '../ai/openaiClient';

/** Risposta reale di Ollama su `GET /v1/models`, misurata dal vivo (non inventata). */
function rispostaModelli(ids: string[]): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }),
    } as unknown as Response;
}

describe('preflight del modello AI', () => {
    beforeEach(() => {
        configMock.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        configMock.openaiApiKey = '';
        configMock.aiModel = 'llama3.1:8b';
        configMock.aiGreenModel = '';
        configMock.aiProvider = 'auto';
        configMock.aiAllowRemoteEndpoint = false;
        stato.greenMode = false;
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('modello presente nella lista del provider → ok', async () => {
        configMock.aiModel = 'qwen3:8b';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen2.5-coder:7b', 'qwen3:8b', 'llava:latest'])),
        );
        const esito = await verificaModelloAi();
        expect(esito.stato).toBe('ok');
        expect(esito.modello).toBe('qwen3:8b');
    });

    it('IL CASO REALE: modello configurato assente dal provider → mancante, con la lista di ciò che c’è', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen2.5-coder:7b', 'qwen3:8b', 'qwen3-vl:8b', 'llava:latest'])),
        );
        const esito = await verificaModelloAi();
        expect(esito.stato).toBe('mancante');
        expect(esito.modello).toBe('llama3.1:8b');
        // Un preflight che dice solo «manca» costringe a indovinare: deve dire cosa c'è al suo posto.
        expect(esito.disponibili).toContain('qwen3:8b');
    });

    it('nome senza tag: `qwen3` vale `qwen3:latest` (convenzione Ollama), non è un modello mancante', async () => {
        configMock.aiModel = 'qwen3';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen3:latest', 'llava:latest'])),
        );
        expect((await verificaModelloAi()).stato).toBe('ok');
    });

    it('server irraggiungibile → sconosciuto, MAI mancante («non so» non è «rotto»)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('ECONNREFUSED');
            }),
        );
        const esito = await verificaModelloAi();
        expect(esito.stato).toBe('sconosciuto');
        expect(esito.disponibili).toEqual([]);
    });

    it('provider che risponde con errore HTTP → sconosciuto (non si accusa il modello)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response),
        );
        expect((await verificaModelloAi()).stato).toBe('sconosciuto');
    });

    it('corpo della risposta inatteso → sconosciuto, senza lanciare', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ roba: 'inattesa' }) }) as unknown as Response),
        );
        expect((await verificaModelloAi()).stato).toBe('sconosciuto');
    });

    it('AI_PROVIDER=template → non applicabile, e NON viene interrogata alcuna rete', async () => {
        configMock.aiProvider = 'template';
        const fetchSpia = vi.fn();
        vi.stubGlobal('fetch', fetchSpia);
        expect((await verificaModelloAi()).stato).toBe('non_applicabile');
        expect(fetchSpia).not.toHaveBeenCalled();
    });

    it('endpoint non configurato → non applicabile, senza rete', async () => {
        configMock.openaiBaseUrl = '';
        const fetchSpia = vi.fn();
        vi.stubGlobal('fetch', fetchSpia);
        expect((await verificaModelloAi()).stato).toBe('non_applicabile');
        expect(fetchSpia).not.toHaveBeenCalled();
    });

    it('in green mode verifica il modello GREEN, cioè quello che la chat userebbe davvero', async () => {
        stato.greenMode = true;
        configMock.aiGreenModel = 'qwen3:8b';
        configMock.aiModel = 'llama3.1:8b'; // quello normale NON deve essere il verificato
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen3:8b'])),
        );
        const esito = await verificaModelloAi();
        expect(esito.modello).toBe('qwen3:8b');
        expect(esito.stato).toBe('ok');
    });

    it('compone /models sulla base URL configurata (path, non un endpoint inventato altrove)', async () => {
        const fetchSpia = vi.fn(async (_url: string) => rispostaModelli(['llama3.1:8b']));
        vi.stubGlobal('fetch', fetchSpia);
        await verificaModelloAi();
        const urlChiamato = String(fetchSpia.mock.calls[0]?.[0] ?? '');
        expect(urlChiamato).toBe('http://127.0.0.1:11434/v1/models');
    });

    // ── Correzioni dal critico avversariale (fine turno 2026-08-05) ──────────────────────────

    it('SICUREZZA: endpoint remoto con AI_ALLOW_REMOTE_ENDPOINT=false → nessuna fetch, la chiave NON esce', async () => {
        configMock.openaiBaseUrl = 'https://api.openai.com/v1';
        configMock.openaiApiKey = 'chiave-che-non-deve-uscire';
        configMock.aiAllowRemoteEndpoint = false; // default del progetto
        const fetchSpia = vi.fn();
        vi.stubGlobal('fetch', fetchSpia);
        const esito = await verificaModelloAi();
        // NON `non_applicabile`: lì ogni chiamata AI fallisce, tacere sarebbe il difetto opposto.
        expect(esito.stato).toBe('bloccato_da_policy');
        expect(esito.motivo).toBe('endpoint_remoto_bloccato_da_policy');
        // È il punto: il client di chat non chiamerebbe (openaiClient.ts:67-73), il preflight nemmeno.
        expect(fetchSpia).not.toHaveBeenCalled();
        // ...e la condizione DEVE essere detta, non ingoiata (regressione F-b7e2d941).
        expect(descriviEsitoModelloAi(esito)).toContain('AI_ALLOW_REMOTE_ENDPOINT');
    });

    it('endpoint remoto CONSENTITO dalla policy → interroga davvero E allega la chiave', async () => {
        configMock.openaiBaseUrl = 'https://api.openai.com/v1';
        configMock.openaiApiKey = 'chiave-consentita';
        configMock.aiAllowRemoteEndpoint = true;
        configMock.aiModel = 'gpt-5.4';
        const fetchSpia = vi.fn(async (_url: string, _init?: RequestInit) =>
            rispostaModelli(['gpt-5.4', 'gpt-5.4-mini']),
        );
        vi.stubGlobal('fetch', fetchSpia);
        expect((await verificaModelloAi()).stato).toBe('ok');
        expect(fetchSpia).toHaveBeenCalledTimes(1);
        // Senza header il provider cloud risponde 401 → `sconosciuto` PERMANENTE e muto: il test
        // deve vedere l'header, non solo che la chiamata è partita (F-f60b3d5c).
        const headers = (fetchSpia.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
        expect(headers.authorization).toBe('Bearer chiave-consentita');
    });

    it('host `.local` (mDNS = un PC qualsiasi della LAN) NON riceve la chiave, anche se conta come locale', async () => {
        configMock.openaiBaseUrl = 'http://nas.local:11434/v1';
        configMock.openaiApiKey = 'chiave-che-non-deve-uscire';
        configMock.aiAllowRemoteEndpoint = false;
        const fetchSpia = vi.fn(async (_url: string, _init?: RequestInit) => rispostaModelli(['llama3.1:8b']));
        vi.stubGlobal('fetch', fetchSpia);
        await verificaModelloAi();
        const headers = (fetchSpia.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
        expect(headers.authorization).toBeUndefined();
    });

    it('in green mode il messaggio nomina AI_GREEN_MODEL, non AI_MODEL (altrimenti si corregge la variabile sbagliata)', async () => {
        stato.greenMode = true;
        configMock.aiGreenModel = 'llama3.1:8b';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen3:8b'])),
        );
        const testo = descriviEsitoModelloAi(await verificaModelloAi());
        expect(testo).toContain('AI_GREEN_MODEL');
        expect(testo).not.toContain('Correggere AI_MODEL');
    });

    it('elenco lungo troncato a 10 + conteggio (il catalogo cloud è ~80 voci, stampato a ogni ciclo)', async () => {
        const molti = Array.from({ length: 25 }, (_, i) => `modello-${i}`);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(molti)),
        );
        const testo = descriviEsitoModelloAi(await verificaModelloAi());
        expect(testo).toContain('(+15 altri)');
        expect(testo).not.toContain('modello-20');
    });

    it('IPv6 loopback `[::1]` riconosciuto: `new URL().hostname` tiene le parentesi e il ramo era codice morto', () => {
        // Misurato: new URL('http://[::1]:11434/v1').hostname === '[::1]', non '::1'.
        expect(isLoopbackAiHost('http://[::1]:11434/v1')).toBe(true);
        expect(isLocalAiEndpoint('http://[::1]:11434/v1')).toBe(true);
    });

    it('confine di sicurezza: loopback stretto ≠ «locale», e nessun suffisso ingannevole passa', () => {
        expect(isLoopbackAiHost('http://127.0.0.1:11434/v1')).toBe(true);
        expect(isLoopbackAiHost('http://localhost:11434/v1')).toBe(true);
        // `.local` è mDNS: «in casa» sì, ma NON è questa macchina ⇒ niente credenziali.
        expect(isLocalAiEndpoint('http://nas.local:11434/v1')).toBe(true);
        expect(isLoopbackAiHost('http://nas.local:11434/v1')).toBe(false);
        // Host che IMITANO il loopback non devono passare né l'uno né l'altro.
        expect(isLoopbackAiHost('http://127.0.0.1.evil.com/v1')).toBe(false);
        expect(isLocalAiEndpoint('http://127.0.0.1.evil.com/v1')).toBe(false);
        expect(isLoopbackAiHost('https://api.openai.com/v1')).toBe(false);
        expect(isLocalAiEndpoint('non-una-url')).toBe(false);
    });

    it('il claim su `ok` resta STRETTO: dice che il nome esiste, non che l’AI funzioni', async () => {
        configMock.aiModel = 'qwen3:8b';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => rispostaModelli(['qwen3:8b'])),
        );
        const testo = descriviEsitoModelloAi(await verificaModelloAi());
        expect(testo).toContain("sull'endpoint configurato");
        // Guardia contro una promozione futura del messaggio: il registry può risolvere altrove.
        expect(testo.toLowerCase()).not.toContain('funziona');
    });
});
