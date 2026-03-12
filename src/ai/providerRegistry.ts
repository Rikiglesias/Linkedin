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
 * Esegue una richiesta AI testo con fallback runtime:
 *   1. Prova il provider primario (OpenAI cloud o Ollama, in base a resolveAiProvider)
 *   2. Se fallisce E Ollama è configurato E il primario non era già Ollama → riprova su Ollama
 *   3. Se anche Ollama fallisce → throw (il caller ricade su template)
 *
 * Questo copre il gap dove OpenAI cloud è selezionato ma down a runtime.
 */
export async function requestAiTextWithFallback(
    input: { system: string; user: string; maxOutputTokens: number; temperature: number; responseFormat?: 'json_object' | 'text' },
): Promise<{ text: string; provider: AiProviderType }> {
    const { requestOpenAIText } = await import('./openaiClient');
    const resolution = resolveAiProvider();

    if (resolution.provider === 'template') {
        throw new Error('No AI provider available (template only)');
    }

    // Tentativo primario
    try {
        const text = await requestOpenAIText(input);
        return { text, provider: resolution.provider };
    } catch (primaryError) {
        // Se il primario era già Ollama, non c'è fallback
        if (resolution.provider === 'ollama') {
            throw primaryError;
        }

        // Prova Ollama come fallback runtime (se configurato)
        const ollamaUrl = config.ollamaEndpoint;
        if (!ollamaUrl) {
            throw primaryError;
        }

        try {
            const { fetchWithRetryPolicy } = await import('../core/integrationPolicy');
            const headers: Record<string, string> = { 'content-type': 'application/json' };
            const ollamaApiUrl = `${ollamaUrl.replace(/\/+$/, '')}/v1/chat/completions`;
            const response = await fetchWithRetryPolicy(
                ollamaApiUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: config.aiModel,
                        messages: [
                            { role: 'system', content: input.system },
                            { role: 'user', content: input.user },
                        ],
                        temperature: input.temperature,
                        max_tokens: input.maxOutputTokens,
                    }),
                },
                {
                    integration: 'ollama.chat_fallback',
                    circuitKey: 'ollama.chat',
                    timeoutMs: 30_000,
                    maxAttempts: 1,
                },
            );

            if (!response.ok) {
                throw primaryError; // Ollama fallback failed, throw original error
            }

            const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
            const text = payload?.choices?.[0]?.message?.content?.trim() ?? '';
            if (!text) {
                throw primaryError;
            }
            return { text, provider: 'ollama' };
        } catch {
            throw primaryError; // Fallback failed, propagate original error
        }
    }
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
