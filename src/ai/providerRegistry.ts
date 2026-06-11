/**
 * ai/providerRegistry.ts
 * Registry centralizzato per la risoluzione del provider AI testuale.
 * SOLO risoluzione (pura, testabile): l'esecuzione/dispatch è in aiTextClient.ts (F0 ai-stack).
 *
 * Decide il provider per OGNI richiesta in base a: purpose (guard zero-PII),
 * AI_PROVIDER per-deployment, green mode, gate endpoint remoto e circuit breaker.
 *
 * Guard zero-PII (decisione utente 2026-06-11): i purpose che vedono dati personali
 * del lead NON risolvono MAI a un provider cloud — solo endpoint locale o template.
 * Il gating per-feature (aiPersonalizationEnabled, aiGuardianEnabled, aiSentimentEnabled)
 * resta nei call-site: qui un gate globale regredirebbe i consumer non-personalization.
 *
 * H28: circuit breaker OpenAI aperto → fallback Ollama/template senza retry inutili.
 * LIMITE NOTO (fix in F4): il ramo openai_circuit_open_ollama_fallback con
 * OLLAMA_FALLBACK_URL separato è risolvibile ma NON eseguibile da requestOpenAIText
 * (baseUrl hardcoded + circuitKey 'openai.chat' condiviso → CircuitOpenError immediato).
 *
 * NOTA: importa da integrationPolicy per lo stato del circuit breaker.
 * Nessuna circular dependency (integrationPolicy non importa da ai/).
 */

import { config, isGreenModeWindow } from '../config';
import { isOpenAIConfigured } from './openaiClient';
import { isAnthropicConfigured } from './anthropicClient';
import { isCircuitOpenForKey } from '../core/integrationPolicy';

export type AiProviderType = 'openai' | 'ollama' | 'anthropic' | 'template';

/** Purpose tipizzato per ogni call-site testuale: abilita la guard PII e il routing per-tier (F2). */
export type AiTextPurpose =
    | 'invite_note'
    | 'follow_up'
    | 'reminder'
    | 'lead_scoring'
    | 'lead_cleaning'
    | 'decision_engine'
    | 'sentiment'
    | 'intent'
    | 'decoy_terms'
    | 'guardian'
    | 'ai_advisor'
    | 'post_content';

/**
 * purpose → vede PII del lead? (nome/email/telefono/URL/azienda o testo scritto dal lead).
 * sentiment/intent analizzano il TESTO dei messaggi del lead → PII per decisione binding.
 * decision_engine: no-PII da F0.5 — il prompt è pseudonimizzato by-design (leadPseudonymizer
 * + buildDecisionPrompt: solo enum/boolean/numeri); prova meccanica = test sentinella in
 * aiDecisionEngine.vitest.ts. Riclassificare a true se il prompt torna a contenere dati raw.
 */
const PII_SENSITIVE_PURPOSES: Record<AiTextPurpose, boolean> = {
    invite_note: true,
    follow_up: true,
    reminder: true,
    lead_scoring: true,
    lead_cleaning: true,
    decision_engine: false,
    sentiment: true,
    intent: true,
    decoy_terms: false,
    guardian: false,
    ai_advisor: false,
    post_content: false,
};

export function isPiiSensitivePurpose(purpose: AiTextPurpose): boolean {
    return PII_SENSITIVE_PURPOSES[purpose];
}

