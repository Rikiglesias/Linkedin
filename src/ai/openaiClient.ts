import { config } from '../config';

interface OpenAITextRequest {
    system: string;
    user: string;
    maxOutputTokens: number;
    temperature: number;
}

function safeJoinUrl(baseUrl: string, suffix: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function extractOutputText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const direct = (payload as { output_text?: unknown }).output_text;
    if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
    }

    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) {
        return '';
    }

    const fragments: string[] = [];
    for (const item of output) {
        if (!item || typeof item !== 'object') continue;
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            const type = (block as { type?: unknown }).type;
            if (type !== 'output_text') continue;
            const text = (block as { text?: unknown }).text;
            if (typeof text === 'string' && text.trim()) {
                fragments.push(text.trim());
            }
        }
    }

    return fragments.join('\n').trim();
}

export function isOpenAIConfigured(): boolean {
    return !!config.openaiApiKey;
}

export async function requestOpenAIText(input: OpenAITextRequest): Promise<string> {
    if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY mancante.');
    }

    const response = await fetch(safeJoinUrl(config.openaiBaseUrl, '/responses'), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
            model: config.aiModel,
            input: [
                { role: 'system', content: input.system },
                { role: 'user', content: input.user },
            ],
            temperature: input.temperature,
            max_output_tokens: input.maxOutputTokens,
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

