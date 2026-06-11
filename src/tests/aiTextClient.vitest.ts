import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProviderResolution } from '../ai/providerRegistry';

const mocks = vi.hoisted(() => ({
    resolution: null as unknown,
    requestOpenAIText: vi.fn(),
    requestAnthropicText: vi.fn(),
    logInfo: vi.fn(async () => {}),
    logWarn: vi.fn(async () => {}),
}));

vi.mock('../ai/providerRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../ai/providerRegistry')>();
    return {
        ...actual,
        resolveAiProvider: () => mocks.resolution,
    };
});

vi.mock('../ai/openaiClient', () => ({
    requestOpenAIText: mocks.requestOpenAIText,
    isOpenAIConfigured: () => true,
}));

vi.mock('../ai/anthropicClient', () => ({
    requestAnthropicText: mocks.requestAnthropicText,
    isAnthropicConfigured: () => true,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: mocks.logInfo,
    logWarn: mocks.logWarn,
    logError: async () => {},
}));

import { requestAiText, isAiTextConfigured, AiProviderUnavailableError } from '../ai/aiTextClient';

function resolution(partial: Partial<AiProviderResolution>): AiProviderResolution {
    return {
        provider: 'ollama',
        reason: 'test',
        endpoint: null,
        model: null,
        purpose: 'guardian',
        piiSensitive: false,
        ...partial,
    };
}

const baseRequest = {
    purpose: 'guardian' as const,
    system: 'sys',
    user: 'usr',
    maxOutputTokens: 200,
    temperature: 0.3,
};

beforeEach(() => {
    mocks.requestOpenAIText.mockReset();
    mocks.requestAnthropicText.mockReset();
    mocks.logInfo.mockClear();
    mocks.logWarn.mockClear();
});

describe('aiTextClient — dispatch', () => {
    it('provider openai/ollama → delega a requestOpenAIText senza il purpose', async () => {
        mocks.resolution = resolution({ provider: 'ollama' });
        mocks.requestOpenAIText.mockResolvedValue('ok-local');
        const out = await requestAiText({ ...baseRequest, responseFormat: 'json_object' });
        expect(out).toBe('ok-local');
        expect(mocks.requestOpenAIText).toHaveBeenCalledWith({
            system: 'sys',
            user: 'usr',
            maxOutputTokens: 200,
            temperature: 0.3,
            responseFormat: 'json_object',
            // F4: resolution senza endpoint/model → nessun override, il client usa i default config
            baseUrl: undefined,
            model: undefined,
        });
        expect(mocks.requestAnthropicText).not.toHaveBeenCalled();
    });

    it('F4 H28: resolution con endpoint/model (fallback Ollama) → passati al client ed ESEGUITI', async () => {
        mocks.resolution = resolution({
            provider: 'ollama',
            reason: 'openai_circuit_open_ollama_fallback',
            endpoint: 'http://127.0.0.1:11434/v1',
            model: 'llama3.1:8b',
        });
        mocks.requestOpenAIText.mockResolvedValue('ok-fallback');
        const out = await requestAiText(baseRequest);
        expect(out).toBe('ok-fallback');
        expect(mocks.requestOpenAIText).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1:8b' }),
        );
    });

    it('provider anthropic → delega a requestAnthropicText + audit cloud_dispatch', async () => {
        mocks.resolution = resolution({
            provider: 'anthropic',
            reason: 'anthropic_selected',
            model: 'claude-opus-4-8',
        });
        mocks.requestAnthropicText.mockResolvedValue('ok-cloud');
        const out = await requestAiText(baseRequest);
        expect(out).toBe('ok-cloud');
        expect(mocks.requestOpenAIText).not.toHaveBeenCalled();
        expect(mocks.logInfo).toHaveBeenCalledWith(
            'ai_text.cloud_dispatch',
            expect.objectContaining({ purpose: 'guardian', provider: 'anthropic', model: 'claude-opus-4-8' }),
        );
        // F2: il model per-tier della resolution viene passato al client (eseguito, non solo loggato)
        expect(mocks.requestAnthropicText).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-8' }));
    });

    it('F2: resolution senza model (null) → client chiamato senza override (default config)', async () => {
        mocks.resolution = resolution({ provider: 'anthropic', model: null });
        mocks.requestAnthropicText.mockResolvedValue('ok');
        await requestAiText(baseRequest);
        expect(mocks.requestAnthropicText).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
    });

    it('provider template → throw AiProviderUnavailableError tipizzato con reason', async () => {
        mocks.resolution = resolution({ provider: 'template', reason: 'pii_cloud_blocked_no_local' });
        await expect(requestAiText(baseRequest)).rejects.toBeInstanceOf(AiProviderUnavailableError);
        await expect(requestAiText(baseRequest)).rejects.toMatchObject({
            reason: 'pii_cloud_blocked_no_local',
        });
        expect(mocks.requestOpenAIText).not.toHaveBeenCalled();
        expect(mocks.requestAnthropicText).not.toHaveBeenCalled();
    });

    it('guard F0.5: prompt cloud con PII regex-detectable → warn cloud_pii_suspect (senza mutare)', async () => {
        mocks.resolution = resolution({ provider: 'anthropic' });
        mocks.requestAnthropicText.mockResolvedValue('ok');
        await requestAiText({ ...baseRequest, user: 'contatta mario.rossi@acme.com per il follow-up' });
        expect(mocks.logWarn).toHaveBeenCalledWith('ai_text.cloud_pii_suspect', { purpose: 'guardian' });
        // il prompt arriva al provider INALTERATO (la guard osserva, non muta)
        expect(mocks.requestAnthropicText).toHaveBeenCalledWith(
            expect.objectContaining({ user: 'contatta mario.rossi@acme.com per il follow-up' }),
        );
    });

    it('guard F0.5: prompt cloud pulito → NESSUN warn (baseline anti-falsi-positivi)', async () => {
        mocks.resolution = resolution({ provider: 'anthropic' });
        mocks.requestAnthropicText.mockResolvedValue('ok');
        await requestAiText({
            ...baseRequest,
            user: 'Session: 3 invites sent, risk=20/100, pending=30%. Lead profile: segment=c_level, industry=tech',
        });
        expect(mocks.logWarn).not.toHaveBeenCalled();
    });

    it('errore del client sottostante propagato al caller (fallback template nei catch)', async () => {
        mocks.resolution = resolution({ provider: 'ollama' });
        mocks.requestOpenAIText.mockRejectedValue(new Error('Ollama down'));
        await expect(requestAiText(baseRequest)).rejects.toThrow('Ollama down');
    });
});

describe('aiTextClient — isAiTextConfigured', () => {
    it('true quando la risoluzione non è template', () => {
        mocks.resolution = resolution({ provider: 'ollama' });
        expect(isAiTextConfigured('guardian')).toBe(true);
    });

    it('false quando la risoluzione è template (gate → i caller usano il template)', () => {
        mocks.resolution = resolution({ provider: 'template', reason: 'no_ai_provider_available' });
        expect(isAiTextConfigured('guardian')).toBe(false);
    });
});
