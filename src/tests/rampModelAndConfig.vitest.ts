import { describe, it, expect, beforeAll } from 'vitest';
import { computeNonLinearRampCap } from '../ml/rampModel';
import { isWorkingHour, getLocalDateString, getHourInTimezone, getDayInTimezone } from '../config';

const baseRampInput = {
    currentCap: 10,
    hardMaxCap: 25,
    accountAgeDays: 30,
    warmupDays: 60,
    channel: 'invite' as const,
    riskAction: 'NORMAL' as const,
    riskScore: 20,
    pendingRatio: 0.3,
    errorRate: 0.05,
    healthScore: 80,
    baseDailyIncrease: 1,
};

describe('rampModel — computeNonLinearRampCap', () => {
    it('nextCap >= 1 sempre', () => {
        const result = computeNonLinearRampCap(baseRampInput);
        expect(result.nextCap).toBeGreaterThanOrEqual(1);
    });

    it('nextCap <= hardMaxCap', () => {
        const result = computeNonLinearRampCap(baseRampInput);
        expect(result.nextCap).toBeLessThanOrEqual(baseRampInput.hardMaxCap);
    });

    it('account giovane → nextCap vicino a currentCap', () => {
        const result = computeNonLinearRampCap({ ...baseRampInput, accountAgeDays: 3 });
        expect(result.nextCap).toBeLessThanOrEqual(baseRampInput.currentCap + 5);
    });

    it('riskAction STOP → nextCap ridotto', () => {
        const normal = computeNonLinearRampCap(baseRampInput);
        const stop = computeNonLinearRampCap({ ...baseRampInput, riskAction: 'STOP' as const });
        expect(stop.nextCap).toBeLessThanOrEqual(normal.nextCap);
    });

    it('pendingRatio alto → penalità', () => {
        const low = computeNonLinearRampCap({ ...baseRampInput, pendingRatio: 0.1 });
        const high = computeNonLinearRampCap({ ...baseRampInput, pendingRatio: 0.8 });
        expect(high.nextCap).toBeLessThanOrEqual(low.nextCap);
    });

    it('ritorna currentCap nel risultato', () => {
        const result = computeNonLinearRampCap(baseRampInput);
        expect(result.currentCap).toBe(baseRampInput.currentCap);
    });
});

describe('config/index — isWorkingHour', () => {
    beforeAll(async () => {
        const { config } = await import('../config');
        config.workingHoursStart = 8;
        config.workingHoursEnd = 19;
        config.weekendPolicyEnabled = true;
        config.timezone = 'Europe/Rome';
    });

    it('isWorkingHour ritorna boolean', () => {
        expect(typeof isWorkingHour()).toBe('boolean');
    });

    it('M18: accetta timezone opzionale', () => {
        const now = new Date();
        const resultDefault = isWorkingHour(now);
        const resultExplicit = isWorkingHour(now, 'Europe/Rome');
        // Con la stessa timezone, il risultato dovrebbe essere identico
        expect(resultDefault).toBe(resultExplicit);
    });

    it('getLocalDateString ritorna formato YYYY-MM-DD', () => {
        const date = getLocalDateString();
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('getHourInTimezone ritorna 0-23', () => {
        const hour = getHourInTimezone(new Date(), 'Europe/Rome');
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
    });

    it('getDayInTimezone ritorna 0-6', () => {
        const day = getDayInTimezone(new Date(), 'Europe/Rome');
        expect(day).toBeGreaterThanOrEqual(0);
        expect(day).toBeLessThanOrEqual(6);
    });
});
