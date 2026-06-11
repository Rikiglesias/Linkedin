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
        aiProvider: 'auto' as string,
        anthropicApiKey: '',
        anthropicModel: 'claude-opus-4-8',
    },
    mockState: {
        openAIConfigured: true,
        circuitOpen: false,
        anthropicConfigured: false,
        anthropicCircuitOpen: false,
        greenMode: false,
    },
}));

vi.mock('../config', () => ({
    config: mockConfig,
    isGreenModeWindow: () => mockState.greenMode,
}));

vi.mock('../ai/openaiClient', () => ({
    isOpenAIConfigured: () => mockState.openAIConfigured,
}));

vi.mock('../ai/anthropicClient', () => ({
    isAnthropicConfigured: () => mockState.anthropicConfigured,
}));

vi.mock('../core/integrationPolicy', () => ({
    isCircuitOpenForKey: (key: string) =>
        (key === 'openai.chat' && mockState.circuitOpen) ||
        (key === 'anthropic.messages' && mockState.anthropicCircuitOpen),
}));

import { resolveAiProvider, isPiiSensitivePurpose } from '../ai/providerRegistry';

beforeEach(() => {
    // Reset defaults: scenario cloud OpenAI remoto
    mockConfig.aiPersonalizationEnabled = true;
    mockConfig.openaiApiKey = 'sk-test-key';
    mockConfig.openaiBaseUrl = 'https://api.openai.com/v1';
    mockConfig.aiModel = 'gpt-4o-mini';
    mockConfig.aiGreenModel = 'llama3.1:8b';
    mockConfig.aiAllowRemoteEndpoint = true;
    mockConfig.ollamaFallbackUrl = '';
    mockConfig.aiProvider = 'auto';
    mockConfig.anthropicApiKey = '';
    mockConfig.anthropicModel = 'claude-opus-4-8';
    mockState.openAIConfigured = true;
    mockState.circuitOpen = false;
    mockState.anthropicConfigured = false;
    mockState.anthropicCircuitOpen = false;
    mockState.greenMode = false;
});

