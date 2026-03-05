/**
 * abBandit.ts — Multi-Armed Bandit con policy Bayesiana + gate di significativita'
 * Supporta statistiche globali e segmentate.
 */

import { config } from '../config';
import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';
import { computeTwoProportionSignificance } from './significance';

const EPSILON = 0.15;
const BAYES_ALPHA_PRIOR = 1;
const BAYES_BETA_PRIOR = 1;
const BAYES_STD_WEIGHT = 0.75;
const BAYES_EXPLORATION_WEIGHT = 0.05;

export type ABOutcome = 'accepted' | 'replied' | 'ignored';

export interface BanditContext {
    segmentKey?: string;
}

export interface BanditDecisionInputRow {
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
}

export interface SignificantWinnerDecision {
    winnerVariant: string;
    baselineVariant: string;
    pValue: number | null;
    alpha: number;
    minSampleSize: number;
    absoluteLift: number;
}

export interface BanditDecisionSummary {
    selectedVariant: string;
    mode: 'bayes' | 'significant_winner';
    score: number;
    totalSent: number;
    scores: Record<string, number>;
    winner: SignificantWinnerDecision | null;
}

export interface VariantStats {
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
    acceptanceRate: number;
    replyRate: number;
    // Alias legacy mantenuto per compatibilita' frontend.
    ucbScore: number;
    bayesScore: number;
    posteriorMean: number;
    posteriorStd: number;
    significanceWinner: boolean;
}

interface ABStatRow {
    variant_id: string;
    sent: number;
    accepted: number;
    replied: number;
}

interface BayesianPosteriorStats {
    posteriorMean: number;
    posteriorStd: number;
    bayesScore: number;
}

function normalizeCounter(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
}

function normalizeSegmentKey(context?: BanditContext): string {
    const raw = context?.segmentKey?.trim().toLowerCase();
    return raw && raw.length > 0 ? raw : 'global';
}

function toInputRows(rows: ABStatRow[]): BanditDecisionInputRow[] {
    return rows.map((row) => ({
        variantId: row.variant_id,
        sent: normalizeCounter(row.sent),
        accepted: normalizeCounter(row.accepted),
        replied: normalizeCounter(row.replied),
    }));
}

function computePosteriorStats(sent: number, accepted: number, totalSent: number): BayesianPosteriorStats {
    const normalizedSent = normalizeCounter(sent);
    const boundedAccepted = Math.max(0, Math.min(normalizedSent, normalizeCounter(accepted)));
    const alpha = boundedAccepted + BAYES_ALPHA_PRIOR;
    const beta = normalizedSent - boundedAccepted + BAYES_BETA_PRIOR;
    const denominator = alpha + beta;
    const posteriorMean = denominator > 0 ? alpha / denominator : 0;
    const varianceDen = denominator * denominator * (denominator + 1);
    const posteriorVariance = varianceDen > 0 ? (alpha * beta) / varianceDen : 0;
    const posteriorStd = Math.sqrt(Math.max(0, posteriorVariance));
    const explorationBonus =
        Math.sqrt(Math.log(Math.max(totalSent, 2) + 1) / Math.max(1, normalizedSent + 1)) * BAYES_EXPLORATION_WEIGHT;
    const bayesScore = posteriorMean + posteriorStd * BAYES_STD_WEIGHT + explorationBonus;
    return {
        posteriorMean,
        posteriorStd,
        bayesScore,
    };
}

export function computeBayesianBanditScore(sent: number, accepted: number, totalSent: number): number {
    return computePosteriorStats(sent, accepted, totalSent).bayesScore;
}

function pickRandomVariant(variants: string[]): string {
    return variants[Math.floor(Math.random() * variants.length)] as string;
}

function buildStatsMap(rows: BanditDecisionInputRow[]): Map<string, BanditDecisionInputRow> {
    return new Map(rows.map((row) => [row.variantId, row]));
}

function computeRate(success: number, total: number): number {
    if (total <= 0) return 0;
    return success / total;
}

