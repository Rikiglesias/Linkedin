/**
 * ai/providerRegistry.ts
 * Registry centralizzato per la risoluzione del provider AI.
 * Decide quale provider usare (OpenAI cloud, Ollama locale, template fallback)
 * basandosi su config, disponibilità e green mode.
 *
 * NOTA: questo modulo importa SOLO da config e openaiClient per evitare
 * circular dependency nel modulo AI (debito tecnico noto).
 */

import { config, isGreenModeWindow } from '../config';
import { isOpenAIConfigured } from './openaiClient';

export type AiProviderType = 'openai' | 'ollama' | 'template';

export interface AiProviderResolution {
    provider: AiProviderType;
    reason: string;
    endpoint: string | null;
    model: string | null;
}

/**
 * Rileva se Ollama è configurato e raggiungibile (check sincrono su config).
 * Il check di raggiungibilità reale è nel preflight-env.
 */
function isOllamaConfigured(): boolean {
    const baseUrl = config.openaiBaseUrl;
    if (!baseUrl) return false;
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
    } catch {
        return false;
    }
}

/**
 * Risolve quale provider AI usare per la generazione testo.
 * Chain: green mode → Ollama | cloud OpenAI → Ollama fallback → template
 */
export function resolveAiProvider(): AiProviderResolution {
    if (!config.aiPersonalizationEnabled) {
        return { provider: 'template', reason: 'ai_personalization_disabled', endpoint: null, model: null };
    }

    const ollamaAvailable = isOllamaConfigured();
    const openaiAvailable = isOpenAIConfigured();

    if (isGreenModeWindow()) {
        if (ollamaAvailable) {
            return { provider: 'ollama', reason: 'green_mode_local', endpoint: config.openaiBaseUrl, model: config.aiModel };
        }
        return { provider: 'template', reason: 'green_mode_no_ollama', endpoint: null, model: null };
    }

    if (!config.aiAllowRemoteEndpoint) {
        if (ollamaAvailable) {
            return { provider: 'ollama', reason: 'remote_disabled_local_only', endpoint: config.openaiBaseUrl, model: config.aiModel };
        }
        return { provider: 'template', reason: 'remote_disabled_no_ollama', endpoint: null, model: null };
    }

    if (openaiAvailable) {
        return { provider: 'openai', reason: 'cloud_configured', endpoint: config.openaiBaseUrl, model: config.aiModel };
    }

    if (ollamaAvailable) {
        return { provider: 'ollama', reason: 'cloud_unavailable_local_fallback', endpoint: config.openaiBaseUrl, model: config.aiModel };
    }

    return { provider: 'template', reason: 'no_ai_provider_available', endpoint: null, model: null };
}

/**
 * Check rapido: è disponibile almeno un provider AI (non template)?
 */
export function isAiAvailable(): boolean {
    const resolution = resolveAiProvider();
    return resolution.provider !== 'template';
}

/**
 * Ritorna il tipo di provider attualmente attivo (per logging/monitoring).
 */
export function getActiveProviderType(): AiProviderType {
    return resolveAiProvider().provider;
}
