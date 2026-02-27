import { config } from '../config';

interface OpenAITextRequest {
    system: string;
    user: string;
    maxOutputTokens: number;
    temperature: number;
    responseFormat?: 'json_object' | 'text';
}

function isLocalAiEndpoint(baseUrl: string): boolean {
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return true;
        }
        return host.endsWith('.local');
    } catch {
        return false;
    }
}

function safeJoinUrl(baseUrl: string, suffix: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function extractOutputText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    // Standard OpenAI format: payload.choices[0].message.content
    const payloadObj = payload as { choices?: Array<{ message?: { content?: unknown } }> };
    if (Array.isArray(payloadObj.choices) && payloadObj.choices.length > 0) {
        const firstChoice = payloadObj.choices[0];
        if (firstChoice?.message?.content && typeof firstChoice.message.content === 'string') {
            return firstChoice.message.content.trim();
        }
    }

    return '';
}

export function isOpenAIConfigured(): boolean {
    return isLocalAiEndpoint(config.openaiBaseUrl) || !!config.openaiApiKey;
}

export async function requestOpenAIText(input: OpenAITextRequest): Promise<string> {
    const localEndpoint = isLocalAiEndpoint(config.openaiBaseUrl);
    if (!config.aiAllowRemoteEndpoint && !localEndpoint) {
        throw new Error(
            'Endpoint AI remoto bloccato: imposta OPENAI_BASE_URL su localhost oppure AI_ALLOW_REMOTE_ENDPOINT=true.'
        );
    }
    if (!config.openaiApiKey && !localEndpoint) {
        throw new Error('OPENAI_API_KEY mancante.');
    }

    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (config.openaiApiKey) {
        headers.authorization = `Bearer ${config.openaiApiKey}`;
    }

    const response = await fetch(safeJoinUrl(config.openaiBaseUrl, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: config.aiModel,
            messages: [
                { role: 'system', content: input.system },
                { role: 'user', content: input.user },
            ],
            temperature: input.temperature,
            max_tokens: input.maxOutputTokens, // OpenAI uses max_tokens natively, non max_output_tokens
            ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {})
        }),
        signal: AbortSignal.timeout(config.aiRequestTimeoutMs),
    });

    if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 500);
        throw new Error(`OpenAI HTTP ${response.status}: ${response.statusText}${text ? ` ${text}` : ''}`);
    }

    const payload = await response.json().catch(() => null);
    const outputText = extractOutputText(payload);
    if (!outputText) {
        throw new Error('Risposta AI vuota o non parseabile.');
    }
    return outputText;
}

export async function requestOpenAIEmbeddings(input: string): Promise<number[]> {
    const localEndpoint = isLocalAiEndpoint(config.openaiBaseUrl);
    if (!config.aiAllowRemoteEndpoint && !localEndpoint) {
        throw new Error('Endpoint AI remoto bloccato.');
    }
    if (!config.openaiApiKey && !localEndpoint) {
        throw new Error('OPENAI_API_KEY mancante.');
    }

    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (config.openaiApiKey) {
        headers.authorization = `Bearer ${config.openaiApiKey}`;
    }

    const response = await fetch(safeJoinUrl(config.openaiBaseUrl, '/embeddings'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: config.aiModel,
            input: input,
        }),
        signal: AbortSignal.timeout(config.aiRequestTimeoutMs),
    });

    if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 500);
        throw new Error(`OpenAI Embeddings HTTP ${response.status}: ${response.statusText}${text ? ` ${text}` : ''}`);
    }

    const payload = await response.json().catch(() => null);
    if (payload?.data?.[0]?.embedding) {
        return payload.data[0].embedding as number[];
    }

    // Compatibilità diretta con Ollama native API se non viene esposto formato OpenAI
    if (payload?.embedding && Array.isArray(payload.embedding)) {
        return payload.embedding as number[];
    }

    throw new Error('Risposta API Embeddings malformata.');
}
