/**
 * ml/acceptanceProbability.ts — Modello predittivo per probabilità accettazione invito.
 *
 * Invece di ordinare i lead per lead_score (che misura la qualità del prospect),
 * questo modello predice P(acceptance) — la probabilità che il lead ACCETTI l'invito.
 *
 * Lead con alto P(acceptance) → pending ratio basso → meno rischio ban.
 * Lead con alto lead_score ma basso P(acceptance) → spreco di inviti.
 *
 * Fattori predittivi:
 *   1. Storico acceptance per segmento (job_title simile → stessa acceptance rate)
 *   2. Storico acceptance per lista (alcune liste hanno target migliori)
 *   3. Lead score (proxy per qualità targeting)
 *   4. Presenza dati arricchiti (lead con about/experience → nota migliore → più acceptance)
 *
 * Il modello è Bayesiano: usa prior + dati storici. Con pochi dati → prior neutro.
 * Con molti dati → il modello impara quali segmenti accettano di più.
 */

import { getDatabase } from '../db';
import { logInfo } from '../telemetry/logger';
import { inferLeadSegment } from './segments';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AcceptancePrediction {
    leadId: number;
    probability: number; // 0.0-1.0
    compositeScore: number; // 0-100: combina P(acceptance) + lead_score
    factors: {
        segmentRate: number; // acceptance rate storico per segmento
        listRate: number; // acceptance rate storico per lista
        dataRichness: number; // 0-1: quanto è arricchito il profilo
        leadScore: number; // 0-100: score originale
    };
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface SegmentStats {
    segment: string;
    invited: number;
    accepted: number;
    rate: number;
}

interface ListStats {
    listName: string;
    invited: number;
    accepted: number;
    rate: number;
}

let _segmentCache: Map<string, SegmentStats> | null = null;
let _listCache: Map<string, ListStats> | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 ore

async function loadSegmentStats(): Promise<Map<string, SegmentStats>> {
    const db = await getDatabase();
    const rows = await db.query<{ job_title: string | null; invited: number; accepted: number }>(
        `SELECT job_title, COUNT(*) as invited,
                SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) as accepted
         FROM leads
         WHERE status IN ('INVITED', 'ACCEPTED', 'READY_MESSAGE', 'MESSAGED', 'REPLIED', 'CONNECTED', 'WITHDRAWN')
           AND invited_at IS NOT NULL
         GROUP BY job_title`,
    );

    const map = new Map<string, SegmentStats>();
    for (const row of rows) {
        const segment = inferLeadSegment(row.job_title);
        const existing = map.get(segment) ?? { segment, invited: 0, accepted: 0, rate: 0 };
        existing.invited += row.invited;
        existing.accepted += row.accepted;
        map.set(segment, existing);
    }

    // Calcola rate con Bayesian smoothing (prior: 30% acceptance, peso 10)
    const PRIOR_RATE = 0.3;
    const PRIOR_WEIGHT = 10;
    for (const stats of map.values()) {
        stats.rate = (stats.accepted + PRIOR_RATE * PRIOR_WEIGHT) / (stats.invited + PRIOR_WEIGHT);
    }

    return map;
}

async function loadListStats(): Promise<Map<string, ListStats>> {
    const db = await getDatabase();
    const rows = await db.query<{ list_name: string; invited: number; accepted: number }>(
        `SELECT list_name, COUNT(*) as invited,
                SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) as accepted
         FROM leads
         WHERE status IN ('INVITED', 'ACCEPTED', 'READY_MESSAGE', 'MESSAGED', 'REPLIED', 'CONNECTED', 'WITHDRAWN')
           AND invited_at IS NOT NULL
           AND list_name IS NOT NULL
         GROUP BY list_name`,
    );

    const map = new Map<string, ListStats>();
    const PRIOR_RATE = 0.3;
    const PRIOR_WEIGHT = 10;
    for (const row of rows) {
        map.set(row.list_name, {
            listName: row.list_name,
            invited: row.invited,
            accepted: row.accepted,
            rate: (row.accepted + PRIOR_RATE * PRIOR_WEIGHT) / (row.invited + PRIOR_WEIGHT),
        });
    }

    return map;
}

async function ensureCache(): Promise<void> {
    if (_segmentCache && _listCache && Date.now() - _cacheAt < CACHE_TTL_MS) return;
    [_segmentCache, _listCache] = await Promise.all([loadSegmentStats(), loadListStats()]);
    _cacheAt = Date.now();
}

// ─── Prediction ──────────────────────────────────────────────────────────────

/**
 * Calcola la probabilità di accettazione per un lead.
 * Combina storico segmento + storico lista + ricchezza dati + lead score.
 *
 * compositeScore = P(acceptance) * 60 + (leadScore/100) * 40
 * → peso 60% alla probabilità di accettazione, 40% alla qualità del lead.
 */
export async function predictAcceptance(lead: {
    id: number;
    job_title: string | null;
    list_name: string | null;
    lead_score: number | null;
    about: string | null;
    experience: string | null;
    email?: string | null;
}): Promise<AcceptancePrediction> {
    await ensureCache();

    const segment = inferLeadSegment(lead.job_title);
    const segmentStats = _segmentCache?.get(segment);
    const segmentRate = segmentStats?.rate ?? 0.3; // prior se nessun dato

    const listStats = lead.list_name ? _listCache?.get(lead.list_name) : null;
    const listRate = listStats?.rate ?? 0.3;

    // Data richness: lead con più dati arricchiti → nota AI migliore → più acceptance
    let dataRichness = 0;
    if (lead.about && lead.about.length > 20) dataRichness += 0.3;
    if (lead.experience && lead.experience.length > 20) dataRichness += 0.3;
    if (lead.email) dataRichness += 0.2;
    if (lead.job_title && lead.job_title.length > 5) dataRichness += 0.2;

    const leadScore = lead.lead_score ?? 50;

    // P(acceptance) = media pesata dei fattori
    // segmentRate e listRate sono i più predittivi (dati storici reali)
    const probability = Math.min(
        1,
        Math.max(0, segmentRate * 0.4 + listRate * 0.3 + dataRichness * 0.15 + (leadScore / 100) * 0.15),
    );

    // Composite score: bilancia P(acceptance) con qualità lead
    const compositeScore = Math.round(probability * 60 + (leadScore / 100) * 40);

    return {
        leadId: lead.id,
        probability: Math.round(probability * 1000) / 1000,
        compositeScore: Math.min(100, Math.max(0, compositeScore)),
        factors: {
            segmentRate: Math.round(segmentRate * 1000) / 1000,
            listRate: Math.round(listRate * 1000) / 1000,
            dataRichness: Math.round(dataRichness * 100) / 100,
            leadScore,
        },
    };
}

/**
 * Batch prediction per N lead — usato dallo scheduler per ordinare i candidati.
 */
export async function predictAcceptanceBatch(
    leads: Array<{
        id: number;
        job_title: string | null;
        list_name: string | null;
        lead_score: number | null;
        about: string | null;
        experience: string | null;
        email?: string | null;
    }>,
): Promise<AcceptancePrediction[]> {
    await ensureCache();
    const predictions: AcceptancePrediction[] = [];
    for (const lead of leads) {
        predictions.push(await predictAcceptance(lead));
    }

    await logInfo('acceptance_probability.batch', {
        count: predictions.length,
        avgProbability:
            predictions.length > 0
                ? Math.round((predictions.reduce((s, p) => s + p.probability, 0) / predictions.length) * 1000) / 1000
                : 0,
        avgComposite:
            predictions.length > 0
                ? Math.round(predictions.reduce((s, p) => s + p.compositeScore, 0) / predictions.length)
                : 0,
    });

    return predictions;
}
