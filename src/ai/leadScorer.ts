import { requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';

export interface LeadScoreResult {
    confidenceScore: number;
    leadScore: number;
    reason: string;
}

const DEFAULT_SCORING_CRITERIA =
    'Alta per CEO/Founder/Dirigenti/Manager, Mezza per dipendenti base, Bassa per studenti/intern/pensionati';

export interface ScoreLeadOptions {
    scoringCriteria?: string | null;
}

export async function scoreLeadProfile(
    accountName: string,
    fullName: string,
    headline: string | null,
    options?: ScoreLeadOptions,
): Promise<LeadScoreResult> {
    const rawHeadline = (headline || '').trim();

    if (!rawHeadline) {
        return {
            confidenceScore: 30,
            leadScore: 20,
            reason: 'MISSING_HEADLINE_OR_ROLE',
        };
    }

    const criteria = options?.scoringCriteria?.trim() || DEFAULT_SCORING_CRITERIA;

    const systemPrompt = `Sei un esperto classificatore B2B. L'utente cerca lead validi nell'azienda target.
Devi analizzare i dati del lead (nome, qualifica/headline, azienda cercata) e fornire in output UNO JSON RIGIDO.
Valuta 2 parametri su base 1-100:
1. "confidenceScore": quanto sei certo che questa persona lavori davvero nell'azienda target oggi? (Penalizza "ex account name", ologrammi o "student at...").
2. "leadScore": quanto è "buono" questo prospect per il B2B? (${criteria}).
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

        const rawJsonText = generated
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const parsed = JSON.parse(rawJsonText);

        const rawConfidence = Number(parsed.confidenceScore);
        const rawLead = Number(parsed.leadScore);
        return {
            confidenceScore: Math.min(100, Math.max(0, Number.isFinite(rawConfidence) ? rawConfidence : 50)),
            leadScore: Math.min(100, Math.max(0, Number.isFinite(rawLead) ? rawLead : 50)),
            reason: String(parsed.reason || 'UNKNOWN')
                .toUpperCase()
                .replace(/[^A-Z_]/g, ''),
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

/**
 * M06: Batch scoring con concurrency controllata.
 * Processa N lead in parallelo con max `concurrency` chiamate API simultanee.
 * 200 lead con concurrency 5 → ~40 batch × ~2s = ~80s (vs 400s sequenziale).
 */
export async function scoreLeadsBatch(
    leads: Array<{ accountName: string; fullName: string; headline: string | null }>,
    options?: ScoreLeadOptions & { concurrency?: number },
): Promise<LeadScoreResult[]> {
    const concurrency = Math.max(1, Math.min(options?.concurrency ?? 5, 10));
    const results: LeadScoreResult[] = new Array(leads.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
        while (true) {
            const idx = cursor++;
            if (idx >= leads.length) return;
            const lead = leads[idx];
            results[idx] = await scoreLeadProfile(
                lead.accountName,
                lead.fullName,
                lead.headline,
                options,
            );
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, () => worker()));
    return results;
}