export interface AiProviderResolution {
    provider: AiProviderType;
    reason: string;
    endpoint: string | null;
    model: string | null;
    purpose: AiTextPurpose;
    piiSensitive: boolean;
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
 * Ordine: template esplicito → green mode (locale) → gate remoto → guard PII →
 * provider esplicito (anthropic/ollama) → chain storica (openai/H28 → ollama → template).
 */
export function resolveAiProvider(purpose: AiTextPurpose): AiProviderResolution {
    const piiSensitive = isPiiSensitivePurpose(purpose);
    const base = { purpose, piiSensitive };
    const ollamaAvailable = isOllamaConfigured();
    const openaiAvailable = isOpenAIConfigured();

    if (config.aiProvider === 'template') {
        return { provider: 'template', reason: 'explicit_template', endpoint: null, model: null, ...base };
    }

    // Green mode vince anche su AI_PROVIDER esplicito: è la direttiva più specifica
    // (finestra oraria a basso impatto → locale). model = aiGreenModel, coerente col client.
    if (isGreenModeWindow()) {
        if (ollamaAvailable) {
            return {
                provider: 'ollama',
                reason: 'green_mode_local',
                endpoint: config.openaiBaseUrl,
                model: config.aiGreenModel,
                ...base,
            };
        }
        return { provider: 'template', reason: 'green_mode_no_ollama', endpoint: null, model: null, ...base };
    }

    if (!config.aiAllowRemoteEndpoint) {
        if (ollamaAvailable) {
            return {
                provider: 'ollama',
                reason: 'remote_disabled_local_only',
                endpoint: config.openaiBaseUrl,
                model: config.aiModel,
                ...base,
            };
        }
        return { provider: 'template', reason: 'remote_disabled_no_ollama', endpoint: null, model: null, ...base };
    }

    // Guard zero-PII: purpose con dati lead → MAI cloud, anche con AI_PROVIDER esplicito.
    if (piiSensitive) {
        if (ollamaAvailable) {
            return {
                provider: 'ollama',
                reason: 'pii_cloud_blocked_local_only',
                endpoint: config.openaiBaseUrl,
                model: config.aiModel,
                ...base,
            };
        }
        return { provider: 'template', reason: 'pii_cloud_blocked_no_local', endpoint: null, model: null, ...base };
    }

    // Anthropic SOLO su selezione esplicita (in F0 'auto' non lo sceglie mai:
    // comportamento storico preservato; la preferenza per-tier arriva in F2).
    if (config.aiProvider === 'anthropic' && isAnthropicConfigured()) {
        if (isCircuitOpenForKey('anthropic.messages')) {
            if (ollamaAvailable) {
                return {
                    provider: 'ollama',
                    reason: 'anthropic_circuit_open_local_fallback',
                    endpoint: config.openaiBaseUrl,
                    model: config.aiModel,
                    ...base,
                };
            }
            return {
                provider: 'template',
                reason: 'anthropic_circuit_open_no_fallback',
                endpoint: null,
                model: null,
                ...base,
            };
        }
        // endpoint null = default SDK (api.anthropic.com), non configurabile per design.
        return {
            provider: 'anthropic',
            reason: 'anthropic_selected',
            endpoint: null,
            model: config.anthropicModel,
            ...base,
        };
    }

    if (config.aiProvider === 'ollama') {
        if (ollamaAvailable) {
            return {
                provider: 'ollama',
                reason: 'explicit_ollama',
                endpoint: config.openaiBaseUrl,
                model: config.aiModel,
                ...base,
            };
        }
        return { provider: 'template', reason: 'explicit_ollama_unavailable', endpoint: null, model: null, ...base };
    }

    // 'auto' | 'openai' | anthropic-non-configurato → chain storica (H28).
    if (openaiAvailable) {
        // H28: circuit breaker aperto → switch immediato al fallback, niente retry inutili.
        if (isCircuitOpenForKey('openai.chat')) {
            if (isOllamaFallbackConfigured()) {
                return {
                    provider: 'ollama',
                    reason: 'openai_circuit_open_ollama_fallback',
                    endpoint: config.ollamaFallbackUrl,
                    model: config.aiGreenModel,
                    ...base,
                };
            }
            // Nessun Ollama fallback → degrade a template (meglio che bloccare)
            return {
                provider: 'template',
                reason: 'openai_circuit_open_no_fallback',
                endpoint: null,
                model: null,
                ...base,
            };
        }
        return {
            provider: 'openai',
            reason: 'cloud_configured',
            endpoint: config.openaiBaseUrl,
            model: config.aiModel,
            ...base,
        };
    }

    if (ollamaAvailable) {
        return {
            provider: 'ollama',
            reason: 'cloud_unavailable_local_fallback',
            endpoint: config.openaiBaseUrl,
            model: config.aiModel,
            ...base,
        };
    }

    return { provider: 'template', reason: 'no_ai_provider_available', endpoint: null, model: null, ...base };
}
