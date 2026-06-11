/**
 * tests/visionCloudGate.vitest.ts
 * Test sentinella F2 zero-PII (decisione 2026-06-11): gli screenshot LinkedIn NON escono
 * verso provider cloud senza opt-in esplicito (VISION_ALLOW_CLOUD + AI_ALLOW_REMOTE_ENDPOINT).
 * Se questo test fallisce, il gate vision cloud è regredito: NON rimuovere senza ri-leggere
 * la decisione nel binding ai-stack (sezione DECISIONE UTENTE zero-PII).
 */
import { describe, it, expect } from 'vitest';
import { createVisionProvider } from '../captcha/visionProviderFactory';
import type { VisionProviderConfig } from '../captcha/visionProvider';

function baseCfg(partial: Partial<VisionProviderConfig>): VisionProviderConfig {
    return {
        provider: 'auto',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        ollamaModel: 'llava-llama3:8b',
        openaiApiKey: 'sk-test-key',
        openaiModel: 'gpt-5.4',
        temperature: 0.1,
        budgetMaxUsd: 0,
        redactScreenshots: false,
        allowCloud: false,
        ...partial,
    };
}

describe('vision cloud gate — zero-PII di default', () => {
    it('auto + key presente ma allowCloud=false → provider LOCALE (screenshot non escono)', () => {
        const provider = createVisionProvider(baseCfg({ provider: 'auto', allowCloud: false }));
        expect(provider.name).toBe('ollama');
    });

    it('openai esplicito + allowCloud=false → fallback LOCALE, mai cloud silenzioso', () => {
        const provider = createVisionProvider(baseCfg({ provider: 'openai', allowCloud: false }));
        expect(provider.name).toBe('ollama');
    });

    it('auto + opt-in esplicito (allowCloud=true) → hybrid cloud-first (comportamento storico)', () => {
        const provider = createVisionProvider(baseCfg({ provider: 'auto', allowCloud: true }));
        expect(provider.name).toBe('hybrid');
    });

    it('local-first + allowCloud=false → solo locale, nessun fallback cloud', () => {
        const provider = createVisionProvider(baseCfg({ provider: 'local-first', allowCloud: false }));
        expect(provider.name).toBe('ollama');
    });
});
