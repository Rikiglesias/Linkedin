import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SDK: cattura opzioni costruttore + parametri messages.create; le classi
// errore restano quelle REALI (gli instanceof di classifyAnthropicError devono valere).
const mocks = vi.hoisted(() => ({
    ctorOptions: [] as unknown[],
    create: vi.fn(),
    retryOptions: [] as unknown[],
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
    const RealAnthropic = actual.default;
    class MockAnthropic {
        static APIError = RealAnthropic.APIError;
        static APIConnectionError = RealAnthropic.APIConnectionError;
        static RateLimitError = RealAnthropic.RateLimitError;
        messages = { create: (params: unknown) => mocks.create(params) };
        constructor(options: unknown) {
            mocks.ctorOptions.push(options);
        }
    }
    return { default: MockAnthropic };
});

// Mock executeWithRetryPolicy: esegue l'operazione 1 volta e cattura le options
// (niente stato circuit breaker reale nei unit test).
vi.mock('../core/integrationPolicy', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core/integrationPolicy')>();
    return {
        ...actual,
        executeWithRetryPolicy: vi.fn(async (operation: (attempt: number) => Promise<unknown>, options: unknown) => {
            mocks.retryOptions.push(options);
            return operation(1);
        }),
    };
});

import Anthropic from '@anthropic-ai/sdk';
import { requestAnthropicText, isAnthropicConfigured, classifyAnthropicError } from '../ai/anthropicClient';
import { config } from '../config';

function textResponse(text: string) {
    return { content: [{ type: 'text', text }] };
}

const originals = {
    anthropicApiKey: config.anthropicApiKey,
    anthropicModel: config.anthropicModel,
    anthropicTimeoutMs: config.anthropicTimeoutMs,
    aiAllowRemoteEndpoint: config.aiAllowRemoteEndpoint,
};

beforeEach(() => {
    mocks.ctorOptions.length = 0;
    mocks.retryOptions.length = 0;
    mocks.create.mockReset();
    config.anthropicApiKey = 'test-key';
    config.anthropicModel = 'claude-opus-4-8';
    config.anthropicTimeoutMs = 60000;
    config.aiAllowRemoteEndpoint = true;
});

afterEach(() => {
    config.anthropicApiKey = originals.anthropicApiKey;
    config.anthropicModel = originals.anthropicModel;
    config.anthropicTimeoutMs = originals.anthropicTimeoutMs;
    config.aiAllowRemoteEndpoint = originals.aiAllowRemoteEndpoint;
});

describe('anthropicClient — gating', () => {
    it('isAnthropicConfigured riflette la presenza della key', () => {
        expect(isAnthropicConfigured()).toBe(true);
        config.anthropicApiKey = '';
        expect(isAnthropicConfigured()).toBe(false);
    });

    it('senza ANTHROPIC_API_KEY lancia prima di toccare l\'SDK', async () => {
        config.anthropicApiKey = '';
        await expect(
            requestAnthropicText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0.5 }),
        ).rejects.toThrow(/ANTHROPIC_API_KEY/);
        expect(mocks.ctorOptions).toHaveLength(0);
    });

    it('con AI_ALLOW_REMOTE_ENDPOINT=false lancia (Anthropic è cloud)', async () => {
        config.aiAllowRemoteEndpoint = false;
        await expect(
            requestAnthropicText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0.5 }),
        ).rejects.toThrow(/AI_ALLOW_REMOTE_ENDPOINT/);
        expect(mocks.ctorOptions).toHaveLength(0);
    });
});

describe('anthropicClient — request shape', () => {
    it('costruttore SDK riceve timeout dedicato e maxRetries 0 (retry policy unica)', async () => {
        mocks.create.mockResolvedValue(textResponse('ok'));
        await requestAnthropicText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0.5 });
        expect(mocks.ctorOptions[0]).toMatchObject({
            apiKey: 'test-key',
            timeout: 60000,
            maxRetries: 0,
        });
    });

    it('passa model/max_tokens/system/messages e clampa temperature OpenAI-range a 1', async () => {
        mocks.create.mockResolvedValue(textResponse('ok'));
        await requestAnthropicText({ system: 'sys', user: 'usr', maxOutputTokens: 300, temperature: 1.4 });
        expect(mocks.create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'claude-opus-4-8',
                max_tokens: 300,
                system: 'sys',
                messages: [{ role: 'user', content: 'usr' }],
                temperature: 1,
            }),
        );
    });

    it('responseFormat json_object aggiunge l\'istruzione JSON al system', async () => {
        mocks.create.mockResolvedValue(textResponse('{"a":1}'));
        await requestAnthropicText({
            system: 'sys',
            user: 'usr',
            maxOutputTokens: 100,
            temperature: 0,
            responseFormat: 'json_object',
        });
        const params = mocks.create.mock.calls[0][0] as { system: string };
        expect(params.system).toContain('ONLY with valid JSON');
    });

    it('usa circuitKey anthropic.messages e classifyError dedicato', async () => {
        mocks.create.mockResolvedValue(textResponse('ok'));
        await requestAnthropicText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0.5 });
        expect(mocks.retryOptions[0]).toMatchObject({
            integration: 'anthropic.messages',
            circuitKey: 'anthropic.messages',
            classifyError: classifyAnthropicError,
        });
    });
});

describe('anthropicClient — output handling', () => {
    it('concatena i text block e fa strip dei fence markdown', async () => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'text', text: '```json\n{"terms":["a"]}\n```' }],
        });
        const out = await requestAnthropicText({
            system: 's',
            user: 'u',
            maxOutputTokens: 100,
            temperature: 0,
            responseFormat: 'json_object',
        });
        expect(out).toBe('{"terms":["a"]}');
    });

    it('risposta senza text block → throw esplicito', async () => {
        mocks.create.mockResolvedValue({ content: [] });
        await expect(
            requestAnthropicText({ system: 's', user: 'u', maxOutputTokens: 100, temperature: 0 }),
        ).rejects.toThrow(/vuota/);
    });
});

describe('classifyAnthropicError', () => {
    function apiErrorWithStatus(status: number | undefined) {
        const err = Object.create(Anthropic.APIError.prototype) as { status?: number };
        err.status = status;
        return err;
    }

    it('connection error → transient', () => {
        const err = Object.create(Anthropic.APIConnectionError.prototype);
        expect(classifyAnthropicError(err)).toBe('transient');
    });

    it('429/500/408 → transient', () => {
        expect(classifyAnthropicError(apiErrorWithStatus(429))).toBe('transient');
        expect(classifyAnthropicError(apiErrorWithStatus(500))).toBe('transient');
        expect(classifyAnthropicError(apiErrorWithStatus(408))).toBe('transient');
    });

    it('401/400/404 → terminal (ritentare non aiuta)', () => {
        expect(classifyAnthropicError(apiErrorWithStatus(401))).toBe('terminal');
        expect(classifyAnthropicError(apiErrorWithStatus(400))).toBe('terminal');
        expect(classifyAnthropicError(apiErrorWithStatus(404))).toBe('terminal');
    });

    it('errore generico non-SDK → terminal', () => {
        expect(classifyAnthropicError(new Error('boom'))).toBe('terminal');
    });
});
