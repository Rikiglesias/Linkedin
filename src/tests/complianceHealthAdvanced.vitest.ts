import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateComplianceHealthScore } from '../risk/riskEngine';
import { config } from '../config';

beforeAll(() => {
    config.pendingRatioWarn = 0.5;
});

const baseInputs = {
    acceptanceRatePct: 30,
    engagementRatePct: 20,
    pendingRatio: 0.3,
    invitesSentToday: 10,
    messagesSentToday: 5,
    dailyInviteLimit: 25,
    dailyMessageLimit: 35,
    weeklyInvitesSent: 40,
    weeklyInviteLimit: 100,
    pendingWarnThreshold: 0.5,
};

describe('evaluateComplianceHealthScore — advanced', () => {
    it('score tra 0 e 100', () => {
        const result = evaluateComplianceHealthScore(baseInputs);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('acceptanceRate alto → score alto', () => {
        const high = evaluateComplianceHealthScore({ ...baseInputs, acceptanceRatePct: 80, engagementRatePct: 60 });
        const low = evaluateComplianceHealthScore({ ...baseInputs, acceptanceRatePct: 5, engagementRatePct: 2 });
        expect(high.score).toBeGreaterThan(low.score);
    });

    it('pendingRatio alto → penalty', () => {
        const low = evaluateComplianceHealthScore({ ...baseInputs, pendingRatio: 0.1 });
        const high = evaluateComplianceHealthScore({ ...baseInputs, pendingRatio: 0.9 });
        expect(high.penalty).toBeGreaterThanOrEqual(low.penalty);
    });

    it('utilizationRatio visibile nel risultato', () => {
        const result = evaluateComplianceHealthScore(baseInputs);
        expect(Number.isFinite(result.utilizationRatio)).toBe(true);
        expect(result.utilizationRatio).toBeGreaterThanOrEqual(0);
    });

    it('baseScore è media di acceptanceRatePct e engagementRatePct', () => {
        const result = evaluateComplianceHealthScore({ ...baseInputs, acceptanceRatePct: 40, engagementRatePct: 20 });
        expect(result.baseScore).toBeCloseTo(30, 0);
    });

    it('tutti a zero → score basso', () => {
        const result = evaluateComplianceHealthScore({
            acceptanceRatePct: 0,
            engagementRatePct: 0,
            pendingRatio: 0,
            invitesSentToday: 0,
            messagesSentToday: 0,
            dailyInviteLimit: 25,
            dailyMessageLimit: 35,
            weeklyInvitesSent: 0,
            weeklyInviteLimit: 100,
            pendingWarnThreshold: 0.5,
        });
        expect(result.score).toBeLessThanOrEqual(10);
    });

    it('over-utilization → penalty', () => {
        const result = evaluateComplianceHealthScore({
            ...baseInputs,
            invitesSentToday: 30, // > dailyInviteLimit
            messagesSentToday: 40, // > dailyMessageLimit
            weeklyInvitesSent: 120, // > weeklyInviteLimit
        });
        expect(result.penalty).toBeGreaterThan(0);
    });
});
