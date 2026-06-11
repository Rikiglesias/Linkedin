import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProviderResolution } from '../ai/providerRegistry';

const mocks = vi.hoisted(() => ({
    resolution: null as unknown,
    requestOpenAIText: vi.fn(),
    requestAnthropicText: vi.fn(),
    logInfo: vi.fn(async () => {}),
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
    logWarn: async () => {},
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
        });
        expect(mocks.requestAnthropicText).not.toHaveBeenCalled();
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
