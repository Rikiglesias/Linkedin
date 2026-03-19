import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk } from '../risk/riskEngine';
import { config } from '../config';

beforeAll(() => {
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.lowActivityRiskThreshold = 45;
    config.lowActivityEnabled = true;
    config.pendingRatioWarn = 0.5;
    config.pendingRatioStop = 0.7;
    config.lowActivityPendingThreshold = 0.55;
});

describe('Risk Engine — advanced', () => {
    it('score cresce con errorRate', () => {
        const low = evaluateRisk({ errorRate: 0.1, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        const high = evaluateRisk({ errorRate: 0.8, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(high.score).toBeGreaterThan(low.score);
    });

    it('score cresce con selectorFailureRate', () => {
        const low = evaluateRisk({ errorRate: 0, selectorFailureRate: 0.1, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        const high = evaluateRisk({ errorRate: 0, selectorFailureRate: 0.8, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(high.score).toBeGreaterThan(low.score);
    });

    it('challengeCount cap a 30 punti', () => {
        const c3 = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 3, inviteVelocityRatio: 0 });
        const c10 = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 10, inviteVelocityRatio: 0 });
        // Entrambi dovrebbero avere lo stesso contributo challenge (cap 30)
        expect(c3.score).toBe(c10.score);
    });

    it('explainRisk ha triggers per STOP', () => {
        const explanation = explainRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 1, inviteVelocityRatio: 0 });
        expect(explanation.triggers.length).toBeGreaterThan(0);
    });

    it('explainRisk ha thresholds', () => {
        const explanation = explainRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(explanation.thresholds).toHaveProperty('riskWarn');
        expect(explanation.thresholds).toHaveProperty('riskStop');
    });
});

describe('evaluateRisk — action thresholds', () => {
    it('score alto senza challenge → WARN o LOW_ACTIVITY', () => {
        const result = evaluateRisk({ errorRate: 0.6, selectorFailureRate: 0.4, pendingRatio: 0.3, challengeCount: 0, inviteVelocityRatio: 0.5 });
        expect(['WARN', 'LOW_ACTIVITY', 'STOP']).toContain(result.action);
    });

    it('tutti a zero → NORMAL', () => {
        const result = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(result.action).toBe('NORMAL');
    });

    it('score è intero (Math.round)', () => {
        const result = evaluateRisk({ errorRate: 0.33, selectorFailureRate: 0.17, pendingRatio: 0.22, challengeCount: 0, inviteVelocityRatio: 0.11 });
        expect(result.score % 1).toBe(0);
    });
});
