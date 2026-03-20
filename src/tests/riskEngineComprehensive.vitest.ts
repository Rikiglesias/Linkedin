import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk } from '../risk/riskEngine';
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

describe('evaluateRisk — comprehensive action mapping', () => {
    it('score 0 → NORMAL', () => {
        expect(evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 }).action).toBe('NORMAL');
    });

    it('score 29 → NORMAL (sotto warnThreshold 30)', () => {
        // errorRate 0.725 * 40 = 29
        expect(evaluateRisk({ errorRate: 0.725, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 }).score).toBe(29);
    });

    it('challenge > 0 → sempre STOP indipendentemente dal score', () => {
        expect(evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 1, inviteVelocityRatio: 0 }).action).toBe('STOP');
    });

    it('pendingRatio >= pendingRatioStop → STOP o LOW_ACTIVITY', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0.75, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(['STOP', 'LOW_ACTIVITY']).toContain(r.action);
    });

    it('snapshot contiene tutti i campi', () => {
        const r = evaluateRisk({ errorRate: 0.3, selectorFailureRate: 0.2, pendingRatio: 0.4, challengeCount: 0, inviteVelocityRatio: 0.1 });
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('pendingRatio');
        expect(r).toHaveProperty('errorRate');
        expect(r).toHaveProperty('selectorFailureRate');
        expect(r).toHaveProperty('challengeCount');
        expect(r).toHaveProperty('inviteVelocityRatio');
        expect(r).toHaveProperty('action');
    });

    it('score è sempre intero 0-100', () => {
        const inputs = [
            { errorRate: 0.1, selectorFailureRate: 0.2, pendingRatio: 0.3, challengeCount: 0, inviteVelocityRatio: 0.4 },
            { errorRate: 0.9, selectorFailureRate: 0.8, pendingRatio: 0.7, challengeCount: 2, inviteVelocityRatio: 0.6 },
            { errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 },
        ];
        for (const input of inputs) {
            const r = evaluateRisk(input);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(100);
            expect(r.score % 1).toBe(0);
        }
    });

    it('pendingRatio nel snapshot corrisponde all\'input', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0.42, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.pendingRatio).toBeCloseTo(0.42, 2);
    });
});
