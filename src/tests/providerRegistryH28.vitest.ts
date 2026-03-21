import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state (accessibile dalle factory vi.mock) ───────────────────
const { mockConfig, mockState } = vi.hoisted(() => ({
    mockConfig: {
        aiPersonalizationEnabled: true,
        openaiApiKey: 'sk-test-key',
        openaiBaseUrl: 'https://api.openai.com/v1',
        aiModel: 'gpt-4o-mini',
        aiGreenModel: 'llama3.1:8b',
        aiAllowRemoteEndpoint: true,
        ollamaFallbackUrl: '',
    },
    mockState: {
        openAIConfigured: true,
        circuitOpen: false,
    },
}));

vi.mock('../config', () => ({
    config: mockConfig,
    isGreenModeWindow: () => false,
}));

vi.mock('../ai/openaiClient', () => ({
    isOpenAIConfigured: () => mockState.openAIConfigured,
}));

vi.mock('../core/integrationPolicy', () => ({
    isCircuitOpenForKey: (key: string) => key === 'openai.chat' && mockState.circuitOpen,
}));

import { resolveAiProvider } from '../ai/providerRegistry';

// ═══════════════════════════════════════════════════════════════════════════════
// H28: Provider Registry — Dynamic fallback quando circuit breaker è aperto
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — H28 circuit breaker fallback', () => {
    beforeEach(() => {
        // Reset defaults
        mockConfig.aiPersonalizationEnabled = true;
        mockConfig.openaiApiKey = 'sk-test-key';
        mockConfig.openaiBaseUrl = 'https://api.openai.com/v1';
        mockConfig.aiModel = 'gpt-4o-mini';
        mockConfig.aiGreenModel = 'llama3.1:8b';
        mockConfig.aiAllowRemoteEndpoint = true;
        mockConfig.ollamaFallbackUrl = '';
        mockState.openAIConfigured = true;
        mockState.circuitOpen = false;
    });

    it('OpenAI configurato + CB chiuso → usa OpenAI', () => {
        const result = resolveAiProvider();
        expect(result.provider).toBe('openai');
        expect(result.reason).toBe('cloud_configured');
    });

    it('OpenAI configurato + CB aperto + Ollama fallback → switch a Ollama', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://localhost:11434/v1';
        const result = resolveAiProvider();
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
        expect(result.endpoint).toBe('http://localhost:11434/v1');
        expect(result.model).toBe('llama3.1:8b');
    });

    it('OpenAI configurato + CB aperto + NO Ollama fallback → degrade a template', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = '';
        const result = resolveAiProvider();
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('openai_circuit_open_no_fallback');
    });

    it('OpenAI configurato + CB aperto + Ollama fallback URL remoto → NON usa fallback (solo local)', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'https://remote-ollama.example.com/v1';
        const result = resolveAiProvider();
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('openai_circuit_open_no_fallback');
    });

    it('AI disabilitata → template indipendentemente dal CB', () => {
        mockConfig.aiPersonalizationEnabled = false;
        mockState.circuitOpen = true;
        const result = resolveAiProvider();
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('ai_personalization_disabled');
    });

    it('OpenAI non configurato + Ollama primario → usa Ollama (ignora CB)', () => {
        mockState.openAIConfigured = false;
        mockConfig.openaiBaseUrl = 'http://localhost:11434/v1';
        mockState.circuitOpen = true; // irrilevante — OpenAI non è il provider
        const result = resolveAiProvider();
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('cloud_unavailable_local_fallback');
    });

    it('CB si richiude → torna a OpenAI', () => {
        // Prima: CB aperto → template
        mockState.circuitOpen = true;
        const degraded = resolveAiProvider();
        expect(degraded.provider).toBe('template');

        // Dopo: CB si richiude → torna a OpenAI
        mockState.circuitOpen = false;
        const recovered = resolveAiProvider();
        expect(recovered.provider).toBe('openai');
        expect(recovered.reason).toBe('cloud_configured');
    });

    it('Ollama fallback con 127.0.0.1 → riconosciuto come locale', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider();
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
    });

    it('Ollama fallback con .local hostname → riconosciuto come locale', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://my-server.local:11434/v1';
        const result = resolveAiProvider();
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
    });
});