// ═══════════════════════════════════════════════════════════════════════════════
// H28: Provider Registry — Dynamic fallback quando circuit breaker è aperto
// (purpose no-PII 'guardian': la chain storica vale per i purpose cloud-eleggibili)
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — H28 circuit breaker fallback', () => {
    it('OpenAI configurato + CB chiuso → usa OpenAI', () => {
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('openai');
        expect(result.reason).toBe('cloud_configured');
    });

    it('OpenAI configurato + CB aperto + Ollama fallback → switch a Ollama', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://localhost:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
        expect(result.endpoint).toBe('http://localhost:11434/v1');
        expect(result.model).toBe('llama3.1:8b');
    });

    it('OpenAI configurato + CB aperto + NO Ollama fallback → degrade a template', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = '';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('openai_circuit_open_no_fallback');
    });

    it('OpenAI configurato + CB aperto + Ollama fallback URL remoto → NON usa fallback (solo local)', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'https://remote-ollama.example.com/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('openai_circuit_open_no_fallback');
    });

    it('OpenAI non configurato + Ollama primario → usa Ollama (ignora CB)', () => {
        mockState.openAIConfigured = false;
        mockConfig.openaiBaseUrl = 'http://localhost:11434/v1';
        mockState.circuitOpen = true; // irrilevante — OpenAI non è il provider
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('cloud_unavailable_local_fallback');
    });

    it('CB si richiude → torna a OpenAI', () => {
        mockState.circuitOpen = true;
        const degraded = resolveAiProvider('guardian');
        expect(degraded.provider).toBe('template');

        mockState.circuitOpen = false;
        const recovered = resolveAiProvider('guardian');
        expect(recovered.provider).toBe('openai');
        expect(recovered.reason).toBe('cloud_configured');
    });

    it('Ollama fallback con 127.0.0.1 → riconosciuto come locale', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
    });

    it('Ollama fallback con .local hostname → riconosciuto come locale', () => {
        mockState.circuitOpen = true;
        mockConfig.ollamaFallbackUrl = 'http://my-server.local:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('openai_circuit_open_ollama_fallback');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F0 ai-stack: gate per-feature rimosso dal registry (regressione finding ALTA-1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — gate per-feature NEI call-site, non nel registry', () => {
    it('purpose intent + personalization OFF + default locale → ollama, NON template', () => {
        // Deployment default: Ollama localhost, remote disabilitato, personalization OFF.
        // intentResolver/leadScorer/ecc. oggi chiamano Ollama: il registry non deve regredirli.
        mockConfig.aiPersonalizationEnabled = false;
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        mockConfig.aiAllowRemoteEndpoint = false;
        const result = resolveAiProvider('intent');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('remote_disabled_local_only');
    });

    it('personalization OFF non forza template nemmeno su scenario cloud', () => {
        mockConfig.aiPersonalizationEnabled = false;
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('openai');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F0 ai-stack: guard zero-PII — purpose con dati lead MAI su cloud
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — guard zero-PII', () => {
    it('classificazione purpose: lead-data=PII, aggregati e pseudonimizzati=no-PII', () => {
        expect(isPiiSensitivePurpose('invite_note')).toBe(true);
        expect(isPiiSensitivePurpose('sentiment')).toBe(true);
        // F0.5: prompt pseudonimizzato by-design (test sentinella in aiDecisionEngine.vitest)
        expect(isPiiSensitivePurpose('decision_engine')).toBe(false);
        expect(isPiiSensitivePurpose('guardian')).toBe(false);
        expect(isPiiSensitivePurpose('decoy_terms')).toBe(false);
    });

    it('F0.5: decision_engine + AI_PROVIDER=anthropic → anthropic (cervello cloud-eligible)', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        const result = resolveAiProvider('decision_engine');
        expect(result.provider).toBe('anthropic');
        expect(result.reason).toBe('anthropic_selected');
    });

    it('F0.5 dichiarato: decision_engine + auto + OpenAI key remota → openai (guard sul DATO, non sul vendor)', () => {
        // Il flip apre il cloud anche a OpenAI remoto in auto: il prompt è anonimo,
        // quindi la policy zero-PII è rispettata indipendentemente dal provider.
        const result = resolveAiProvider('decision_engine');
        expect(result.provider).toBe('openai');
        expect(result.reason).toBe('cloud_configured');
    });

    it('purpose PII + AI_PROVIDER=anthropic configurato → locale, MAI anthropic', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        mockConfig.anthropicApiKey = 'sk-ant-test';
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('invite_note');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('pii_cloud_blocked_local_only');
        expect(result.piiSensitive).toBe(true);
    });

    it('purpose PII + cloud remoto senza locale → template (il dato non esce)', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        // openaiBaseUrl remoto: nessun endpoint locale disponibile
        const result = resolveAiProvider('lead_scoring');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('pii_cloud_blocked_no_local');
    });

    it('purpose PII in auto con cloud OpenAI remoto → bloccato (hardening dichiarato)', () => {
        const result = resolveAiProvider('follow_up');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('pii_cloud_blocked_no_local');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F0 ai-stack: provider Anthropic esplicito + auto-mai-anthropic
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — AI_PROVIDER anthropic/esplicito', () => {
    it('AI_PROVIDER=anthropic + key + CB chiuso + purpose no-PII → anthropic', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('anthropic');
        expect(result.reason).toBe('anthropic_selected');
        expect(result.model).toBe('claude-opus-4-8');
        expect(result.endpoint).toBeNull();
    });

    it('AI_PROVIDER=anthropic + CB anthropic aperto + locale disponibile → fallback ollama', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        mockState.anthropicCircuitOpen = true;
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('anthropic_circuit_open_local_fallback');
    });

    it('AI_PROVIDER=anthropic + CB anthropic aperto senza locale → template', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        mockState.anthropicCircuitOpen = true;
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('anthropic_circuit_open_no_fallback');
    });

    it('AI_PROVIDER=anthropic SENZA key → degrada alla chain auto (no crash)', () => {
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = false;
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('openai');
        expect(result.reason).toBe('cloud_configured');
    });

    it('auto NON seleziona MAI anthropic anche se configurato (F0: comportamento storico)', () => {
        mockConfig.aiProvider = 'auto';
        mockState.anthropicConfigured = true;
        mockConfig.anthropicApiKey = 'sk-ant-test';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('openai');
        expect(result.reason).toBe('cloud_configured');
    });

    it('AI_PROVIDER=template → template esplicito, nessuna chain', () => {
        mockConfig.aiProvider = 'template';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('template');
        expect(result.reason).toBe('explicit_template');
    });

    it('AI_PROVIDER=ollama + locale → ollama esplicito', () => {
        mockConfig.aiProvider = 'ollama';
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('explicit_ollama');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F0 ai-stack: green mode — priorità su tutto, metadata coerenti col client
// ═══════════════════════════════════════════════════════════════════════════════

describe('providerRegistry — green mode', () => {
    it('green window + locale → ollama con aiGreenModel (metadata coerenti col client)', () => {
        mockState.greenMode = true;
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('green_mode_local');
        expect(result.model).toBe('llama3.1:8b');
    });

    it('green window vince anche su AI_PROVIDER=anthropic esplicito', () => {
        mockState.greenMode = true;
        mockConfig.aiProvider = 'anthropic';
        mockState.anthropicConfigured = true;
        mockConfig.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
        const result = resolveAiProvider('guardian');
        expect(result.provider).toBe('ollama');
        expect(result.reason).toBe('green_mode_local');
    });
});
