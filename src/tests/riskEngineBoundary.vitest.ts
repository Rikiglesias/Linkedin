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

describe('evaluateRisk — boundary values', () => {
    it('errorRate esattamente 0.5 → score 20', () => {
        expect(evaluateRisk({ errorRate: 0.5, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 }).score).toBe(20);
    });

    it('selectorFailureRate esattamente 0.5 → score 10', () => {
        expect(evaluateRisk({ errorRate: 0, selectorFailureRate: 0.5, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 }).score).toBe(10);
    });

    it('pendingRatio esattamente 0.5 → score 13', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0.5, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBe(13); // 0.5 * 25 = 12.5 → round 13
    });

    it('inviteVelocityRatio esattamente 1.0 → score 15', () => {
        expect(evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 1.0 }).score).toBe(15);
    });

    it('challengeCount esattamente 1 → score 10 e action STOP', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 1, inviteVelocityRatio: 0 });
        expect(r.score).toBe(10);
        expect(r.action).toBe('STOP');
    });

    it('challengeCount 2 → score 20', () => {
        expect(evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 2, inviteVelocityRatio: 0 }).score).toBe(20);
    });

    it('score esattamente a warnThreshold 30 → WARN', () => {
        // errorRate 0.75 * 40 = 30
        const r = evaluateRisk({ errorRate: 0.75, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBe(30);
        expect(r.action).toBe('WARN');
    });
});
