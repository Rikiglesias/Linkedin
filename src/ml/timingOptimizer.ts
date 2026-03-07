/**
 * timingOptimizer.ts — Data-driven timing optimizer (segment-aware + A/B ready)
 */

import { getDatabase } from '../db';
import { config, getHourInTimezone, getDayInTimezone } from '../config';
import { logInfo } from '../telemetry/logger';
import { LeadSegment, inferLeadSegment } from './segments';
import { computeTwoProportionSignificance } from './significance';

/**
 * Compute the UTC-to-local hour offset for the configured timezone.
 * Returns the number of hours to add to a UTC hour to get the local hour.
 */
function getTimezoneHourOffset(now: Date = new Date()): number {
    const localHour = getHourInTimezone(now, config.timezone);
    const utcHour = now.getUTCHours();
    let offset = localHour - utcHour;
    if (offset > 12) offset -= 24;
    if (offset < -12) offset += 24;
    return offset;
}

/**
 * Convert a UTC hour (0-23) to the configured local timezone hour.
 */
function utcHourToLocal(utcHour: number): number {
    return ((utcHour + getTimezoneHourOffset()) % 24 + 24) % 24;
}

export type TimingAction = 'invite' | 'message';
export type TimingStrategy = 'baseline' | 'optimizer';

export interface TimeSlot {
    hour: number;
    dayOfWeek: number;
    score: number;
    sampleSize: number;
    recentSampleSize: number;
    lifetimeRate: number;
    recentRate: number;
}

export interface TimingDecision {
    action: TimingAction;
    strategy: TimingStrategy;
    segment: LeadSegment;
    delaySec: number;
    score: number;
    sampleSize: number;
    slot: TimeSlot | null;
    explored: boolean;
    reason: 'exploration' | 'insufficient_data' | 'insufficient_confidence' | 'delay_too_long' | 'optimized_slot';
    model: string;
}

export interface TimingExperimentStrategyStats {
    strategy: TimingStrategy;
    sent: number;
    success: number;
    successRate: number;
}

export interface TimingExperimentReport {
    action: TimingAction;
    metric: 'acceptance' | 'reply';
    lookbackDays: number;
    totalSent: number;
    baseline: TimingExperimentStrategyStats;
    optimizer: TimingExperimentStrategyStats;
    liftAbsolute: number | null;
    significance: {
        alpha: number;
        pValue: number | null;
        significant: boolean;
    } | null;
    winner: TimingStrategy | 'tie' | null;
    generatedAt: string;
}

const MIN_DATAPOINTS_FALLBACK = 30;
const DEFAULT_HOUR_START = 9;
const DEFAULT_HOUR_END = 18;
const DEFAULT_GOOD_DAYS = new Set([1, 2, 3, 4, 5]);
const TIMING_MODEL_VERSION = 'timing_optimizer_v2';

interface RawSlotRow {
    hour: number;
    dow: number;
    job_title: string | null;
    total_count: number;
    total_success: number;
    recent_count: number;
    recent_success: number;
}

