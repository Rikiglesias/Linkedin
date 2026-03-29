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
 * GAP 2: Re-scoring periodico per lead stale.
 * Lead INVITED da >30 giorni che non hanno accettato → il punteggio potrebbe essere obsoleto.
 * Ricalcola il score e aggiorna nel DB. Chiamato dal scheduler o come job periodico.
 */
export async function rescoreStaleLeads(
    options?: ScoreLeadOptions & {
        maxAgeDays?: number;
        limit?: number;
        concurrency?: number;
    },
): Promise<{ rescored: number; updated: number }> {
    const maxAgeDays = options?.maxAgeDays ?? 30;
    const limit = options?.limit ?? 50;

    try {
        const { getDatabase } = await import('../db');
        const db = await getDatabase();

        const staleLeads = await db.query<{
            id: number;
            account_name: string;
            first_name: string;
            last_name: string;
            job_title: string | null;
            lead_score: number | null;
        }>(
            `SELECT id, account_name, first_name, last_name, job_title, lead_score
             FROM leads
             WHERE status = 'INVITED'
               AND invited_at < datetime('now', '-' || ? || ' days')
               AND (lead_score_updated_at IS NULL OR lead_score_updated_at < datetime('now', '-' || ? || ' days'))
             ORDER BY invited_at ASC
             LIMIT ?`,
            [maxAgeDays, maxAgeDays, limit],
        );

        if (staleLeads.length === 0) return { rescored: 0, updated: 0 };

        const batchInput = staleLeads.map((l) => ({
            accountName: l.account_name ?? '',
            fullName: `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim(),
            headline: l.job_title,
        }));

        const results = await scoreLeadsBatch(batchInput, {
            concurrency: options?.concurrency ?? 3,
            scoringCriteria: options?.scoringCriteria,
        });

        let updated = 0;
        for (let i = 0; i < staleLeads.length; i++) {
            const lead = staleLeads[i];
            const result = results[i];
            if (!lead || !result) continue;

            const oldScore = lead.lead_score ?? 0;
            const newScore = result.leadScore;

            // Aggiorna solo se il score è cambiato significativamente (±10 punti)
            if (Math.abs(newScore - oldScore) >= 10) {
                await db.run(`UPDATE leads SET lead_score = ?, lead_score_updated_at = datetime('now') WHERE id = ?`, [
                    newScore,
                    lead.id,
                ]);
                updated++;
            } else {
                // Marca come ri-valutato anche se non cambiato (evita re-processing)
                await db.run(`UPDATE leads SET lead_score_updated_at = datetime('now') WHERE id = ?`, [lead.id]);
            }
        }

        return { rescored: staleLeads.length, updated };
    } catch (err) {
        await logWarn('lead_scorer.rescore_stale_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        return { rescored: 0, updated: 0 };
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
            results[idx] = await scoreLeadProfile(lead.accountName, lead.fullName, lead.headline, options);
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, () => worker()));
    return results;
}
