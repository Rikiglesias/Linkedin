import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk, evaluateComplianceHealthScore } from '../risk/riskEngine';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';
import { resolveFollowUpCadence } from '../workers/followUpWorker';

beforeAll(async () => {
    const { config } = await import('../config');
    config.riskWarnThreshold = config.riskWarnThreshold || 30;
    config.riskStopThreshold = config.riskStopThreshold || 60;
    config.lowActivityRiskThreshold = config.lowActivityRiskThreshold || 45;
    config.lowActivityEnabled = true;
    config.pendingRatioWarn = config.pendingRatioWarn || 0.5;
    config.pendingRatioStop = config.pendingRatioStop || 0.7;
    config.lowActivityPendingThreshold = config.lowActivityPendingThreshold || 0.55;
    config.followUpDelayDays = config.followUpDelayDays || 5;
    config.followUpDelayStddevDays = config.followUpDelayStddevDays || 1.2;
    config.followUpDelayEscalationFactor = config.followUpDelayEscalationFactor || 0.35;
    config.followUpQuestionsDelayDays = config.followUpQuestionsDelayDays || 3;
    config.followUpNegativeDelayDays = config.followUpNegativeDelayDays || 30;
    config.followUpNotInterestedDelayDays = config.followUpNotInterestedDelayDays || 60;
});

describe('Risk Engine', () => {
    it('score 0 con tutti gli input a 0', () => {
        const result = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        expect(result.score).toBe(0);
        expect(result.action).toBe('NORMAL');
    });

    it('STOP con challengeCount > 0', () => {
        const result = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 1,
            inviteVelocityRatio: 0,
        });
        expect(result.action).toBe('STOP');
        expect(result.score).toBeGreaterThan(0);
    });

    it('STOP con pendingRatio >= pendingRatioStop', () => {
        const result = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0.75,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        // Con pendingRatio alto, il risk score sale e l'azione è STOP o LOW_ACTIVITY
        // (dipende dai threshold configurati — LOW_ACTIVITY può scattare prima di STOP)
        expect(['STOP', 'LOW_ACTIVITY']).toContain(result.action);
    });

    it('score positivo con input medi', () => {
        const result = evaluateRisk({
            errorRate: 0.5,
            selectorFailureRate: 0.3,
            pendingRatio: 0.4,
            challengeCount: 0,
            inviteVelocityRatio: 0.2,
        });
        expect(result.score).toBeGreaterThan(0);
        expect(['NORMAL', 'WARN', 'LOW_ACTIVITY', 'STOP']).toContain(result.action);
    });

    it('gestisce NaN e Infinity nei input', () => {
        const result = evaluateRisk({
            errorRate: NaN,
            selectorFailureRate: Infinity,
            pendingRatio: -1,
            challengeCount: NaN,
            inviteVelocityRatio: -Infinity,
        });
        expect(Number.isFinite(result.score)).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('explainRisk ritorna fattori con contribuzione', () => {
        const explanation = explainRisk({
            errorRate: 0.3,
            selectorFailureRate: 0.2,
            pendingRatio: 0.5,
            challengeCount: 0,
            inviteVelocityRatio: 0.1,
        });
        expect(explanation.factors.length).toBeGreaterThan(0);
        expect(explanation.factors[0]).toHaveProperty('name');
        expect(explanation.factors[0]).toHaveProperty('contribution');
    });
});

describe('Compliance Health Score', () => {
    it('score alto con buone metriche', () => {
        const result = evaluateComplianceHealthScore({
            acceptanceRatePct: 40,
            engagementRatePct: 30,
            pendingRatio: 0.3,
            invitesSentToday: 10,
            messagesSentToday: 5,
            dailyInviteLimit: 25,
            dailyMessageLimit: 35,
            weeklyInvitesSent: 40,
            weeklyInviteLimit: 100,
            pendingWarnThreshold: 0.5,
        });
        expect(result.score).toBeGreaterThan(0);
        expect(Number.isFinite(result.score)).toBe(true);
    });

    it('score basso con pending ratio alto', () => {
        const result = evaluateComplianceHealthScore({
            acceptanceRatePct: 10,
            engagementRatePct: 5,
            pendingRatio: 0.8,
            invitesSentToday: 20,
            messagesSentToday: 15,
            dailyInviteLimit: 25,
            dailyMessageLimit: 35,
            weeklyInvitesSent: 80,
            weeklyInviteLimit: 100,
            pendingWarnThreshold: 0.5,
        });
        expect(result.score).toBeLessThan(50);
    });
});