function findSignificantWinner(
    variants: string[],
    rows: BanditDecisionInputRow[],
    alpha: number,
    minSampleSize: number,
): SignificantWinnerDecision | null {
    const statsMap = buildStatsMap(rows);
    const eligible = variants
        .map((variantId) => statsMap.get(variantId))
        .filter((row): row is BanditDecisionInputRow => !!row && row.sent >= minSampleSize);

    if (eligible.length < 2) {
        return null;
    }

    const maxSent = Math.max(...eligible.map((row) => row.sent));
    const baseline = variants
        .map((variantId) => eligible.find((row) => row.variantId === variantId))
        .find((row): row is BanditDecisionInputRow => !!row && row.sent === maxSent);
    if (!baseline) return null;

    const candidates = eligible
        .filter((row) => row.variantId !== baseline.variantId)
        .sort((a, b) => {
            const deltaRate = computeRate(b.accepted, b.sent) - computeRate(a.accepted, a.sent);
            if (deltaRate !== 0) return deltaRate;
            return b.sent - a.sent;
        });

    const baselineRate = computeRate(baseline.accepted, baseline.sent);

    for (const candidate of candidates) {
        const candidateRate = computeRate(candidate.accepted, candidate.sent);
        if (candidateRate <= baselineRate) {
            continue;
        }
        const significance = computeTwoProportionSignificance(
            baseline.accepted,
            baseline.sent,
            candidate.accepted,
            candidate.sent,
            alpha,
        );
        if (!significance.significant) {
            continue;
        }
        return {
            winnerVariant: candidate.variantId,
            baselineVariant: baseline.variantId,
            pValue: significance.pValue,
            alpha,
            minSampleSize,
            absoluteLift: candidateRate - baselineRate,
        };
    }

    return null;
}

export function evaluateBanditDecision(
    variants: string[],
    rows: BanditDecisionInputRow[],
    options?: {
        alpha?: number;
        minSampleSize?: number;
    },
): BanditDecisionSummary {
    if (variants.length === 0) {
        throw new Error('[abBandit] variants array is empty');
    }
    const alpha = Math.min(0.25, Math.max(0.001, options?.alpha ?? config.aiQualitySignificanceAlpha));
    const minSampleSize = Math.max(2, Math.floor(options?.minSampleSize ?? config.aiQualityMinSampleSize));
    const statsMap = buildStatsMap(rows);
    const totalSent = rows.reduce((sum, row) => sum + normalizeCounter(row.sent), 0);
    const scores: Record<string, number> = {};

    let selectedVariant = variants[0] as string;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const variantId of variants) {
        const row = statsMap.get(variantId);
        const bayesScore = computePosteriorStats(row?.sent ?? 0, row?.accepted ?? 0, totalSent).bayesScore;
        scores[variantId] = bayesScore;
        if (bayesScore > bestScore) {
            bestScore = bayesScore;
            selectedVariant = variantId;
        }
    }

    const winner = findSignificantWinner(variants, rows, alpha, minSampleSize);
    if (winner) {
        return {
            selectedVariant: winner.winnerVariant,
            mode: 'significant_winner',
            score: scores[winner.winnerVariant] ?? 0,
            totalSent,
            scores,
            winner,
        };
    }

    return {
        selectedVariant,
        mode: 'bayes',
        score: bestScore,
        totalSent,
        scores,
        winner: null,
    };
}

