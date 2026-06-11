import { describe, it, expect, vi, beforeEach } from 'vitest';

// F0 ai-stack chunk D: catena risoluzione+dispatch REALE (providerRegistry + aiTextClient veri),
// con config/client/circuit-breaker mockati. Verifica il fallback anthropic → locale → template
// e la guard zero-PII end-to-end nel flusso di dispatch, non solo a livello di risoluzione.

const { mockConfig, mockState, clientMocks } = vi.hoisted(() => ({
    mockConfig: {
        openaiApiKey: '',
        openaiBaseUrl: 'http://127.0.0.1:11434/v1',
        aiModel: 'llama3.1:8b',
        aiGreenModel: 'llama3.1:8b',
        aiAllowRemoteEndpoint: true,
        ollamaFallbackUrl: '',
        aiProvider: 'anthropic' as string,
        anthropicApiKey: 'sk-ant-test',
        anthropicModel: 'claude-opus-4-8',
    },
    mockState: {
        openAIConfigured: true,
        anthropicConfigured: true,
        anthropicCircuitOpen: false,
        openaiCircuitOpen: false,
    },
    clientMocks: {
        requestOpenAIText: vi.fn(),
        requestAnthropicText: vi.fn(),
        logInfo: vi.fn(async () => {}),
    },
}));

vi.mock('../config', () => ({
    config: mockConfig,
    isGreenModeWindow: () => false,
}));

vi.mock('../ai/openaiClient', () => ({
    isOpenAIConfigured: () => mockState.openAIConfigured,
    requestOpenAIText: clientMocks.requestOpenAIText,
}));

vi.mock('../ai/anthropicClient', () => ({
    isAnthropicConfigured: () => mockState.anthropicConfigured,
    requestAnthropicText: clientMocks.requestAnthropicText,
}));

vi.mock('../core/integrationPolicy', () => ({
    isCircuitOpenForKey: (key: string) =>
        (key === 'anthropic.messages' && mockState.anthropicCircuitOpen) ||
        (key === 'openai.chat' && mockState.openaiCircuitOpen),
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: clientMocks.logInfo,
    logWarn: async () => {},
    logError: async () => {},
}));

import { requestAiText, AiProviderUnavailableError } from '../ai/aiTextClient';

const guardianRequest = {
    purpose: 'guardian' as const,
    system: 'sys',
    user: 'usr',
    maxOutputTokens: 200,
    temperature: 0.2,
};

beforeEach(() => {
    mockConfig.aiProvider = 'anthropic';
    mockConfig.anthropicApiKey = 'sk-ant-test';
    mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
    mockConfig.aiAllowRemoteEndpoint = true;
    mockState.openAIConfigured = true;
    mockState.anthropicConfigured = true;
    mockState.anthropicCircuitOpen = false;
    mockState.openaiCircuitOpen = false;
    clientMocks.requestOpenAIText.mockReset().mockResolvedValue('local-out');
    clientMocks.requestAnthropicText.mockReset().mockResolvedValue('cloud-out');
    clientMocks.logInfo.mockClear();
});

describe('catena fallback anthropic → locale → template (registry+dispatch reali)', () => {
    it('CB chiuso → la richiesta no-PII va ad Anthropic, con audit cloud_dispatch', async () => {
        const out = await requestAiText(guardianRequest);
        expect(out).toBe('cloud-out');
        expect(clientMocks.requestAnthropicText).toHaveBeenCalledTimes(1);
        expect(clientMocks.requestOpenAIText).not.toHaveBeenCalled();
        expect(clientMocks.logInfo).toHaveBeenCalledWith(
            'ai_text.cloud_dispatch',
            expect.objectContaining({ provider: 'anthropic', purpose: 'guardian' }),
        );
    });

    it('CB anthropic APERTO + Ollama locale → degrada a locale senza toccare il cloud', async () => {
        mockState.anthropicCircuitOpen = true;
        const out = await requestAiText(guardianRequest);
        expect(out).toBe('local-out');
        expect(clientMocks.requestAnthropicText).not.toHaveBeenCalled();
        expect(clientMocks.requestOpenAIText).toHaveBeenCalledTimes(1);
    });

    it('CB anthropic APERTO senza endpoint locale → AiProviderUnavailableError (i caller → template)', async () => {
        mockState.anthropicCircuitOpen = true;
        mockConfig.openaiBaseUrl = 'https://api.openai.com/v1';
        mockState.openAIConfigured = false;
        await expect(requestAiText(guardianRequest)).rejects.toBeInstanceOf(AiProviderUnavailableError);
        expect(clientMocks.requestAnthropicText).not.toHaveBeenCalled();
        expect(clientMocks.requestOpenAIText).not.toHaveBeenCalled();
    });

    it('guard zero-PII nel dispatch: purpose PII con AI_PROVIDER=anthropic → SEMPRE locale', async () => {
        const out = await requestAiText({ ...guardianRequest, purpose: 'invite_note' });
        expect(out).toBe('local-out');
        expect(clientMocks.requestAnthropicText).not.toHaveBeenCalled();
        expect(clientMocks.requestOpenAIText).toHaveBeenCalledTimes(1);
        expect(clientMocks.logInfo).not.toHaveBeenCalled();
    });

    it('CB si richiude → il traffico no-PII torna ad Anthropic', async () => {
        mockState.anthropicCircuitOpen = true;
        await requestAiText(guardianRequest);
        mockState.anthropicCircuitOpen = false;
        const out = await requestAiText(guardianRequest);
        expect(out).toBe('cloud-out');
        expect(clientMocks.requestAnthropicText).toHaveBeenCalledTimes(1);
    });
});
