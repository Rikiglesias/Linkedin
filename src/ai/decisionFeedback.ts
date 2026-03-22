/**
 * AI Decision Feedback Loop — traccia decisioni AI → outcome per calibrazione.
 *
 * Flusso:
 *   1. Worker chiama aiDecide() → riceve PROCEED/SKIP/DEFER/NOTIFY_HUMAN
 *   2. Worker chiama recordDecision() → registra la decisione nel DB
 *   3. Quando il lead ha un outcome (accepted, replied, ignored, etc.)
 *      → recordDecisionOutcome() aggiorna il record
 *   4. getDecisionAccuracy() → calcola accuracy per point/action
 *
 * Questo permette di:
 *   - Misurare se l'AI PROCEED porta a più acceptance di SKIP
 *   - Calibrare la confidence threshold
 *   - Identificare prompt che producono decisioni sbagliate
 */

import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';

// Interfaccia inline per evitare circular dependency con aiDecisionEngine.ts.
// aiDecisionEngine importa dinamicamente decisionFeedback → se decisionFeedback
// importa aiDecisionEngine → ciclo. Definiamo il tipo necessario qui.
interface AIDecisionResponseSlim {
    action: string;
    confidence: number;
    reason: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecisionRecord {
    id: number;
    leadId: number;
    point: string;
    action: string;
    confidence: number;
    reason: string;
    outcome: string | null;
    createdAt: string;
    outcomeAt: string | null;
}

export interface DecisionAccuracyStats {
    point: string;
    action: string;
    total: number;
    withOutcome: number;
    positiveOutcomes: number;
    negativeOutcomes: number;
    accuracyRate: number;
    avgConfidence: number;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

let _tableCreated = false;

async function ensureTable(): Promise<void> {
    if (_tableCreated) return;
    const db = await getDatabase();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            point TEXT NOT NULL,
            action TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.5,
            reason TEXT,
            outcome TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            outcome_at TEXT,
            UNIQUE(lead_id, point)
        );
        CREATE INDEX IF NOT EXISTS idx_ai_decision_log_lead ON ai_decision_log(lead_id);
        CREATE INDEX IF NOT EXISTS idx_ai_decision_log_point ON ai_decision_log(point, action);
    `);
    _tableCreated = true;
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Registra una decisione AI nel DB. Upsert: se lo stesso lead+point esiste già,
 * aggiorna (un lead può avere una sola decisione per point).
 */
export async function recordDecision(
    leadId: number,
    point: string,
    decision: AIDecisionResponseSlim,
): Promise<void> {
    try {
        await ensureTable();
        const db = await getDatabase();
        await db.run(
            `INSERT INTO ai_decision_log (lead_id, point, action, confidence, reason)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(lead_id, point) DO UPDATE SET
                 action = excluded.action,
                 confidence = excluded.confidence,
                 reason = excluded.reason,
                 created_at = datetime('now'),
                 outcome = NULL,
                 outcome_at = NULL`,
            [leadId, point, decision.action, decision.confidence, decision.reason.substring(0, 300)],
        );
    } catch (err) {
        await logWarn('ai_decision_feedback.record_failed', {
            leadId,
            point,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Aggiorna l'outcome di una decisione AI precedente.
 * Outcomes positivi: 'accepted', 'replied', 'connected'
 * Outcomes negativi: 'ignored', 'withdrawn', 'blocked'
 */
export async function recordDecisionOutcome(
    leadId: number,
    point: string,
    outcome: string,
): Promise<void> {
    try {
        await ensureTable();
        const db = await getDatabase();
        const result = await db.run(
            `UPDATE ai_decision_log
             SET outcome = ?, outcome_at = datetime('now')
             WHERE lead_id = ? AND point = ? AND outcome IS NULL`,
            [outcome, leadId, point],
        );
        if (result.changes && result.changes > 0) {
            await logInfo('ai_decision_feedback.outcome_recorded', { leadId, point, outcome });
        }
    } catch (err) {
        await logWarn('ai_decision_feedback.outcome_failed', {
            leadId,
            point,
            outcome,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── Read ────────────────────────────────────────────────────────────────────

const POSITIVE_OUTCOMES = new Set(['accepted', 'replied', 'connected']);
const NEGATIVE_OUTCOMES = new Set(['ignored', 'withdrawn', 'blocked', 'dead']);

/**
 * Calcola l'accuracy delle decisioni AI per ogni point+action.
 * Accuracy = positive outcomes / total outcomes (esclude decisioni senza outcome).
 */
export async function getDecisionAccuracy(
    lookbackDays: number = 30,
): Promise<DecisionAccuracyStats[]> {
    try {
        await ensureTable();
        const db = await getDatabase();
        const safeDays = Math.max(1, Math.min(90, Math.floor(lookbackDays)));
        const rows = await db.query<{
            point: string;
            action: string;
            total: number;
            with_outcome: number;
            avg_confidence: number;
            outcomes: string;
        }>(
            `SELECT
                point,
                action,
                COUNT(*) as total,
                SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) as with_outcome,
                AVG(confidence) as avg_confidence,
                GROUP_CONCAT(outcome) as outcomes
             FROM ai_decision_log
             WHERE created_at >= datetime('now', '-' || ? || ' days')
             GROUP BY point, action
             ORDER BY total DESC`,
            [safeDays],
        );

        return rows.map((row) => {
            const outcomeList = (row.outcomes ?? '').split(',').filter(Boolean);
            const positiveCount = outcomeList.filter((o) => POSITIVE_OUTCOMES.has(o)).length;
            const negativeCount = outcomeList.filter((o) => NEGATIVE_OUTCOMES.has(o)).length;
            const withOutcome = row.with_outcome ?? 0;
            return {
                point: row.point,
                action: row.action,
                total: row.total,
                withOutcome,
                positiveOutcomes: positiveCount,
                negativeOutcomes: negativeCount,
                accuracyRate: withOutcome > 0 ? Math.round((positiveCount / withOutcome) * 1000) / 1000 : 0,
                avgConfidence: Math.round((row.avg_confidence ?? 0) * 1000) / 1000,
            };
        });
    } catch {
        return [];
    }
}

/**
 * Sommario compatto per il daily report e diagnostica.
 */
export async function getDecisionFeedbackSummary(
    lookbackDays: number = 7,
): Promise<{
    totalDecisions: number;
    withOutcome: number;
    overallAccuracy: number;
    byPoint: DecisionAccuracyStats[];
}> {
    const stats = await getDecisionAccuracy(lookbackDays);
    const totalDecisions = stats.reduce((s, r) => s + r.total, 0);
    const withOutcome = stats.reduce((s, r) => s + r.withOutcome, 0);
    const positiveTotal = stats.reduce((s, r) => s + r.positiveOutcomes, 0);
    return {
        totalDecisions,
        withOutcome,
        overallAccuracy: withOutcome > 0 ? Math.round((positiveTotal / withOutcome) * 1000) / 1000 : 0,
        byPoint: stats,
    };
}
