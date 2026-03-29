import { describe, it, expect } from 'vitest';
import { evaluateComplianceHealthScore } from '../risk/riskEngine';

const base = {
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

describe('evaluateComplianceHealthScore — boundary', () => {
    it('score sempre 0-100', () => {
        const inputs = [
            base,
            { ...base, acceptanceRatePct: 0, engagementRatePct: 0 },
            { ...base, acceptanceRatePct: 100, engagementRatePct: 100 },
            { ...base, pendingRatio: 0 },
            { ...base, pendingRatio: 1.0 },
        ];
        for (const input of inputs) {
            const r = evaluateComplianceHealthScore(input);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(100);
        }
    });

    it('penalty >= 0 sempre', () => {
        expect(evaluateComplianceHealthScore(base).penalty).toBeGreaterThanOrEqual(0);
        expect(evaluateComplianceHealthScore({ ...base, pendingRatio: 0.9 }).penalty).toBeGreaterThanOrEqual(0);
    });
});
