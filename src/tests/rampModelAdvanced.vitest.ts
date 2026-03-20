import { describe, it, expect } from 'vitest';
import { computeNonLinearRampCap } from '../ml/rampModel';

const base = {
    currentCap: 15,
    hardMaxCap: 30,
    accountAgeDays: 60,
    warmupDays: 60,
    channel: 'invite' as const,
    riskAction: 'NORMAL' as const,
    riskScore: 20,
    pendingRatio: 0.3,
    errorRate: 0.05,
    healthScore: 80,
    baseDailyIncrease: 1,
};

describe('rampModel — computeNonLinearRampCap advanced', () => {
    it('errorRate alto → cap ridotto', () => {
        const normal = computeNonLinearRampCap(base);
        const highError = computeNonLinearRampCap({ ...base, errorRate: 0.8 });
        expect(highError.nextCap).toBeLessThanOrEqual(normal.nextCap);
    });

    it('healthScore basso → cap ridotto', () => {
        const healthy = computeNonLinearRampCap(base);
        const unhealthy = computeNonLinearRampCap({ ...base, healthScore: 20 });
        expect(unhealthy.nextCap).toBeLessThanOrEqual(healthy.nextCap);
    });

    it('channel message → stessa struttura output', () => {
        const result = computeNonLinearRampCap({ ...base, channel: 'message' as const });
        expect(result.nextCap).toBeGreaterThanOrEqual(1);
        expect(result.nextCap).toBeLessThanOrEqual(base.hardMaxCap);
    });

    it('currentCap > hardMaxCap → nextCap <= hardMaxCap', () => {
        const result = computeNonLinearRampCap({ ...base, currentCap: 50, hardMaxCap: 25 });
        expect(result.nextCap).toBeLessThanOrEqual(25);
    });

    it('currentCap = 0 → nextCap >= 1', () => {
        const result = computeNonLinearRampCap({ ...base, currentCap: 0 });
        expect(result.nextCap).toBeGreaterThanOrEqual(1);
    });

    it('riskScore alto → cap ridotto', () => {
        const lowRisk = computeNonLinearRampCap({ ...base, riskScore: 10 });
        const highRisk = computeNonLinearRampCap({ ...base, riskScore: 90 });
        expect(highRisk.nextCap).toBeLessThanOrEqual(lowRisk.nextCap);
    });

    it('output ha currentCap e nextCap', () => {
        const result = computeNonLinearRampCap(base);
        expect(result).toHaveProperty('currentCap');
        expect(result).toHaveProperty('nextCap');
        expect(typeof result.currentCap).toBe('number');
        expect(typeof result.nextCap).toBe('number');
    });
});
