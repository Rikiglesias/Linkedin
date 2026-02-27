import { requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';

export interface LeadScoreResult {
    confidenceScore: number;
    leadScore: number;
    reason: string;
}

export async function scoreLeadProfile(
    accountName: string,
    fullName: string,
    headline: string | null
): Promise<LeadScoreResult> {
    const rawHeadline = (headline || '').trim();

    // Se non troviamo una vera descrizione del lavoro usiamo un default di incertezza
    if (!rawHeadline) {
        return {
            confidenceScore: 30,
            leadScore: 20,
            reason: 'MISSING_HEADLINE_OR_ROLE',
        };
    }

    const systemPrompt = `Sei un esperto classificatore B2B. L'utente cerca lead validi nell'azienda target.
Devi analizzare i dati del lead (nome, qualifica/headline, azienda cercata) e fornire in output UNO JSON RIGIDO.
Valuta 2 parametri su base 1-100:
1. "confidenceScore": quanto sei certo che questa persona lavori davvero nell'azienda target oggi? (Penalizza "ex account name", ologrammi o "student at...").
2. "leadScore": quanto è "buono" questo prospect per il B2B? (Alta per CEO/Founder/Dirigenti/Manager, Mezza per dipendenti base, Bassa per studenti/intern/pensionati).
3. "reason": una brevissima stringa esplicativa (no spazi, stile UPPER_SNAKE_CASE es. "HIGH_VALUE_EXECUTIVE", "LOW_VALUE_INTERN", "POSSIBLE_EX_EMPLOYEE").

Rispondi SOLO con JSON. Esempio:
{
  "confidenceScore": 85,
  "leadScore": 90,
  "reason": "DECISION_MAKER"
}`;

    const userPrompt = JSON.stringify({
        targetCompany: accountName,
        personName: fullName,
        headline: rawHeadline,
    });

    try {
        const generated = await requestOpenAIText({
            system: systemPrompt,
            user: userPrompt,
            maxOutputTokens: 150,
            temperature: 0.1,
        });

        const rawJsonText = generated.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(rawJsonText);

        return {
            confidenceScore: Math.min(100, Math.max(0, Number(parsed.confidenceScore) || 50)),
            leadScore: Math.min(100, Math.max(0, Number(parsed.leadScore) || 50)),
            reason: String(parsed.reason || 'UNKNOWN').toUpperCase().replace(/[^A-Z_]/g, ''),
        };
    } catch (error) {
        await logWarn('ai.lead_scorer.failed', {
            personName: fullName,
            error: error instanceof Error ? error.message : String(error),
        });
        // In caso di errore API, diamo punteggi medi per non bloccare tutto a zero
        return {
            confidenceScore: 50,
            leadScore: 50,
            reason: 'API_ERROR_FALLBACK',
        };
    }
}
