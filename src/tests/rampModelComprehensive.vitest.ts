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

describe('computeNonLinearRampCap — comprehensive', () => {
    it('WARN riskAction → nextCap ridotto vs NORMAL', () => {
        const normal = computeNonLinearRampCap(base);
        const warn = computeNonLinearRampCap({ ...base, riskAction: 'WARN' as const });
        expect(warn.nextCap).toBeLessThanOrEqual(normal.nextCap);
    });

    it('LOW_ACTIVITY riskAction → nextCap ridotto', () => {
        const normal = computeNonLinearRampCap(base);
        const low = computeNonLinearRampCap({ ...base, riskAction: 'LOW_ACTIVITY' as const });
        expect(low.nextCap).toBeLessThanOrEqual(normal.nextCap);
    });

    it('hardMaxCap = 1 → nextCap = 1', () => {
        const r = computeNonLinearRampCap({ ...base, hardMaxCap: 1 });
        expect(r.nextCap).toBe(1);
    });

    it('warmupDays = 1 → ramp veloce', () => {
        const fast = computeNonLinearRampCap({ ...base, warmupDays: 1 });
        const slow = computeNonLinearRampCap({ ...base, warmupDays: 120 });
        expect(fast.nextCap).toBeGreaterThanOrEqual(slow.nextCap);
    });

    it('baseDailyIncrease alto → step più grandi', () => {
        const slow = computeNonLinearRampCap({ ...base, baseDailyIncrease: 1 });
        const fast = computeNonLinearRampCap({ ...base, baseDailyIncrease: 5 });
        expect(fast.nextCap).toBeGreaterThanOrEqual(slow.nextCap);
    });

    it('channel message → stesso tipo output', () => {
        const r = computeNonLinearRampCap({ ...base, channel: 'message' as const });
        expect(r).toHaveProperty('nextCap');
        expect(r).toHaveProperty('currentCap');
    });
});
