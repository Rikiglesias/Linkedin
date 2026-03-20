import { describe, it, expect } from 'vitest';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';

describe('calculateAccountTrustScore — boundary values', () => {
    it('score 0-100 per qualsiasi input', () => {
        const inputs = [
            { ssiScore: 0, ageDays: 0, acceptanceRatePct: 0, challengesLast7d: 0, pendingRatio: 0 },
            { ssiScore: 100, ageDays: 1000, acceptanceRatePct: 100, challengesLast7d: 0, pendingRatio: 0 },
            { ssiScore: 50, ageDays: 180, acceptanceRatePct: 30, challengesLast7d: 5, pendingRatio: 0.9 },
            { ssiScore: -10, ageDays: -5, acceptanceRatePct: -20, challengesLast7d: -1, pendingRatio: -0.5 },
            { ssiScore: 200, ageDays: 5000, acceptanceRatePct: 200, challengesLast7d: 100, pendingRatio: 5 },
        ];
        for (const input of inputs) {
            const r = calculateAccountTrustScore(input);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(100);
        }
    });

    it('budgetMultiplier 0.3-1.3 per qualsiasi input', () => {
        const inputs = [
            { ssiScore: 0, ageDays: 0, acceptanceRatePct: 0, challengesLast7d: 0, pendingRatio: 0 },
            { ssiScore: 100, ageDays: 1000, acceptanceRatePct: 100, challengesLast7d: 0, pendingRatio: 0 },
        ];
        for (const input of inputs) {
            const r = calculateAccountTrustScore(input);
            expect(r.budgetMultiplier).toBeGreaterThanOrEqual(0.3);
            expect(r.budgetMultiplier).toBeLessThanOrEqual(1.3);
        }
    });

    it('A11: acceleration solo con zero challenge + pending basso + acceptance alto', () => {
        // Con challenge → no acceleration
        const withChallenge = calculateAccountTrustScore({ ssiScore: 95, ageDays: 730, acceptanceRatePct: 50, challengesLast7d: 1, pendingRatio: 0.2 });
        expect(withChallenge.budgetMultiplier).toBeLessThanOrEqual(1.0);

        // Con pending alto → no acceleration
        const highPending = calculateAccountTrustScore({ ssiScore: 95, ageDays: 730, acceptanceRatePct: 50, challengesLast7d: 0, pendingRatio: 0.6 });
        expect(highPending.budgetMultiplier).toBeLessThanOrEqual(1.0);

        // Con acceptance basso → no acceleration
        const lowAcceptance = calculateAccountTrustScore({ ssiScore: 95, ageDays: 730, acceptanceRatePct: 20, challengesLast7d: 0, pendingRatio: 0.2 });
        expect(lowAcceptance.budgetMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('factors sommano approssimativamente al score', () => {
        const r = calculateAccountTrustScore({ ssiScore: 80, ageDays: 365, acceptanceRatePct: 40, challengesLast7d: 0, pendingRatio: 0.3 });
        const factorSum = r.factors.ssi * 0.30 + r.factors.age * 0.25 + r.factors.acceptance * 0.25 + r.factors.challengeHistory * 0.10 + r.factors.pendingRatio * 0.10;
        expect(Math.abs(r.score - Math.round(factorSum))).toBeLessThanOrEqual(1);
    });
});
