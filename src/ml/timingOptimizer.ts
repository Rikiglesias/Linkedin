/**
 * timingOptimizer.ts — Heuristic Timing Optimizer (segment-aware)
 */

import { getDatabase } from '../db';
import { config, getHourInTimezone } from '../config';
import { logInfo } from '../telemetry/logger';
import { LeadSegment, inferLeadSegment } from './segments';

export type TimingAction = 'invite' | 'message';

export interface TimeSlot {
    hour: number;
    dayOfWeek: number;
    score: number;
    sampleSize: number;
}

const MIN_DATAPOINTS = 30;
const DEFAULT_HOUR_START = 9;
const DEFAULT_HOUR_END = 18;
const DEFAULT_GOOD_DAYS = new Set([1, 2, 3, 4, 5]);
const GOOD_SCORE_THRESHOLD = 0.3;

interface RawSlotRow {
    hour: number;
    dow: number;
    job_title: string | null;
    total_count: number;
    total_success: number;
}

function buildSlotQuery(action: TimingAction): string {
    if (action === 'invite') {
        return `
            SELECT
                CAST(STRFTIME('%H', invited_at) AS INTEGER) AS hour,
                CAST(STRFTIME('%w', invited_at) AS INTEGER) AS dow,
                job_title,
                COUNT(*) AS total_count,
                SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS total_success
            FROM leads
            WHERE invited_at IS NOT NULL
              AND CAST(STRFTIME('%H', invited_at) AS INTEGER) BETWEEN 0 AND 23
            GROUP BY hour, dow, job_title
        `;
    }

    return `
        SELECT
            CAST(STRFTIME('%H', messaged_at) AS INTEGER) AS hour,
            CAST(STRFTIME('%w', messaged_at) AS INTEGER) AS dow,
            job_title,
            COUNT(*) AS total_count,
            SUM(CASE WHEN status IN ('REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) AS total_success
        FROM leads
        WHERE messaged_at IS NOT NULL
          AND CAST(STRFTIME('%H', messaged_at) AS INTEGER) BETWEEN 0 AND 23
        GROUP BY hour, dow, job_title
    `;
}

async function computeSlotScores(action: TimingAction, segment?: LeadSegment): Promise<TimeSlot[]> {
    const db = await getDatabase();
    const rows = await db.query<RawSlotRow>(buildSlotQuery(action));
    if (!rows || rows.length === 0) return [];

    const aggregate = new Map<string, { success: number; total: number }>();
    for (const row of rows) {
        const rowSegment = inferLeadSegment(row.job_title);
        if (segment && segment !== 'unknown' && rowSegment !== segment) continue;
        const key = `${row.hour}|${row.dow}`;
        const item = aggregate.get(key) ?? { success: 0, total: 0 };
        item.success += row.total_success ?? 0;
        item.total += row.total_count ?? 0;
        aggregate.set(key, item);
    }

    const slots: TimeSlot[] = [];
    for (const [key, value] of aggregate) {
        if (value.total < 3) continue;
        const [hourRaw, dowRaw] = key.split('|');
        const hour = Number.parseInt(hourRaw ?? '0', 10);
        const dayOfWeek = Number.parseInt(dowRaw ?? '0', 10);
        const rate = value.total > 0 ? value.success / value.total : 0;
        slots.push({
            hour,
            dayOfWeek,
            score: Math.round(rate * 100) / 100,
            sampleSize: value.total,
        });
    }

    return slots.sort((a, b) => b.score - a.score);
}

export async function getBestTimeSlot(action: TimingAction = 'invite'): Promise<TimeSlot> {
    return getBestTimeSlotForSegment(action, 'unknown');
}

export async function getBestTimeSlotForSegment(
    action: TimingAction,
    segment: LeadSegment
): Promise<TimeSlot> {
    try {
        const slots = await computeSlotScores(action, segment === 'unknown' ? undefined : segment);
        const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleSize, 0);
        if (slots.length === 0 || totalSamples < MIN_DATAPOINTS) {
            return { hour: 10, dayOfWeek: 3, score: 0, sampleSize: 0 };
        }
        return slots[0] as TimeSlot;
    } catch {
        return { hour: 10, dayOfWeek: 3, score: 0, sampleSize: 0 };
    }
}

export async function isGoodTimeNow(action: TimingAction = 'invite', segment?: LeadSegment): Promise<boolean> {
    const now = new Date();
    const currentHour = getHourInTimezone(now, config.timezone);
    const currentDow = now.getDay();
    try {
        const db = await getDatabase();
        const countRow = action === 'invite'
            ? await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`)
            : await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads WHERE messaged_at IS NOT NULL`);
        const totalSamples = countRow?.total ?? 0;

        if (totalSamples < MIN_DATAPOINTS) {
            const inWorkHours = currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
            const inWorkDays = DEFAULT_GOOD_DAYS.has(currentDow);
            return inWorkHours && inWorkDays;
        }

        const slots = await computeSlotScores(action, segment);
        const currentSlot = slots.find((slot) => slot.hour === currentHour && slot.dayOfWeek === currentDow);
        if (!currentSlot) {
            const inWorkHours = currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
            const inWorkDays = DEFAULT_GOOD_DAYS.has(currentDow);
            return inWorkHours && inWorkDays;
        }

        const result = currentSlot.score >= GOOD_SCORE_THRESHOLD;
        if (!result) {
            await logInfo('timing_optimizer.suboptimal_window', {
                action,
                segment: segment ?? 'all',
                hour: currentHour,
                dow: currentDow,
                score: currentSlot.score,
                threshold: GOOD_SCORE_THRESHOLD,
            });
        }
        return result;
    } catch {
        return currentHour >= DEFAULT_HOUR_START && currentHour < DEFAULT_HOUR_END;
    }
}

export async function getTopTimeSlots(
    n: number = 3,
    action: TimingAction = 'invite',
    segment?: LeadSegment
): Promise<TimeSlot[]> {
    try {
        const slots = await computeSlotScores(action, segment);
        return slots.slice(0, n);
    } catch {
        return [];
    }
}

export function computeDelayUntilSlot(slot: TimeSlot, now: Date = new Date()): number {
    const target = new Date(now.getTime());
    const daysAhead = (slot.dayOfWeek - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + daysAhead);
    target.setHours(slot.hour, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 7);
    }
    return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
}