async function ensureSegmentTable(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS ab_variant_stats_segment (
            segment_key TEXT NOT NULL,
            variant_id  TEXT NOT NULL,
            sent        INTEGER NOT NULL DEFAULT 0,
            accepted    INTEGER NOT NULL DEFAULT 0,
            replied     INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY(segment_key, variant_id)
        );
    `);
}

async function ensureVariantExistsGlobal(
    db: Awaited<ReturnType<typeof getDatabase>>,
    variantId: string,
): Promise<void> {
    await db.run(`INSERT OR IGNORE INTO ab_variant_stats (variant_id) VALUES (?)`, [variantId]);
}

async function ensureVariantExistsSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string,
): Promise<void> {
    await db.run(`INSERT OR IGNORE INTO ab_variant_stats_segment (segment_key, variant_id) VALUES (?, ?)`, [
        segmentKey,
        variantId,
    ]);
}

async function fetchGlobalStats(db: Awaited<ReturnType<typeof getDatabase>>): Promise<ABStatRow[]> {
    return db.query<ABStatRow>(`SELECT variant_id, sent, accepted, replied FROM ab_variant_stats ORDER BY sent DESC`);
}

async function fetchSegmentStats(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
): Promise<ABStatRow[]> {
    return db.query<ABStatRow>(
        `SELECT variant_id, sent, accepted, replied
         FROM ab_variant_stats_segment
         WHERE segment_key = ?
         ORDER BY sent DESC`,
        [segmentKey],
    );
}

export async function selectVariant(variants: string[], context?: BanditContext): Promise<string> {
    if (variants.length === 0) {
        throw new Error('[abBandit] variants array is empty');
    }
    if (variants.length === 1) {
        return variants[0] as string;
    }

    const segmentKey = normalizeSegmentKey(context);

    if (Math.random() < EPSILON) {
        const picked = pickRandomVariant(variants);
        await logInfo('ab_bandit.explore', {
            picked,
            epsilon: EPSILON,
            segment: segmentKey,
        });
        return picked;
    }

    try {
        const db = await getDatabase();
        await ensureSegmentTable(db);
        for (const variant of variants) {
            await ensureVariantExistsGlobal(db, variant);
            if (segmentKey !== 'global') {
                await ensureVariantExistsSegment(db, segmentKey, variant);
            }
        }

        const rows = segmentKey === 'global' ? await fetchGlobalStats(db) : await fetchSegmentStats(db, segmentKey);

        // Se il segmento e' troppo freddo, fallback su globale.
        const segmentTotal = rows.reduce((sum, row) => sum + normalizeCounter(row.sent), 0);
        const effectiveRows =
            segmentKey !== 'global' && segmentTotal < variants.length ? await fetchGlobalStats(db) : rows;
        const decision = evaluateBanditDecision(variants, toInputRows(effectiveRows), {
            alpha: config.aiQualitySignificanceAlpha,
            minSampleSize: config.aiQualityMinSampleSize,
        });

        await logInfo('ab_bandit.exploit', {
            selected: decision.selectedVariant,
            mode: decision.mode,
            score: decision.score,
            totalSent: decision.totalSent,
            segment: segmentKey,
            fallbackToGlobal: segmentKey !== 'global' && effectiveRows !== rows,
            significanceWinner: decision.winner?.winnerVariant ?? null,
            significanceBaseline: decision.winner?.baselineVariant ?? null,
            significancePValue: decision.winner?.pValue ?? null,
            significanceLift: decision.winner ? Math.round(decision.winner.absoluteLift * 10000) / 10000 : null,
        });
        return decision.selectedVariant;
    } catch (err: unknown) {
        await logWarn('[abBandit] DB error, falling back to random', {
            error: err instanceof Error ? err.message : String(err),
            segment: segmentKey,
        });
        return pickRandomVariant(variants);
    }
}

async function incrementSentGlobal(db: Awaited<ReturnType<typeof getDatabase>>, variantId: string): Promise<void> {
    await ensureVariantExistsGlobal(db, variantId);
    await db.run(
        `UPDATE ab_variant_stats
         SET sent = sent + 1, updated_at = datetime('now')
         WHERE variant_id = ?`,
        [variantId],
    );
}

async function incrementOutcomeGlobal(
    db: Awaited<ReturnType<typeof getDatabase>>,
    variantId: string,
    outcome: ABOutcome,
): Promise<void> {
    await ensureVariantExistsGlobal(db, variantId);
    if (outcome === 'ignored') return;
    const column = outcome === 'accepted' ? 'accepted' : 'replied';
    await db.run(
        `UPDATE ab_variant_stats
         SET ${column} = ${column} + 1, updated_at = datetime('now')
         WHERE variant_id = ?`,
        [variantId],
    );
}

async function incrementSentSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string,
): Promise<void> {
    await ensureVariantExistsSegment(db, segmentKey, variantId);
    await db.run(
        `UPDATE ab_variant_stats_segment
         SET sent = sent + 1, updated_at = datetime('now')
         WHERE segment_key = ? AND variant_id = ?`,
        [segmentKey, variantId],
    );
}

async function incrementOutcomeSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string,
    outcome: ABOutcome,
): Promise<void> {
    await ensureVariantExistsSegment(db, segmentKey, variantId);
    if (outcome === 'ignored') return;
    const column = outcome === 'accepted' ? 'accepted' : 'replied';
    await db.run(
        `UPDATE ab_variant_stats_segment
         SET ${column} = ${column} + 1, updated_at = datetime('now')
         WHERE segment_key = ? AND variant_id = ?`,
        [segmentKey, variantId],
    );
}

export async function recordSent(variantId: string, context?: BanditContext): Promise<void> {
    if (!variantId) return;
    const segmentKey = normalizeSegmentKey(context);
    try {
        const db = await getDatabase();
        await ensureSegmentTable(db);
        await incrementSentGlobal(db, variantId);
        if (segmentKey !== 'global') {
            await incrementSentSegment(db, segmentKey, variantId);
        }
    } catch (err: unknown) {
        await logWarn('[abBandit] Failed to record sent', {
            variantId,
            segment: segmentKey,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function recordOutcome(variantId: string, outcome: ABOutcome, context?: BanditContext): Promise<void> {
    if (!variantId) return;
    const segmentKey = normalizeSegmentKey(context);
    try {
        const db = await getDatabase();
        await ensureSegmentTable(db);
        await incrementOutcomeGlobal(db, variantId, outcome);
        if (segmentKey !== 'global') {
            await incrementOutcomeSegment(db, segmentKey, variantId, outcome);
        }
        await logInfo('ab_bandit.outcome_recorded', { variantId, outcome, segment: segmentKey });
    } catch (err: unknown) {
        await logWarn('[abBandit] Failed to record outcome', {
            variantId,
            outcome,
            segment: segmentKey,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function getVariantLeaderboard(context?: BanditContext): Promise<VariantStats[]> {
    const segmentKey = normalizeSegmentKey(context);
    try {
        const db = await getDatabase();
        await ensureSegmentTable(db);
        const rows = segmentKey === 'global' ? await fetchGlobalStats(db) : await fetchSegmentStats(db, segmentKey);
        if (!rows || rows.length === 0) return [];

        const variants = rows.map((row) => row.variant_id);
        const decision = evaluateBanditDecision(variants, toInputRows(rows), {
            alpha: config.aiQualitySignificanceAlpha,
            minSampleSize: config.aiQualityMinSampleSize,
        });
        const winnerVariant = decision.winner?.winnerVariant ?? null;
        const totalSent = rows.reduce((sum, row) => sum + normalizeCounter(row.sent), 0);

        return rows
            .map((row) => {
                const sent = normalizeCounter(row.sent);
                const accepted = Math.max(0, Math.min(sent, normalizeCounter(row.accepted)));
                const replied = Math.max(0, Math.min(sent, normalizeCounter(row.replied)));
                const posterior = computePosteriorStats(sent, accepted, totalSent);
                const acceptanceRate = sent > 0 ? Math.round((accepted / sent) * 1000) / 1000 : 0;
                const replyRate = sent > 0 ? Math.round((replied / sent) * 1000) / 1000 : 0;
                return {
                    variantId: row.variant_id,
                    sent,
                    accepted,
                    replied,
                    acceptanceRate,
                    replyRate,
                    ucbScore: Math.round(posterior.bayesScore * 1000) / 1000,
                    bayesScore: Math.round(posterior.bayesScore * 1000) / 1000,
                    posteriorMean: Math.round(posterior.posteriorMean * 1000) / 1000,
                    posteriorStd: Math.round(posterior.posteriorStd * 1000) / 1000,
                    significanceWinner: winnerVariant === row.variant_id,
                };
            })
            .sort((a, b) => b.bayesScore - a.bayesScore);
    } catch {
        return [];
    }
}
