/**
 * abBandit.ts — Multi-Armed Bandit con strategia Epsilon-Greedy
 *
 * Seleziona adattativamente la variante di nota migliore tra quelle disponibili.
 * - ε = 0.15 → 15% dei casi esplora una variante casuale
 * - 85% dei casi sfrutta la variante con highest UCB score
 *
 * UCB (Upper Confidence Bound):
 *   ucb(v) = acceptanceRate(v) + √(2 * ln(totalSent) / sent(v))
 *
 * UCB favorisce varianti con poca storia (alta incertezza),
 * bilanciando exploration in modo più intelligente del puro random.
 *
 * Tutto persistito in SQLite → `ab_variant_stats` (migration 015).
 * Se il DB fallisce per qualsiasi ragione → fallback a selezione casuale.
 */

import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Costanti ─────────────────────────────────────────────────────────────────

const EPSILON = 0.15; // 15% exploration rate
const MIN_SENT_FOR_UCB = 3; // Sotto questa soglia usa UCB bonus massimo

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type ABOutcome = 'accepted' | 'replied' | 'ignored';

export interface VariantStats {
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
    acceptanceRate: number;
    replyRate: number;
    ucbScore: number;
}

// ─── Helpers DB ───────────────────────────────────────────────────────────────

interface ABStatRow {
    variant_id: string;
    sent: number;
    accepted: number;
    replied: number;
}

async function fetchAllStats(db: Awaited<ReturnType<typeof getDatabase>>): Promise<ABStatRow[]> {
    return db.query<ABStatRow>(
        `SELECT variant_id, sent, accepted, replied FROM ab_variant_stats ORDER BY sent DESC`
    );
}

async function ensureVariantExists(
    db: Awaited<ReturnType<typeof getDatabase>>,
    variantId: string
): Promise<void> {
    await db.run(
        `INSERT OR IGNORE INTO ab_variant_stats (variant_id) VALUES (?)`,
        [variantId]
    );
}

// ─── UCB Score ────────────────────────────────────────────────────────────────

function computeUCB(sent: number, accepted: number, totalSent: number): number {
    if (sent < MIN_SENT_FOR_UCB || totalSent <= 0) {
        return 1.0; // Massima priorità per varianti inesplorate
    }
    const exploitationTerm = sent > 0 ? accepted / sent : 0;
    const explorationTerm = Math.sqrt((2 * Math.log(Math.max(totalSent, 1))) / sent);
    return exploitationTerm + explorationTerm;
}

// ─── API Pubblica ─────────────────────────────────────────────────────────────

/**
 * Seleziona la variante ottimale da un elenco, usando epsilon-greedy + UCB.
 * @param variants Lista di variant ID (es. ['aggressive', 'friendly', 'question'])
 * @returns Il variant ID selezionato
 */
export async function selectVariant(variants: string[]): Promise<string> {
    if (variants.length === 0) throw new Error('[abBandit] variants array is empty');
    if (variants.length === 1) return variants[0];

    // ε-greedy: con prob EPSILON esplora casualmente
    if (Math.random() < EPSILON) {
        const picked = variants[Math.floor(Math.random() * variants.length)];
        await logInfo('ab_bandit.explore', { picked, epsilon: EPSILON });
        return picked;
    }

    try {
        const db = await getDatabase();

        // Assicura che tutte le varianti esistano nel DB
        for (const v of variants) {
            await ensureVariantExists(db, v);
        }

        const rows = await fetchAllStats(db);
        const totalSent = rows.reduce((s, r) => s + r.sent, 0);

        // Calcola UCB per ogni variante richiesta
        let bestVariant = variants[0];
        let bestUCB = -Infinity;

        for (const variantId of variants) {
            const row = rows.find(r => r.variant_id === variantId);
            const sent = row?.sent ?? 0;
            const accepted = row?.accepted ?? 0;
            const ucb = computeUCB(sent, accepted, totalSent);

            if (ucb > bestUCB) {
                bestUCB = ucb;
                bestVariant = variantId;
            }
        }

        await logInfo('ab_bandit.exploit', { selected: bestVariant, ucbScore: bestUCB, totalSent });
        return bestVariant;

    } catch (err: unknown) {
        await logWarn('[abBandit] DB error, falling back to random', {
            error: err instanceof Error ? err.message : String(err),
        });
        return variants[Math.floor(Math.random() * variants.length)];
    }
}

/**
 * Registra l'esito di una variante (dopo accettazione o reply rilevata).
 * @param variantId  ID della variante usata
 * @param outcome    'accepted' | 'replied' | 'ignored'
 */
export async function recordOutcome(variantId: string, outcome: ABOutcome): Promise<void> {
    if (!variantId) return;

    try {
        const db = await getDatabase();
        await ensureVariantExists(db, variantId);

        if (outcome === 'ignored') {
            // Solo incrementa sent (già fatto al momento dell'invio)
            return;
        }

        const column = outcome === 'accepted' ? 'accepted' : 'replied';
        await db.run(
            `UPDATE ab_variant_stats
             SET ${column} = ${column} + 1, updated_at = datetime('now')
             WHERE variant_id = ?`,
            [variantId]
        );

        await logInfo('ab_bandit.outcome_recorded', { variantId, outcome });
    } catch (err: unknown) {
        await logWarn('[abBandit] Failed to record outcome', {
            variantId,
            outcome,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Incrementa il contatore "sent" per una variante (chiamato al momento dell'invio).
 */
export async function recordSent(variantId: string): Promise<void> {
    if (!variantId) return;

    try {
        const db = await getDatabase();
        await ensureVariantExists(db, variantId);
        await db.run(
            `UPDATE ab_variant_stats
             SET sent = sent + 1, updated_at = datetime('now')
             WHERE variant_id = ?`,
            [variantId]
        );
    } catch (err: unknown) {
        await logWarn('[abBandit] Failed to record sent', {
            variantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Restituisce tutte le statistiche delle varianti con UCB score.
 * Usato dal daily reporter.
 */
export async function getVariantLeaderboard(): Promise<VariantStats[]> {
    try {
        const db = await getDatabase();
        const rows = await fetchAllStats(db);
        if (!rows || rows.length === 0) return [];

        const totalSent = rows.reduce((s, r) => s + r.sent, 0);

        return rows.map(r => ({
            variantId: r.variant_id,
            sent: r.sent,
            accepted: r.accepted,
            replied: r.replied,
            acceptanceRate: r.sent > 0 ? Math.round((r.accepted / r.sent) * 100) / 100 : 0,
            replyRate: r.sent > 0 ? Math.round((r.replied / r.sent) * 100) / 100 : 0,
            ucbScore: Math.round(computeUCB(r.sent, r.accepted, totalSent) * 1000) / 1000,
        })).sort((a, b) => b.acceptanceRate - a.acceptanceRate);
    } catch {
        return [];
    }
}
