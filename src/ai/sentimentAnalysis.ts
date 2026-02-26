import { config } from '../config';
import { requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';

export type MessageIntent = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'QUESTIONS' | 'NOT_INTERESTED' | 'UNKNOWN';

export interface SentimentAnalysisResult {
    intent: MessageIntent;
    confidence: number;
    reasoning: string;
}

const SYSTEM_PROMPT = `Sei un esperto classificatore NLP di messaggi B2B LinkedIn in italiano.
La tua task è analizzare il messaggio in ingresso e restituire UNICAMENTE un JSON valido con questa struttura esatta:
{
  "intent": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "QUESTIONS" | "NOT_INTERESTED",
  "confidence": <numero tra 0 e 1>,
  "reasoning": "<breve motivazione della scelta>"
}

DEFINIZIONI DEGLI INTENT:
- POSITIVE: L'utente esprime chiaro interesse, propone una call, accetta esplicitamente o usa toni entusiasti.
- NEGATIVE: L'utente si lamenta, si inalbera, è scocciato dal messaggio, risponde con aggressività.
- NEUTRAL: L'utente saluta "Grazie per il collegamento" e nient'altro, o risponde con pollici/ok senza particolare slancio.
- QUESTIONS: L'utente fa domande specifiche sul servizio/prodotto o su chi sei, necessita di più info prima di decidere.
- NOT_INTERESTED: L'utente declina l'offerta ("Non mi interessa", "Siamo già a posto", "No grazie").

Regola fondamentale: NESSUN TESTO FUORI DAL JSON. Il tuo output DEVE essere parsabile da JSON.parse().`;

export async function analyzeIncomingMessage(messageText: string): Promise<SentimentAnalysisResult> {
    if (config.inviteNoteMode !== 'ai' || !config.openaiApiKey) {
        return {
            intent: 'UNKNOWN',
            confidence: 0,
            reasoning: 'AI non configurata o disabilitata per il NLP Inbound.',
        };
    }

    if (!messageText || messageText.trim().length === 0) {
        return {
            intent: 'NEUTRAL',
            confidence: 1,
            reasoning: 'Messaggio vuoto o nullo.',
        };
    }

    try {
        const responseText = await requestOpenAIText({
            system: SYSTEM_PROMPT,
            user: `Analizza questo messaggio: "${messageText}"`,
            maxOutputTokens: 150,
            temperature: 0.1, // temperatura bassa per output deterministico JSON
            responseFormat: 'json_object' // Richiede OpenAI tier recente, altrimenti fallback
        });

        // Pulizia base se LLM formatta con markdown
        const cleanedJsonString = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleanedJsonString);

        return {
            intent: parsed.intent || 'UNKNOWN',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            reasoning: parsed.reasoning || 'Parsing riuscito ma campi mancanti.',
        };
    } catch (error) {
        await logWarn('ai.sentiment_analysis.failed', {
            error: error instanceof Error ? error.message : String(error),
            messageSnippet: messageText.substring(0, 50)
        });

        return {
            intent: 'UNKNOWN',
            confidence: 0,
            reasoning: 'Errore generico durante la richiesta LLM o il parsing JSON.',
        };
    }
}
