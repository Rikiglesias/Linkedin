import { describe, it, expect } from 'vitest';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';

describe('calculateAccountTrustScore — comprehensive', () => {
    it('score monotonicamente crescente con SSI', () => {
        const s30 = calculateAccountTrustScore({
            ssiScore: 30,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        const s70 = calculateAccountTrustScore({
            ssiScore: 70,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        expect(s70.score).toBeGreaterThanOrEqual(s30.score);
    });

    it('score monotonicamente crescente con ageDays', () => {
        const young = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 30,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        const old = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 365,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        expect(old.score).toBeGreaterThanOrEqual(young.score);
    });

    it('score monotonicamente crescente con acceptanceRatePct', () => {
        const low = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 10,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        const high = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 50,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        expect(high.score).toBeGreaterThanOrEqual(low.score);
    });

    it('score diminuisce con challenges', () => {
        const noChallenge = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.3,
        });
        const withChallenge = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 3,
            pendingRatio: 0.3,
        });
        expect(withChallenge.score).toBeLessThanOrEqual(noChallenge.score);
    });

    it('score diminuisce con pendingRatio alto', () => {
        const low = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.1,
        });
        const high = calculateAccountTrustScore({
            ssiScore: 50,
            ageDays: 180,
            acceptanceRatePct: 30,
            challengesLast7d: 0,
            pendingRatio: 0.8,
        });
        expect(high.score).toBeLessThanOrEqual(low.score);
    });

    it('budgetMultiplier è proporzionale al score', () => {
        const low = calculateAccountTrustScore({
            ssiScore: 10,
            ageDays: 7,
            acceptanceRatePct: 5,
            challengesLast7d: 2,
            pendingRatio: 0.7,
        });
        const high = calculateAccountTrustScore({
            ssiScore: 95,
            ageDays: 730,
            acceptanceRatePct: 50,
            challengesLast7d: 0,
            pendingRatio: 0.1,
        });
        expect(high.budgetMultiplier).toBeGreaterThan(low.budgetMultiplier);
    });
});