interface StrategyAggregateRow {
    strategy: string | null;
    sent: number;
    success: number;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

function normalizeStrategy(value: string | null | undefined): TimingStrategy {
    return value?.toLowerCase() === 'optimizer' ? 'optimizer' : 'baseline';
}

function buildSlotQuery(action: TimingAction): string {
    const recentWindowDays = Math.max(1, Math.floor(config.timingRecentWindowDays));
    if (action === 'invite') {
        return `
            SELECT
                CAST(STRFTIME('%H', invited_at) AS INTEGER) AS hour,
                CAST(STRFTIME('%w', invited_at) AS INTEGER) AS dow,
                job_title,
                COUNT(*) AS total_count,
                SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS total_success,
                SUM(CASE WHEN invited_at >= DATETIME('now', '-${recentWindowDays} days') THEN 1 ELSE 0 END) AS recent_count,
                SUM(CASE WHEN invited_at >= DATETIME('now', '-${recentWindowDays} days') AND accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS recent_success
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
            SUM(CASE WHEN status IN ('REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) AS total_success,
            SUM(CASE WHEN messaged_at >= DATETIME('now', '-${recentWindowDays} days') THEN 1 ELSE 0 END) AS recent_count,
            SUM(CASE WHEN messaged_at >= DATETIME('now', '-${recentWindowDays} days') AND status IN ('REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) AS recent_success
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

    const aggregate = new Map<string, { success: number; total: number; recentSuccess: number; recentTotal: number }>();
    let globalSuccess = 0;
    let globalTotal = 0;

    for (const row of rows) {
        const rowSegment = inferLeadSegment(row.job_title);
        if (segment && segment !== 'unknown' && rowSegment !== segment) continue;
        const key = `${row.hour}|${row.dow}`;
        const item = aggregate.get(key) ?? { success: 0, total: 0, recentSuccess: 0, recentTotal: 0 };
        const success = row.total_success ?? 0;
        const total = row.total_count ?? 0;
        const recentSuccess = row.recent_success ?? 0;
        const recentTotal = row.recent_count ?? 0;
        item.success += success;
        item.total += total;
        item.recentSuccess += recentSuccess;
        item.recentTotal += recentTotal;
        aggregate.set(key, item);
        globalSuccess += success;
        globalTotal += total;
    }

    const priorMean = globalTotal > 0 ? globalSuccess / globalTotal : config.timingScoreThreshold;
    const priorWeight = Math.max(0, config.timingBayesPriorWeight);
    const recentWeight = clamp01(config.timingRecentWeight);

    const slots: TimeSlot[] = [];
    for (const [key, value] of aggregate) {
        if (value.total < 2) continue;
        const [hourRaw, dowRaw] = key.split('|');
        const utcHour = Number.parseInt(hourRaw ?? '0', 10);
        const hour = utcHourToLocal(utcHour);
        const dayOfWeek = Number.parseInt(dowRaw ?? '0', 10);
        const lifetimeRate = value.total > 0 ? value.success / value.total : 0;
        const recentRate = value.recentTotal > 0 ? value.recentSuccess / value.recentTotal : lifetimeRate;
        const blendedRate = lifetimeRate * (1 - recentWeight) + recentRate * recentWeight;
        const bayesScore =
            priorWeight > 0
                ? (blendedRate * value.total + priorMean * priorWeight) / (value.total + priorWeight)
                : blendedRate;

        slots.push({
            hour,
            dayOfWeek,
            score: round4(clamp01(bayesScore)),
            sampleSize: value.total,
            recentSampleSize: value.recentTotal,
            lifetimeRate: round4(clamp01(lifetimeRate)),
            recentRate: round4(clamp01(recentRate)),
        });
    }

    return slots.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
        return b.recentSampleSize - a.recentSampleSize;
    });
}

export async function getBestTimeSlot(action: TimingAction = 'invite'): Promise<TimeSlot> {
    return getBestTimeSlotForSegment(action, 'unknown');
}

export async function getBestTimeSlotForSegment(action: TimingAction, segment: LeadSegment): Promise<TimeSlot> {
    try {
        const slots = await computeSlotScores(action, segment === 'unknown' ? undefined : segment);
        const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleSize, 0);
        if (slots.length === 0 || totalSamples < MIN_DATAPOINTS_FALLBACK) {
            return {
                hour: 10,
                dayOfWeek: 3,
                score: 0,
                sampleSize: 0,
                recentSampleSize: 0,
                lifetimeRate: 0,
                recentRate: 0,
            };
        }
        return slots[0] as TimeSlot;
    } catch {
        return {
            hour: 10,
            dayOfWeek: 3,
            score: 0,
            sampleSize: 0,
            recentSampleSize: 0,
            lifetimeRate: 0,
            recentRate: 0,
        };
    }
}

export async function getTimingDecision(
    action: TimingAction,
    segment: LeadSegment,
    now: Date = new Date(),
): Promise<TimingDecision> {
    const fallbackDecision = (reason: TimingDecision['reason'], explored: boolean): TimingDecision => ({
        action,
        strategy: 'baseline',
        segment,
        delaySec: 0,
        score: 0,
        sampleSize: 0,
        slot: null,
        explored,
        reason,
        model: TIMING_MODEL_VERSION,
    });

    if (Math.random() < config.timingExplorationProbability) {
        return fallbackDecision('exploration', true);
    }

    // Try multiple top slots to find the nearest one within the allowed delay window,
    // instead of always waiting for the single best slot (which could be days away).
    const slots = await computeSlotScores(action, segment === 'unknown' ? undefined : segment);
    const totalSamples = slots.reduce((sum, s) => sum + s.sampleSize, 0);
    if (slots.length === 0 || totalSamples < MIN_DATAPOINTS_FALLBACK) {
        return fallbackDecision('insufficient_data', false);
    }

    const maxDelaySec = Math.max(1, config.timingMaxDelayHours) * 3600;
    const qualifiedSlots = slots.filter(
        (s) => s.sampleSize >= config.timingMinSlotSample && s.score >= config.timingScoreThreshold,
    );

    if (qualifiedSlots.length === 0) {
        const topSlot = slots[0];
        if (!topSlot) return fallbackDecision('insufficient_data', false);
        if (topSlot.sampleSize < config.timingMinSlotSample) {
            return fallbackDecision('insufficient_data', false);
        }
        return fallbackDecision('insufficient_confidence', false);
    }

    // Pick the qualified slot with the shortest delay
    let bestSlot: TimeSlot | null = null;
    let bestDelay = Infinity;
    for (const candidate of qualifiedSlots) {
        const delay = computeDelayUntilSlot(candidate, now);
        if (delay < bestDelay) {
            bestDelay = delay;
            bestSlot = candidate;
        }
    }

    if (!bestSlot || bestDelay > maxDelaySec) {
        return fallbackDecision('delay_too_long', false);
    }

    return {
        action,
        strategy: 'optimizer',
        segment,
        delaySec: bestDelay,
        score: bestSlot.score,
        sampleSize: bestSlot.sampleSize,
        slot: bestSlot,
        explored: false,
        reason: 'optimized_slot',
        model: TIMING_MODEL_VERSION,
    };
}

export async function getTimingDecisionForLead(
    action: TimingAction,
    jobTitle: string | null | undefined,
    now: Date = new Date(),
): Promise<TimingDecision> {
    const segment = inferLeadSegment(jobTitle);
    return getTimingDecision(action, segment, now);
}

export async function isGoodTimeNow(action: TimingAction = 'invite', segment?: LeadSegment): Promise<boolean> {
    const now = new Date();
    const currentHour = getHourInTimezone(now, config.timezone);
    const currentDow = getDayInTimezone(now, config.timezone);
    try {
        const db = await getDatabase();
        const countRow =
            action === 'invite'
                ? await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`)
                : await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads WHERE messaged_at IS NOT NULL`);
        const totalSamples = countRow?.total ?? 0;

        if (totalSamples < MIN_DATAPOINTS_FALLBACK) {
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

        const result = currentSlot.score >= config.timingScoreThreshold;
        if (!result) {
            await logInfo('timing_optimizer.suboptimal_window', {
                action,
                segment: segment ?? 'all',
                hour: currentHour,
                dow: currentDow,
                score: currentSlot.score,
                threshold: config.timingScoreThreshold,
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
    segment?: LeadSegment,
): Promise<TimeSlot[]> {
    try {
        const slots = await computeSlotScores(action, segment === 'unknown' ? undefined : segment);
        return slots.slice(0, n);
    } catch {
        return [];
    }
}

export function computeDelayUntilSlot(slot: TimeSlot, now: Date = new Date()): number {
    const currentHour = getHourInTimezone(now, config.timezone);
    const currentDow = getDayInTimezone(now, config.timezone);

    // Calculate days ahead to the target day of week
    let daysAhead = (slot.dayOfWeek - currentDow + 7) % 7;

    // If same day but the target hour already passed, move to the next occurrence
    // (next day with same dow = +7, but we search closer days first via the caller)
    if (daysAhead === 0 && currentHour >= slot.hour) {
        daysAhead = 1;
        // Find the next day matching slot.dayOfWeek
        // Instead of jumping a full week, advance to the very next day
        // The caller will evaluate whether the delay is acceptable
        const nextDaysAhead = (slot.dayOfWeek - ((currentDow + 1) % 7) + 7) % 7;
        daysAhead = 1 + nextDaysAhead;
    }

    const hourDiff = slot.hour - currentHour;
    const totalDelaySec = daysAhead * 86400 + hourDiff * 3600;
    return Math.max(0, totalDelaySec);
}

function buildExperimentQuery(action: TimingAction, lookbackDays: number): string {
    const safeLookback = Math.max(1, Math.floor(lookbackDays));
    if (action === 'invite') {
        return `
            SELECT
                COALESCE(invite_timing_strategy, 'baseline') AS strategy,
                COUNT(*) AS sent,
                SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS success
            FROM leads
            WHERE invited_at IS NOT NULL
              AND invited_at >= DATETIME('now', '-${safeLookback} days')
            GROUP BY COALESCE(invite_timing_strategy, 'baseline')
        `;
    }

    return `
        SELECT
            COALESCE(message_timing_strategy, 'baseline') AS strategy,
            COUNT(*) AS sent,
            SUM(CASE WHEN status IN ('REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) AS success
        FROM leads
        WHERE messaged_at IS NOT NULL
          AND messaged_at >= DATETIME('now', '-${safeLookback} days')
        GROUP BY COALESCE(message_timing_strategy, 'baseline')
    `;
}

function findStrategyStats(rows: StrategyAggregateRow[], strategy: TimingStrategy): TimingExperimentStrategyStats {
    const row = rows.find((item) => normalizeStrategy(item.strategy) === strategy);
    const sent = row?.sent ?? 0;
    const success = row?.success ?? 0;
    const successRate = sent > 0 ? round4(success / sent) : 0;
    return {
        strategy,
        sent,
        success,
        successRate,
    };
}

export async function getTimingExperimentReport(
    action: TimingAction = 'invite',
    lookbackDays: number = config.timingAbLookbackDays,
): Promise<TimingExperimentReport> {
    const db = await getDatabase();
    const safeLookback = Math.max(1, Math.floor(lookbackDays));
    const rows = await db.query<StrategyAggregateRow>(buildExperimentQuery(action, safeLookback));
    const baseline = findStrategyStats(rows, 'baseline');
    const optimizer = findStrategyStats(rows, 'optimizer');
    const totalSent = baseline.sent + optimizer.sent;
    const liftAbsolute =
        baseline.sent > 0 && optimizer.sent > 0 ? round4(optimizer.successRate - baseline.successRate) : null;

    const significance =
        baseline.sent > 0 && optimizer.sent > 0
            ? (() => {
                  const result = computeTwoProportionSignificance(
                      baseline.success,
                      baseline.sent,
                      optimizer.success,
                      optimizer.sent,
                      config.timingAbSignificanceAlpha,
                  );
                  return {
                      alpha: config.timingAbSignificanceAlpha,
                      pValue: result.pValue,
                      significant: result.significant,
                  };
              })()
            : null;

    let winner: TimingExperimentReport['winner'] = null;
    if (significance?.significant) {
        if (optimizer.successRate > baseline.successRate) {
            winner = 'optimizer';
        } else if (baseline.successRate > optimizer.successRate) {
            winner = 'baseline';
        } else {
            winner = 'tie';
        }
    }

    return {
        action,
        metric: action === 'invite' ? 'acceptance' : 'reply',
        lookbackDays: safeLookback,
        totalSent,
        baseline,
        optimizer,
        liftAbsolute,
        significance,
        winner,
        generatedAt: new Date().toISOString(),
    };
}
