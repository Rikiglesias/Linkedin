/**
 * tests/openaiClientH28.vitest.ts
 * F4 ai-stack: requestOpenAIText esegue endpoint/model della resolution (ramo H28).
 * Sentinella: l'endpoint di fallback usa integration/circuitKey DEDICATE — se questo test
 * fallisce, il fallback torna a morire sul breaker openai.chat aperto (regressione H28).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchWithRetryPolicy: vi.fn(),
    mockConfig: {
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: 'sk-test-key',
        aiAllowRemoteEndpoint: true,
        aiModel: 'gpt-4o-mini',
        aiGreenModel: 'llama3.1:8b',
        aiEmbeddingModel: 'nomic-embed-text',
        aiRequestTimeoutMs: 12000,
    },
}));

vi.mock('../core/integrationPolicy', () => ({
    fetchWithRetryPolicy: mocks.fetchWithRetryPolicy,
}));

vi.mock('../config', () => ({
    config: mocks.mockConfig,
    isGreenModeWindow: () => false,
}));

import { requestOpenAIText } from '../ai/openaiClient';

function okResponse(content: string) {
    return {
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
    };
}

beforeEach(() => {
    mocks.fetchWithRetryPolicy.mockReset().mockResolvedValue(okResponse('out'));
});

describe('requestOpenAIText — F4 endpoint/model override (H28)', () => {
    it('baseUrl fallback locale → URL fallback + circuitKey DEDICATA ollama.fallback.chat', async () => {
        const out = await requestOpenAIText({
            system: 's',
            user: 'u',
            maxOutputTokens: 100,
            temperature: 0.2,
            baseUrl: 'http://127.0.0.1:11434/v1',
            model: 'llama3.1:8b',
        });
        expect(out).toBe('out');
        const [url, init, opts] = mocks.fetchWithRetryPolicy.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
        expect(opts).toMatchObject({
            integration: 'ollama.fallback_chat_completion',
            circuitKey: 'ollama.fallback.chat',
        });
        expect(JSON.parse((init as { body: string }).body).model).toBe('llama3.1:8b');
    });

    it('senza override → comportamento storico: config.openaiBaseUrl + circuitKey openai.chat', async () => {
        await requestOpenAIText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0.2 });
        const [url, init, opts] = mocks.fetchWithRetryPolicy.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(opts).toMatchObject({ integration: 'openai.chat_completion', circuitKey: 'openai.chat' });
        expect(JSON.parse((init as { body: string }).body).model).toBe('gpt-4o-mini');
    });

    it('override su endpoint locale bypassa il gate remoto SOLO perché locale (zero-PII invariato)', async () => {
        mocks.mockConfig.aiAllowRemoteEndpoint = false;
        await expect(
            requestOpenAIText({
                system: 's',
                user: 'u',
                maxOutputTokens: 100,
                temperature: 0.2,
                baseUrl: 'http://127.0.0.1:11434/v1',
            }),
        ).resolves.toBe('out');
        // endpoint remoto con gate chiuso resta bloccato anche via override
        await expect(
            requestOpenAIText({
                system: 's',
                user: 'u',
                maxOutputTokens: 100,
                temperature: 0.2,
                baseUrl: 'https://evil-remote.example.com/v1',
            }),
        ).rejects.toThrow('Endpoint AI remoto bloccato');
        mocks.mockConfig.aiAllowRemoteEndpoint = true;
    });
});
