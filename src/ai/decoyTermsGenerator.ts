/**
 * ai/decoyTermsGenerator.ts
 * ─────────────────────────────────────────────────────────────────
 * R06: Genera decoy search terms context-aware basandosi sui lead target.
 *
 * - Se AI configurata → chiama OpenAI per generare termini coerenti col settore
 * - Se AI non configurata → fallback meccanico: estrae keyword da job_title/account_name
 * - Cache per sessione: genera una volta, riusa per tutta la sessione
 * - Zero regressione: se tutto fallisce, ritorna undefined (i decoy usano la lista hardcoded)
 */

import { isOpenAIConfigured, requestOpenAIText } from './openaiClient';
import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

const GENERATION_TIMEOUT_MS = 10_000;

// ── Stopwords da filtrare nel fallback meccanico ───────────────────────
const STOPWORDS = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'at',
    'in',
    'for',
    'to',
    'on',
    'with',
    'by',
    'is',
    'it',
    'as',
    'from',
    'that',
    'this',
    'was',
    'are',
    'be',
    'has',
    'had',
    'have',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'not',
    'no',
    'but',
    'if',
    'so',
    'up',
    'out',
    'about',
    'into',
    'over',
    'after',
    // Common filler words in LinkedIn titles
    'senior',
    'junior',
    'lead',
    'staff',
    'principal',
    'associate',
    'assistant',
    'intern',
    'trainee',
    'freelance',
    'self-employed',
    'retired',
    'looking',
    'seeking',
    'open',
    'new',
    'former',
    'ex',
    'current',
    'acting',
    'interim',
    'deputy',
    'chief',
    'head',
    'global',
    'regional',
    'local',
    'national',
    'international',
]);

/**
 * Genera decoy search terms context-aware per una sessione.
 *
 * @param leadSamples Array di { jobTitle, company } dai lead attivi
 * @returns Array di 10-15 termini coerenti col settore, o undefined se fallisce
 */
export async function generateContextualDecoyTerms(
    leadSamples: ReadonlyArray<{ jobTitle?: string | null; company?: string | null }>,
): Promise<readonly string[] | undefined> {
    if (leadSamples.length === 0) {
        return undefined;
    }

    // Deduplicazione e pulizia input
    const titles = [
        ...new Set(leadSamples.map((s) => s.jobTitle?.trim()).filter((t): t is string => !!t && t.length > 2)),
    ].slice(0, 30);

    const companies = [
        ...new Set(leadSamples.map((s) => s.company?.trim()).filter((c): c is string => !!c && c.length > 1)),
    ].slice(0, 20);

    if (titles.length === 0 && companies.length === 0) {
        return undefined;
    }

    // Tenta AI, poi fallback meccanico
    if (config.aiPersonalizationEnabled && isOpenAIConfigured()) {
        try {
            const aiTerms = await generateWithAI(titles, companies);
            if (aiTerms && aiTerms.length >= 5) {
                await logInfo('decoy_terms.ai_generated', {
                    count: aiTerms.length,
                    sampleTitles: titles.slice(0, 3),
                });
                return aiTerms;
            }
        } catch (err) {
            await logWarn('decoy_terms.ai_failed_fallback_mechanical', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Fallback meccanico
    const mechanical = generateMechanical(titles, companies);
    if (mechanical.length >= 3) {
        await logInfo('decoy_terms.mechanical_generated', {
            count: mechanical.length,
            sampleTitles: titles.slice(0, 3),
        });
        return mechanical;
    }

    return undefined;
}

// ── AI Generation ──────────────────────────────────────────────────────

async function generateWithAI(titles: string[], companies: string[]): Promise<readonly string[] | undefined> {
    const titlesBlock = titles.slice(0, 15).join(', ');
    const companiesBlock = companies.slice(0, 10).join(', ');

    const system = `You generate LinkedIn search terms for market research.
Given a list of job titles and companies that a user is targeting, generate 12-15 realistic LinkedIn search queries that someone in the same industry would naturally search for.
The terms should be COHERENT with the target sector — if targeting finance CEOs, suggest terms like "CFO", "investment banking", "financial advisor", NOT "agritech" or "biotech".
Mix: ~40% role titles, ~30% industry/sector terms, ~30% skills/tools relevant to the sector.
Return ONLY a JSON array of strings, no explanation.`;

    const user = `Target job titles: ${titlesBlock}
${companiesBlock ? `Target companies: ${companiesBlock}` : ''}
Generate 12-15 search terms coherent with this sector.`;

    const raw = await Promise.race([
        requestOpenAIText({
            system,
            user,
            maxOutputTokens: 300,
            temperature: 0.8,
            responseFormat: 'json_object',
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('decoy_terms AI timeout')), GENERATION_TIMEOUT_MS),
        ),
    ]);

    // Parse JSON — accetta sia array diretto che { terms: [...] }
    try {
        const parsed = JSON.parse(raw);
        let terms: unknown[];
        if (Array.isArray(parsed)) {
            terms = parsed;
        } else if (parsed && typeof parsed === 'object') {
            const firstArrayValue = Object.values(parsed).find((v) => Array.isArray(v));
            terms = Array.isArray(firstArrayValue) ? firstArrayValue : [];
        } else {
            return undefined;
        }

        return terms
            .filter((t): t is string => typeof t === 'string' && t.trim().length >= 2)
            .map((t) => t.trim().toLowerCase())
            .slice(0, 15);
    } catch {
        return undefined;
    }
}

// ── Mechanical Fallback ────────────────────────────────────────────────

function generateMechanical(titles: string[], companies: string[]): readonly string[] {
    const termSet = new Set<string>();

    // Estrai keyword significative dai titoli
    for (const title of titles) {
        const words = title
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w));

        // Singole parole significative
        for (const word of words) {
            if (word.length >= 3) {
                termSet.add(word);
            }
        }

        // Bigrammi (es. "product manager", "data scientist")
        for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            if (bigram.length >= 6) {
                termSet.add(bigram);
            }
        }
    }

    // Aggiungi nomi azienda come termini di ricerca
    for (const company of companies) {
        const clean = company.trim().toLowerCase();
        if (clean.length >= 2 && clean.length <= 40) {
            termSet.add(clean);
        }
    }

    // Filtra termini troppo generici o troppo corti
    const filtered = [...termSet].filter((t) => t.length >= 3 && t.length <= 50).slice(0, 15);

    return filtered;
}