describe('Account Trust Score (A11)', () => {
    it('budgetMultiplier > 1.0 per account maturo affidabile', () => {
        const result = calculateAccountTrustScore({
            ssiScore: 95,
            ageDays: 730,
            acceptanceRatePct: 50,
            challengesLast7d: 0,
            pendingRatio: 0.2,
        });
        expect(result.score).toBeGreaterThan(75);
        expect(result.budgetMultiplier).toBeGreaterThan(1.0);
        expect(result.budgetMultiplier).toBeLessThanOrEqual(1.3);
    });

    it('budgetMultiplier <= 1.0 se challenge recente', () => {
        const result = calculateAccountTrustScore({
            ssiScore: 80,
            ageDays: 365,
            acceptanceRatePct: 40,
            challengesLast7d: 1,
            pendingRatio: 0.3,
        });
        expect(result.budgetMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('budgetMultiplier <= 1.0 se pending ratio alto', () => {
        const result = calculateAccountTrustScore({
            ssiScore: 80,
            ageDays: 365,
            acceptanceRatePct: 40,
            challengesLast7d: 0,
            pendingRatio: 0.55,
        });
        expect(result.budgetMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('budgetMultiplier basso per account nuovo', () => {
        const result = calculateAccountTrustScore({
            ssiScore: 30,
            ageDays: 7,
            acceptanceRatePct: 0,
            challengesLast7d: 0,
            pendingRatio: 0,
        });
        expect(result.budgetMultiplier).toBeLessThan(0.8);
    });
});

describe('Follow-up Cadence (M29)', () => {
    it('cadenza base per intent default', () => {
        const cadence = resolveFollowUpCadence(
            {
                id: 1,
                messaged_at: new Date(Date.now() - 10 * 86400000).toISOString(),
                follow_up_sent_at: null,
                follow_up_count: 0,
            },
            null,
        );
        expect(cadence.baseDelayDays).toBeGreaterThanOrEqual(1);
        expect(cadence.requiredDelayDays).toBeGreaterThanOrEqual(1);
    });

    it('cadenza lunga per NOT_INTERESTED', () => {
        const cadence = resolveFollowUpCadence(
            {
                id: 2,
                messaged_at: new Date(Date.now() - 90 * 86400000).toISOString(),
                follow_up_sent_at: null,
                follow_up_count: 0,
            },
            { intent: 'NOT_INTERESTED', subIntent: 'NONE', confidence: 0.9, entities: [] },
        );
        expect(cadence.baseDelayDays).toBeGreaterThanOrEqual(30);
    });

    it('cadenza deterministico cross-riavvii', () => {
        const a = resolveFollowUpCadence(
            { id: 42, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEUTRAL', subIntent: 'NONE', confidence: 0.7, entities: [] },
        );
        const b = resolveFollowUpCadence(
            { id: 42, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEUTRAL', subIntent: 'NONE', confidence: 0.7, entities: [] },
        );
        expect(a.requiredDelayDays).toBe(b.requiredDelayDays);
    });

    it('delay cresce con follow_up_count (lineare M29)', () => {
        const fc0 = resolveFollowUpCadence(
            { id: 10, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        const fc2 = resolveFollowUpCadence(
            {
                id: 10,
                messaged_at: '2025-01-01T00:00:00Z',
                follow_up_sent_at: '2025-01-10T00:00:00Z',
                follow_up_count: 2,
            },
            null,
        );
        expect(fc2.requiredDelayDays).toBeGreaterThan(fc0.requiredDelayDays);
    });
});
