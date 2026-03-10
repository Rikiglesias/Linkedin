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

import { config } from '../config';

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
    { dayOfWeek: 6, dayName: 'Saturday', inviteFactor: 0.1, messageFactor: 0.1, description: 'Minimal' },
];

/**
 * Get today's strategy factors.
 * Returns { inviteFactor, messageFactor } multipliers for the current day.
 *
 * Disabled by default — returns (1.0, 1.0) unless WEEKLY_STRATEGY_ENABLED=true.
 */
export function getTodayStrategy(): DayStrategy {
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
    return DEFAULT_WEEKLY_PLAN[dow];
}

/**
 * Get the full weekly plan for display/reporting.
 */
export function getWeeklyPlan(): readonly DayStrategy[] {
    return DEFAULT_WEEKLY_PLAN;
}
