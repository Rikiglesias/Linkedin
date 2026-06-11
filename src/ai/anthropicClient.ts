/**
 * ai/anthropicClient.ts
 * Client Anthropic (Messages API) con la STESSA shape di requestOpenAIText:
 * il dispatch (aiTextClient) può scambiare i provider senza adattare i caller.
 *
 * F0 ai-stack: retry + circuit breaker delegati a executeWithRetryPolicy
 * (circuitKey 'anthropic.messages'); il TIMEOUT è imposto dal costruttore SDK
 * (executeWithRetryPolicy non applica timeoutMs alle operazioni generiche) e
 * il retry SDK è disattivato (maxRetries: 0) — la retry policy è UNA sola.
 * Egress diretto verso api.anthropic.com: NON passa dal proxy pool integration
 * (il traffico AI cloud non deve consumare né mescolarsi col proxy LinkedIn).
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { executeWithRetryPolicy, RetryClassification } from '../core/integrationPolicy';

interface AnthropicTextRequest {
    system: string;
    user: string;
    maxOutputTokens: number;
    temperature: number;
    responseFormat?: 'json_object' | 'text';
    /** F2: model per-tier dal providerRegistry; assente → default config.anthropicModel. */
    model?: string;
}

export function isAnthropicConfigured(): boolean {
    return config.anthropicApiKey.trim().length > 0;
}

/**
 * Classificazione retry sulle classi tipizzate SDK: connessione/timeout/429/5xx/408
 * sono transient; auth/bad-request/not-found sono terminal (ritentare non aiuta).
 */
export function classifyAnthropicError(error: unknown): RetryClassification {
    if (error instanceof Anthropic.APIConnectionError) {
        return 'transient';
    }
    if (error instanceof Anthropic.APIError) {
        const status = typeof error.status === 'number' ? error.status : 0;
        if (status === 408 || status === 429 || status >= 500) {
            return 'transient';
        }
        return 'terminal';
    }
    return 'terminal';
}

/** Rimuove eventuali fence markdown (```json ... ```) per parità col json_object OpenAI. */
function stripMarkdownFences(text: string): string {
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenced ? fenced[1].trim() : text;
}

function extractTextBlocks(message: Anthropic.Message): string {
    return message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
}

export async function requestAnthropicText(input: AnthropicTextRequest): Promise<string> {
    if (!isAnthropicConfigured()) {
        throw new Error('ANTHROPIC_API_KEY mancante.');
    }
    if (!config.aiAllowRemoteEndpoint) {
        throw new Error('Endpoint AI remoto bloccato: Anthropic richiede AI_ALLOW_REMOTE_ENDPOINT=true.');
    }

    // Parità pratica col response_format json_object di OpenAI: istruzione esplicita
    // + strip fence in uscita. Structured outputs per-call-site = fase F2.
    const system =
        input.responseFormat === 'json_object'
            ? `${input.system}\nRespond ONLY with valid JSON. No prose, no markdown fences.`
            : input.system;

    const message = await executeWithRetryPolicy(
        async () => {
            const client = new Anthropic({
                apiKey: config.anthropicApiKey,
                timeout: config.anthropicTimeoutMs,
                maxRetries: 0,
            });
            return client.messages.create({
                model: input.model ?? config.anthropicModel,
                max_tokens: input.maxOutputTokens,
                system,
                messages: [{ role: 'user', content: input.user }],
                // OpenAI accetta temperature 0..2, Anthropic 0..1: clamp esplicito.
                temperature: Math.min(1, Math.max(0, input.temperature)),
            });
        },
        {
            integration: 'anthropic.messages',
            circuitKey: 'anthropic.messages',
            classifyError: classifyAnthropicError,
        },
    );

    const outputText = stripMarkdownFences(extractTextBlocks(message));
    if (!outputText) {
        throw new Error('Risposta Anthropic vuota o non parseabile.');
    }
    return outputText;
}
