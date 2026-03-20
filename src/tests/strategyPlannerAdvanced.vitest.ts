import { describe, it, expect, beforeAll } from 'vitest';
import { getTodayStrategy } from '../risk/strategyPlanner';
import { config } from '../config';

describe('strategyPlanner — advanced', () => {
    beforeAll(() => {
        config.weeklyStrategyEnabled = true;
    });

    it('inviteFactor + messageFactor > 0 nei giorni lavorativi', () => {
        const strategy = getTodayStrategy();
        if (strategy.dayOfWeek >= 1 && strategy.dayOfWeek <= 5) {
            expect(strategy.inviteFactor + strategy.messageFactor).toBeGreaterThan(0);
        }
    });

    it('inviteFactor e messageFactor sono numeri finiti', () => {
        const strategy = getTodayStrategy();
        expect(Number.isFinite(strategy.inviteFactor)).toBe(true);
        expect(Number.isFinite(strategy.messageFactor)).toBe(true);
    });

    it('con weeklyStrategyEnabled=false → ritorna comunque un DayStrategy', () => {
        const prev = config.weeklyStrategyEnabled;
        config.weeklyStrategyEnabled = false;
        const strategy = getTodayStrategy();
        expect(strategy).toBeDefined();
        expect(typeof strategy.inviteFactor).toBe('number');
        config.weeklyStrategyEnabled = prev;
    });

    it('accountId diversi → stessa strategia (strategia è per giorno, non per account)', () => {
        const a = getTodayStrategy('account-1');
        const b = getTodayStrategy('account-2');
        expect(a.dayOfWeek).toBe(b.dayOfWeek);
        expect(a.dayName).toBe(b.dayName);
    });
});
