/**
 * ai/aiTextClient.ts
 * Facade di dispatch per la generazione testo AI (F0 ai-stack).
 * Risoluzione → providerRegistry (guard zero-PII inclusa);
 * esecuzione → openaiClient (openai/ollama) o anthropicClient (anthropic).
 * I call-site usano SOLO questo modulo, mai i client diretti
 * (eccezione documentata: semanticChecker usa openaiClient per gli embeddings).
 */

import { requestOpenAIText } from './openaiClient';
import { requestAnthropicText } from './anthropicClient';
import { resolveAiProvider, AiTextPurpose } from './providerRegistry';
import { logInfo, logWarn } from '../telemetry/logger';
import { sanitizeForLogs } from '../security/redaction';

export interface AiTextRequest {
    purpose: AiTextPurpose;
    system: string;
    user: string;
    maxOutputTokens: number;
    temperature: number;
    responseFormat?: 'json_object' | 'text';
}

/** Risoluzione 'template': nessun provider AI eseguibile — i caller con catch fanno fallback template. */
export class AiProviderUnavailableError extends Error {
    readonly reason: string;

    constructor(purpose: AiTextPurpose, reason: string) {
        super(`Nessun provider AI disponibile per '${purpose}' (${reason}).`);
        this.name = 'AiProviderUnavailableError';
        this.reason = reason;
    }
}

/** Gate per i call-site (sostituisce isOpenAIConfigured): false ⇒ usare direttamente il template. */
export function isAiTextConfigured(purpose: AiTextPurpose): boolean {
    return resolveAiProvider(purpose).provider !== 'template';
}

export async function requestAiText(input: AiTextRequest): Promise<string> {
    const resolution = resolveAiProvider(input.purpose);
    const request = {
        system: input.system,
        user: input.user,
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature,
        responseFormat: input.responseFormat,
    };

    switch (resolution.provider) {
        case 'anthropic': {
            // Guard difensiva data-residency (osserva, NON muta — F0.5): rileva SOLO PII
            // regex-detectable (email/URL LinkedIn/telefono/secrets via sanitizeForLogs).
            // La difesa primaria contro regressioni name/company è il test sentinella
            // sul prompt (aiDecisionEngine.vitest) — questo è un segnale "suspect".
            const combined = `${input.system}\n${input.user}`;
            if (sanitizeForLogs(combined) !== combined) {
                await logWarn('ai_text.cloud_pii_suspect', { purpose: input.purpose });
            }
            // Audit esplicito di OGNI uscita verso cloud (osservabilità + traccia data-residency):
            // scatta solo su purpose no-PII per la guard del registry.
            await logInfo('ai_text.cloud_dispatch', {
                purpose: input.purpose,
                provider: resolution.provider,
                model: resolution.model,
                reason: resolution.reason,
            });
            return requestAnthropicText(request);
        }
        case 'openai':
        case 'ollama':
            // Delega a requestOpenAIText che si auto-risolve endpoint/model (green mode incluso):
            // resolution.endpoint/model qui sono telemetria. Il ramo H28 con OLLAMA_FALLBACK_URL
            // separato resta non eseguibile in F0 (vedi nota in providerRegistry, fix F4).
            return requestOpenAIText(request);
        case 'template':
            throw new AiProviderUnavailableError(input.purpose, resolution.reason);
    }
}
