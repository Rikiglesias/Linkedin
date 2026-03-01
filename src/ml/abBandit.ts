/**
 * abBandit.ts — Multi-Armed Bandit con strategia Epsilon-Greedy + UCB
 * Supporta statistiche globali e segmentate.
 */

import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';

const EPSILON = 0.15;
const MIN_SENT_FOR_UCB = 3;

export type ABOutcome = 'accepted' | 'replied' | 'ignored';

export interface BanditContext {
    segmentKey?: string;
}

export interface VariantStats {
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
    acceptanceRate: number;
    replyRate: number;
    ucbScore: number;
}

interface ABStatRow {
    variant_id: string;
    sent: number;
    accepted: number;
    replied: number;
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

function normalizeSegmentKey(context?: BanditContext): string {
    const raw = context?.segmentKey?.trim().toLowerCase();
    return raw && raw.length > 0 ? raw : 'global';
}

function computeUCB(sent: number, accepted: number, totalSent: number): number {
    if (sent < MIN_SENT_FOR_UCB || totalSent <= 0) {
        return 1.0;
    }
    const exploitationTerm = sent > 0 ? accepted / sent : 0;
    const explorationTerm = Math.sqrt((2 * Math.log(Math.max(totalSent, 1))) / sent);
    return exploitationTerm + explorationTerm;
}

async function ensureVariantExistsGlobal(
    db: Awaited<ReturnType<typeof getDatabase>>,
    variantId: string
): Promise<void> {
    await db.run(
        `INSERT OR IGNORE INTO ab_variant_stats (variant_id) VALUES (?)`,
        [variantId]
    );
}

async function ensureVariantExistsSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string
): Promise<void> {
    await db.run(
        `INSERT OR IGNORE INTO ab_variant_stats_segment (segment_key, variant_id) VALUES (?, ?)`,
        [segmentKey, variantId]
    );
}

async function fetchGlobalStats(db: Awaited<ReturnType<typeof getDatabase>>): Promise<ABStatRow[]> {
    return db.query<ABStatRow>(
        `SELECT variant_id, sent, accepted, replied FROM ab_variant_stats ORDER BY sent DESC`
    );
}

async function fetchSegmentStats(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string
): Promise<ABStatRow[]> {
    return db.query<ABStatRow>(
        `SELECT variant_id, sent, accepted, replied
         FROM ab_variant_stats_segment
         WHERE segment_key = ?
         ORDER BY sent DESC`,
        [segmentKey]
    );
}

function pickRandomVariant(variants: string[]): string {
    return variants[Math.floor(Math.random() * variants.length)] as string;
}

function selectByUcb(variants: string[], rows: ABStatRow[]): { variant: string; score: number; totalSent: number } {
    const totalSent = rows.reduce((sum, row) => sum + row.sent, 0);
    let bestVariant = variants[0] as string;
    let bestUcb = -Infinity;
    for (const variantId of variants) {
        const row = rows.find((entry) => entry.variant_id === variantId);
        const sent = row?.sent ?? 0;
        const accepted = row?.accepted ?? 0;
        const ucb = computeUCB(sent, accepted, totalSent);
        if (ucb > bestUcb) {
            bestUcb = ucb;
            bestVariant = variantId;
        }
    }
    return { variant: bestVariant, score: bestUcb, totalSent };
}

export async function selectVariant(variants: string[], context?: BanditContext): Promise<string> {
    if (variants.length === 0) {
        throw new Error('[abBandit] variants array is empty');
    }
    if (variants.length === 1) {
        return variants[0] as string;
    }

    if (Math.random() < EPSILON) {
        const picked = pickRandomVariant(variants);
        await logInfo('ab_bandit.explore', {
            picked,
            epsilon: EPSILON,
            segment: normalizeSegmentKey(context),
        });
        return picked;
    }

    const segmentKey = normalizeSegmentKey(context);

    try {
        const db = await getDatabase();
        await ensureSegmentTable(db);
        for (const variant of variants) {
            await ensureVariantExistsGlobal(db, variant);
            if (segmentKey !== 'global') {
                await ensureVariantExistsSegment(db, segmentKey, variant);
            }
        }

        const rows = segmentKey === 'global'
            ? await fetchGlobalStats(db)
            : await fetchSegmentStats(db, segmentKey);

        // Se il segmento è troppo freddo, fallback su globale.
        const segmentTotal = rows.reduce((sum, row) => sum + row.sent, 0);
        const effectiveRows = (segmentKey !== 'global' && segmentTotal < variants.length)
            ? await fetchGlobalStats(db)
            : rows;
        const picked = selectByUcb(variants, effectiveRows);

        await logInfo('ab_bandit.exploit', {
            selected: picked.variant,
            ucbScore: picked.score,
            totalSent: picked.totalSent,
            segment: segmentKey,
            fallbackToGlobal: segmentKey !== 'global' && effectiveRows !== rows,
        });
        return picked.variant;
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
        [variantId]
    );
}

async function incrementOutcomeGlobal(
    db: Awaited<ReturnType<typeof getDatabase>>,
    variantId: string,
    outcome: ABOutcome
): Promise<void> {
    await ensureVariantExistsGlobal(db, variantId);
    if (outcome === 'ignored') return;
    const column = outcome === 'accepted' ? 'accepted' : 'replied';
    await db.run(
        `UPDATE ab_variant_stats
         SET ${column} = ${column} + 1, updated_at = datetime('now')
         WHERE variant_id = ?`,
        [variantId]
    );
}

async function incrementSentSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string
): Promise<void> {
    await ensureVariantExistsSegment(db, segmentKey, variantId);
    await db.run(
        `UPDATE ab_variant_stats_segment
         SET sent = sent + 1, updated_at = datetime('now')
         WHERE segment_key = ? AND variant_id = ?`,
        [segmentKey, variantId]
    );
}

async function incrementOutcomeSegment(
    db: Awaited<ReturnType<typeof getDatabase>>,
    segmentKey: string,
    variantId: string,
    outcome: ABOutcome
): Promise<void> {
    await ensureVariantExistsSegment(db, segmentKey, variantId);
    if (outcome === 'ignored') return;
    const column = outcome === 'accepted' ? 'accepted' : 'replied';
    await db.run(
        `UPDATE ab_variant_stats_segment
         SET ${column} = ${column} + 1, updated_at = datetime('now')
         WHERE segment_key = ? AND variant_id = ?`,
        [segmentKey, variantId]
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
        const rows = segmentKey === 'global'
            ? await fetchGlobalStats(db)
            : await fetchSegmentStats(db, segmentKey);
        if (!rows || rows.length === 0) return [];
        const totalSent = rows.reduce((sum, row) => sum + row.sent, 0);
        return rows.map((row) => ({
            variantId: row.variant_id,
            sent: row.sent,
            accepted: row.accepted,
            replied: row.replied,
            acceptanceRate: row.sent > 0 ? Math.round((row.accepted / row.sent) * 100) / 100 : 0,
            replyRate: row.sent > 0 ? Math.round((row.replied / row.sent) * 100) / 100 : 0,
            ucbScore: Math.round(computeUCB(row.sent, row.accepted, totalSent) * 1000) / 1000,
        })).sort((a, b) => b.acceptanceRate - a.acceptanceRate);
    } catch {
        return [];
    }
}
