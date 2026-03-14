/**
 * risk/strategyPlanner.ts
 * ─────────────────────────────────────────────────────────────────
 * Weekly strategy planner: defines per-day-of-week activity profiles
 * to make the bot's behavior more human-like across the week.
 *
 * Monday    → high invites, moderate messages
 * Tuesday   → moderate invites, high messages
 * Wednesday → moderate all
 * Thursday  → focus messages/follow-ups
 * Friday    → low volume, wind-down
 * Saturday  → zero or minimal
 * Sunday    → zero
 */

import { config, getHourInTimezone } from '../config';

export interface DayStrategy {
    dayOfWeek: number; // 0=Sunday, 6=Saturday
    dayName: string;
    inviteFactor: number; // 0.0–1.5 multiplier
    messageFactor: number;
    description: string;
}

const DEFAULT_WEEKLY_PLAN: readonly DayStrategy[] = [
    { dayOfWeek: 0, dayName: 'Sunday', inviteFactor: 0.0, messageFactor: 0.0, description: 'Rest day' },
    { dayOfWeek: 1, dayName: 'Monday', inviteFactor: 1.2, messageFactor: 0.8, description: 'High invites' },
    { dayOfWeek: 2, dayName: 'Tuesday', inviteFactor: 1.0, messageFactor: 1.2, description: 'High messages' },
    { dayOfWeek: 3, dayName: 'Wednesday', inviteFactor: 1.0, messageFactor: 1.0, description: 'Balanced' },
    { dayOfWeek: 4, dayName: 'Thursday', inviteFactor: 0.7, messageFactor: 1.3, description: 'Message focus' },
    { dayOfWeek: 5, dayName: 'Friday', inviteFactor: 0.5, messageFactor: 0.5, description: 'Wind-down' },
    { dayOfWeek: 6, dayName: 'Saturday', inviteFactor: 0.0, messageFactor: 0.0, description: 'Rest day' },
];

/**
 * Get today's strategy factors.
 * Returns { inviteFactor, messageFactor } multipliers for the current day.
 *
 * Disabled by default — returns (1.0, 1.0) unless WEEKLY_STRATEGY_ENABLED=true.
 */
/**
 * FNV-1a hash per generare jitter deterministico per account+settimana (6.1).
 * Stesso account + stessa settimana = stesso jitter. Settimana diversa = jitter diverso.
 */
function fnv1aHash(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getTodayStrategy(accountId?: string): DayStrategy {
    if (!config.weeklyStrategyEnabled) {
        const now = new Date();
        const dow = now.getDay();
        return {
            dayOfWeek: dow,
            dayName: DEFAULT_WEEKLY_PLAN[dow].dayName,
            inviteFactor: 1.0,
            messageFactor: 1.0,
            description: 'Strategy disabled',
        };
    }

    const now = new Date();
    const dow = now.getDay();
    let base = { ...DEFAULT_WEEKLY_PLAN[dow] };

    // D.3: Transizione weekend graduale — rampa oraria ven pomeriggio e lun mattina
    const hour = getHourInTimezone(now, config.timezone);
    if (dow === 5 && hour >= 14) {
        // Venerdì 14:00+ → cala progressivamente: 14h=0.5, 16h=0.25, 18h=0.05
        const ramp = Math.max(0, 1 - (hour - 14) / 5); // 14→1.0, 19→0.0
        base = { ...base, inviteFactor: Math.round(base.inviteFactor * ramp * 100) / 100, messageFactor: Math.round(base.messageFactor * ramp * 100) / 100, description: 'Friday wind-down (gradual)' };
    } else if (dow === 1 && hour < 12) {
        // Lunedì 9-12 → sale progressivamente: 9h=0.5, 10h=0.7, 11h=0.9, 12h=1.0
        const ramp = Math.min(1, 0.5 + (hour - config.workingHoursStart) * 0.17); // 9→0.5, 12→1.0
        base = { ...base, inviteFactor: Math.round(base.inviteFactor * ramp * 100) / 100, messageFactor: Math.round(base.messageFactor * ramp * 100) / 100, description: 'Monday ramp-up (gradual)' };
    }

    // Cross-Day Pattern Randomization (6.1): jitter ±15% per-account per-settimana.
    // Deterministico: stesso account+settimana = stesso jitter ogni giorno.
    if (accountId) {
        const weekNum = getWeekNumber(now);
        const inviteSeed = fnv1aHash(`${accountId}:${weekNum}:invite:${dow}`);
        const messageSeed = fnv1aHash(`${accountId}:${weekNum}:message:${dow}`);
        const inviteJitter = 0.85 + (inviteSeed % 31) / 100; // [0.85, 1.15]
        const messageJitter = 0.85 + (messageSeed % 31) / 100;
        return {
            ...base,
            inviteFactor: Math.round(base.inviteFactor * inviteJitter * 100) / 100,
            messageFactor: Math.round(base.messageFactor * messageJitter * 100) / 100,
            description: `${base.description} (jittered)`,
        };
    }

    return base;
}

