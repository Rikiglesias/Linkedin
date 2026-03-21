/**
 * ai/providerRegistry.ts
 * Registry centralizzato per la risoluzione del provider AI.
 * Decide quale provider usare (OpenAI cloud, Ollama locale, template fallback)
 * basandosi su config, disponibilità, green mode e stato circuit breaker.
 *
 * H28: Switch dinamico — se il circuit breaker di OpenAI è aperto, il sistema
 * fallback automaticamente a Ollama (se OLLAMA_FALLBACK_URL configurato) o template.
 * Elimina i 10+ retry inutili prima dello switch.
 *
 * NOTA: importa da integrationPolicy per lo stato del circuit breaker.
 * Nessuna circular dependency (integrationPolicy non importa da ai/).
 */

import { config, isGreenModeWindow } from '../config';
import { isOpenAIConfigured } from './openaiClient';
import { isCircuitOpenForKey } from '../core/integrationPolicy';

export type AiProviderType = 'openai' | 'ollama' | 'template';

export interface AiProviderResolution {
    provider: AiProviderType;
    reason: string;
    endpoint: string | null;
    model: string | null;
}

/**
 * Rileva se Ollama è configurato come provider primario (openaiBaseUrl punta a localhost).
 * Il check di raggiungibilità reale è nel preflight-env.
 */
function isOllamaConfigured(): boolean {
    const baseUrl = config.openaiBaseUrl;
    if (!baseUrl) return false;
    return isLocalUrl(baseUrl);
}

/**
 * H28: Rileva se Ollama è configurato come fallback separato.
 * Attivo solo quando OLLAMA_FALLBACK_URL è impostato E punta a un host locale.
 */
function isOllamaFallbackConfigured(): boolean {
    const fallbackUrl = config.ollamaFallbackUrl;
    if (!fallbackUrl) return false;
    return isLocalUrl(fallbackUrl);
}

function isLocalUrl(baseUrl: string): boolean {
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
        // H28: Se il circuit breaker di OpenAI è aperto, switch immediato al fallback.
        // Evita 10+ retry inutili — il CB si è già aperto dopo 3+ failure consecutive.
        if (isCircuitOpenForKey('openai.chat')) {
            if (isOllamaFallbackConfigured()) {
                return {
                    provider: 'ollama',
                    reason: 'openai_circuit_open_ollama_fallback',
                    endpoint: config.ollamaFallbackUrl,
                    model: config.aiGreenModel,
                };
            }
            // Nessun Ollama fallback → degrade a template (meglio che bloccare)
            return { provider: 'template', reason: 'openai_circuit_open_no_fallback', endpoint: null, model: null };
        }
        return { provider: 'openai', reason: 'cloud_configured', endpoint: config.openaiBaseUrl, model: config.aiModel };
    }

    if (ollamaAvailable) {
        return { provider: 'ollama', reason: 'cloud_unavailable_local_fallback', endpoint: config.openaiBaseUrl, model: config.aiModel };
    }

    return { provider: 'template', reason: 'no_ai_provider_available', endpoint: null, model: null };
}
