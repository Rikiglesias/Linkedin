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
    },
    greenMode: false,
}));
const configMock = stato.config;

vi.mock('../config', () => ({ config: stato.config, isGreenModeWindow: () => stato.greenMode }));
vi.mock('../telemetry/logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
// `modelPreflight` importa `resolveAiModel` da openaiClient, che a sua volta tira dentro la
// policy di retry: qui interessa solo la scelta del nome, non la rete del client.
vi.mock('../core/integrationPolicy', () => ({ fetchWithRetryPolicy: vi.fn() }));

import { verificaModelloAi } from '../ai/modelPreflight';

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

    it('interroga la STESSA base URL che usa il client di chat, non un endpoint dedotto', async () => {
        const fetchSpia = vi.fn(async (_url: string) => rispostaModelli(['llama3.1:8b']));
        vi.stubGlobal('fetch', fetchSpia);
        await verificaModelloAi();
        const urlChiamato = String(fetchSpia.mock.calls[0]?.[0] ?? '');
        expect(urlChiamato.startsWith('http://127.0.0.1:11434/v1')).toBe(true);
        expect(urlChiamato.endsWith('/models')).toBe(true);
    });
});
