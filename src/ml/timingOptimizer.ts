/**
 * timingOptimizer.ts — Heuristic Timing Optimizer
 *
 * Analizza i dati storici nel DB locale per trovare gli (hour, dayOfWeek)
 * slot con il più alto engagement score, ed espone due primitive:
 *
 *   - getBestTimeSlot() → slot ideale per schedulare inviti/messaggi
 *   - isGoodTimeNow()  → true se l'ora corrente è "buona" per agire
 *
 * Algoritmo:
 *   engagement_score(h, dow) =
 *       0.5 * (accepted / invited)  [se invited > 0]
 *     + 0.5 * (replied  / messaged) [se messaged > 0]
 *
 * Fallback conservativo (< MIN_DATAPOINTS): 9–18, lun-ven.
 *
 * Non fa ML cloud, tutto in SQLite locale. CPU trascurabile.
 */

import { getDatabase } from '../db';
import { logInfo } from '../telemetry/logger';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface TimeSlot {
    hour: number;           // 0-23
    dayOfWeek: number;      // 0=Sun … 6=Sat
    score: number;          // 0.0 – 1.0
    sampleSize: number;     // number of data points used
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const MIN_DATAPOINTS = 30;   // sotto questa soglia → fallback statico
const DEFAULT_HOUR_START = 9;
const DEFAULT_HOUR_END = 18;
const DEFAULT_GOOD_DAYS = new Set([1, 2, 3, 4, 5]); // lun-ven (0=dom)
const GOOD_SCORE_THRESHOLD = 0.3; // sopra questa soglia → isGoodTimeNow = true

// ─── Logica Core ─────────────────────────────────────────────────────────────

/**
 * Calcola l'engagement score per tutti gli slot storici.
 * Restituisce una lista ordinata per score decrescente.
 */
async function computeSlotScores(): Promise<TimeSlot[]> {
    const db = await getDatabase();

    interface SlotRow {
        hour: number;
        dow: number;
        total_invited: number;
        total_accepted: number;
        total_messaged: number;
        total_replied: number;
    }

    // Aggregazione per (hour, dayOfWeek) usando STRFTIME su SQLite
    const rows = await db.query<SlotRow>(`
        SELECT
            CAST(STRFTIME('%H', invited_at) AS INTEGER)          AS hour,
            CAST(STRFTIME('%w', invited_at) AS INTEGER)          AS dow,
            COUNT(*)                                              AS total_invited,
            SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS total_accepted,
            SUM(CASE WHEN messaged_at IS NOT NULL THEN 1 ELSE 0 END) AS total_messaged,
            SUM(CASE WHEN status = 'REPLIED' THEN 1 ELSE 0 END)  AS total_replied
        FROM leads
        WHERE invited_at IS NOT NULL
          AND CAST(STRFTIME('%H', invited_at) AS INTEGER) BETWEEN 0 AND 23
        GROUP BY hour, dow
        HAVING COUNT(*) >= 3
        ORDER BY hour ASC, dow ASC
    `);

    if (!rows || rows.length === 0) return [];

    const slots: TimeSlot[] = rows.map(r => {
        const acceptRate = r.total_invited > 0 ? r.total_accepted / r.total_invited : 0;
        const replyRate = r.total_messaged > 0 ? r.total_replied / r.total_messaged : 0;
        const score = 0.5 * acceptRate + 0.5 * replyRate;
        return {
            hour: r.hour,
            dayOfWeek: r.dow,
            score: Math.round(score * 100) / 100,
            sampleSize: r.total_invited,
        };
    });

    return slots.sort((a, b) => b.score - a.score);
}

/**
 * Restituisce il miglior slot temporale basato sui dati storici.
 * Se i dati sono insufficienti, ritorna il fallback standard.
 */
export async function getBestTimeSlot(): Promise<TimeSlot> {
    try {
        const slots = await computeSlotScores();
        const totalSamples = slots.reduce((s, x) => s + x.sampleSize, 0);

        if (totalSamples < MIN_DATAPOINTS || slots.length === 0) {
            // Fallback statico: mercoledì ore 10
            return { hour: 10, dayOfWeek: 3, score: 0, sampleSize: 0 };
        }

        return slots[0];
    } catch {
        return { hour: 10, dayOfWeek: 3, score: 0, sampleSize: 0 };
    }
}

/**
 * Valuta se il momento corrente è statisticamente buono per agire.
 * Non è bloccante — è solo advisory (il chiamante decide).
 */
export async function isGoodTimeNow(): Promise<boolean> {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDow = now.getDay(); // 0=dom

    try {
        const db = await getDatabase();

        interface CountRow { total: number }
        const countRow = await db.get<CountRow>(
            `SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`
        );
        const totalSamples = countRow?.total ?? 0;

        // Dati insufficienti → fallback statico conservativo
        if (totalSamples < MIN_DATAPOINTS) {
            const inWorkHours = currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
            const inWorkDays = DEFAULT_GOOD_DAYS.has(currentDow);
            return inWorkHours && inWorkDays;
        }

        // Cerca lo score per lo slot corrente
        const slots = await computeSlotScores();
        const currentSlot = slots.find(s => s.hour === currentHour && s.dayOfWeek === currentDow);

        if (!currentSlot) {
            // Slot senza dati → conservativo: solo orario lavorativo
            const inWorkHours = currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
            const inWorkDays = DEFAULT_GOOD_DAYS.has(currentDow);
            return inWorkHours && inWorkDays;
        }

        const result = currentSlot.score >= GOOD_SCORE_THRESHOLD;
        if (!result) {
            await logInfo('timing_optimizer.suboptimal_window', {
                hour: currentHour,
                dow: currentDow,
                score: currentSlot.score,
                threshold: GOOD_SCORE_THRESHOLD,
            });
        }

        return result;
    } catch {
        // In caso di errore DB — non bloccare mai
        return currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
    }
}

/**
 * Restituisce i top-N slot per uso nel report giornaliero.
 */
export async function getTopTimeSlots(n: number = 3): Promise<TimeSlot[]> {
    try {
        const slots = await computeSlotScores();
        return slots.slice(0, n);
    } catch {
        return [];
    }
}
