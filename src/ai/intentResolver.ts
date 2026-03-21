import { isOpenAIConfigured, requestOpenAIText } from './openaiClient';
import { analyzeIncomingMessage, type MessageIntent, type MessageSubIntent } from './sentimentAnalysis';

export interface IntentResolutionResult {
    intent: MessageIntent;
    subIntent: MessageSubIntent;
    entities: string[];
    confidence: number;
    reasoning: string;
    responseDraft: string;
    source: 'ai' | 'fallback';
}

const SYSTEM_PROMPT = `Sei un assistente commerciale B2B LinkedIn.
Analizza il messaggio e restituisci SOLO JSON con:
{
  "intent": "POSITIVE|NEGATIVE|NEUTRAL|QUESTIONS|NOT_INTERESTED|UNKNOWN",
  "subIntent": "CALL_REQUESTED|PRICE_INQUIRY|OBJECTION_HANDLING|COMPETITOR_MENTION|REFERRAL|NONE",
  "entities": ["..."],
  "confidence": 0.0,
  "reasoning": "motivazione breve",
  "responseDraft": "bozza risposta professionale in italiano, max 420 caratteri"
}
Regole:
- niente markdown, niente testo extra
- draft concreto, cortese, contestuale al messaggio
- se NOT_INTERESTED: chiusura elegante senza pressione
- se QUESTIONS: rispondi sintetico e proponi una domanda di chiarimento
- se POSITIVE/CALL_REQUESTED: proponi un prossimo passo pratico.`;

/** @internal */
export function clampConfidence(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
}

/** @internal */
export function normalizeIntent(value: unknown): MessageIntent {
    const normalized = String(value ?? 'UNKNOWN').toUpperCase();
    const allowed: MessageIntent[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'QUESTIONS', 'NOT_INTERESTED', 'UNKNOWN'];
    return allowed.includes(normalized as MessageIntent) ? (normalized as MessageIntent) : 'UNKNOWN';
}

/** @internal */
export function normalizeSubIntent(value: unknown): MessageSubIntent {
    const normalized = String(value ?? 'NONE').toUpperCase();
    const allowed: MessageSubIntent[] = [
        'CALL_REQUESTED',
        'PRICE_INQUIRY',
        'OBJECTION_HANDLING',
        'COMPETITOR_MENTION',
        'REFERRAL',
        'NONE',
    ];
    return allowed.includes(normalized as MessageSubIntent) ? (normalized as MessageSubIntent) : 'NONE';
}

/** @internal */
export function buildFallbackDraft(intent: MessageIntent, text: string): string {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 110);
    if (intent === 'NOT_INTERESTED' || intent === 'NEGATIVE') {
        return 'Grazie della trasparenza. Nessun problema, non ti disturbo oltre. Se in futuro ti fosse utile confrontarti, resto volentieri a disposizione.';
    }
    if (intent === 'QUESTIONS') {
        return `Ottima domanda, grazie. Posso darti un riscontro mirato sul punto "${snippet}". Ti è più utile una risposta qui in chat o preferisci un rapido confronto di 10 minuti?`;
    }
    if (intent === 'POSITIVE') {
        return 'Perfetto, volentieri. Per essere concreti posso condividere un esempio pratico e poi valutiamo se ha senso approfondire. Ti va bene sentirci nei prossimi giorni?';
    }
    return 'Grazie per il messaggio. Se vuoi, ti condivido in modo sintetico come lavoriamo e capiamo subito se può avere senso per il tuo contesto.';
}

export async function resolveIntentAndDraft(messageText: string): Promise<IntentResolutionResult> {
    const trimmed = messageText.trim();
    if (!trimmed) {
        return {
            intent: 'UNKNOWN',
            subIntent: 'NONE',
            entities: [],
            confidence: 0,
            reasoning: 'messaggio_vuoto',
            responseDraft: '',
            source: 'fallback',
        };
    }

    if (!isOpenAIConfigured()) {
        const sentiment = await analyzeIncomingMessage(trimmed);
        return {
            intent: sentiment.intent,
            subIntent: sentiment.subIntent,
            entities: sentiment.entities,
            confidence: sentiment.confidence,
            reasoning: sentiment.reasoning,
            responseDraft: buildFallbackDraft(sentiment.intent, trimmed),
            source: 'fallback',
        };
    }

    try {
        const output = await requestOpenAIText({
            system: SYSTEM_PROMPT,
            user: `Messaggio:\n${trimmed}`,
            maxOutputTokens: 320,
            temperature: 0.2,
            responseFormat: 'json_object',
        });
        const parsed = JSON.parse(output) as {
            intent?: unknown;
            subIntent?: unknown;
            entities?: unknown;
            confidence?: unknown;
            reasoning?: unknown;
            responseDraft?: unknown;
        };

        const intent = normalizeIntent(parsed.intent);
        const subIntent = normalizeSubIntent(parsed.subIntent);
        const entities = Array.isArray(parsed.entities)
            ? parsed.entities
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.toLowerCase().trim())
                  .filter((item) => item.length > 0)
                  .slice(0, 20)
            : [];
        const responseDraft =
            typeof parsed.responseDraft === 'string'
                ? parsed.responseDraft.replace(/\s+/g, ' ').trim().slice(0, 420)
                : '';
        if (responseDraft.length < 12) {
            throw new Error('response_draft_too_short');
        }

        return {
            intent,
            subIntent,
            entities,
            confidence: clampConfidence(parsed.confidence, 0.7),
            reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : 'ai_resolution',
            responseDraft,
            source: 'ai',
        };
    } catch {
        const sentiment = await analyzeIncomingMessage(trimmed);
        return {
            intent: sentiment.intent,
            subIntent: sentiment.subIntent,
            entities: sentiment.entities,
            confidence: clampConfidence(sentiment.confidence, 0.6),
            reasoning: sentiment.reasoning,
            responseDraft: buildFallbackDraft(sentiment.intent, trimmed),
            source: 'fallback',
        };
    }
}
