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

describe('evaluateRisk — extreme inputs', () => {
    it('tutti al massimo → score 100', () => {
        const r = evaluateRisk({ errorRate: 10, selectorFailureRate: 10, pendingRatio: 10, challengeCount: 100, inviteVelocityRatio: 10 });
        expect(r.score).toBe(100);
    });

    it('valori negativi → score 0 o basso', () => {
        const r = evaluateRisk({ errorRate: -1, selectorFailureRate: -1, pendingRatio: -1, challengeCount: -1, inviteVelocityRatio: -1 });
        expect(r.score).toBe(0);
    });

    it('solo errorRate alto → score proporzionale', () => {
        const r = evaluateRisk({ errorRate: 1.0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBe(40); // errorRate * 40
    });

    it('solo selectorFailureRate alto → score proporzionale', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 1.0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBe(20); // selectorFailureRate * 20
    });

    it('solo pendingRatio alto → score proporzionale', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 1.0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBe(25); // pendingRatio * 25
    });

    it('solo inviteVelocityRatio alto → score proporzionale', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 1.0 });
        expect(r.score).toBe(15); // inviteVelocityRatio * 15
    });

    it('challengeCount 3 → contributo 30 (cap)', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 3, inviteVelocityRatio: 0 });
        expect(r.score).toBe(30); // min(30, 3*10)
    });

    it('challengeCount 5 → contributo ancora 30 (cap)', () => {
        const r = evaluateRisk({ errorRate: 0, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 5, inviteVelocityRatio: 0 });
        expect(r.score).toBe(30); // min(30, 5*10) = 30
    });

    it('score = 40+20+25+30+15 = 100 al massimo', () => {
        const r = evaluateRisk({ errorRate: 1, selectorFailureRate: 1, pendingRatio: 1, challengeCount: 3, inviteVelocityRatio: 1 });
        expect(r.score).toBe(100);
    });

    it('Infinity in input → clamped a 100', () => {
        const r = evaluateRisk({ errorRate: Infinity, selectorFailureRate: 0, pendingRatio: 0, challengeCount: 0, inviteVelocityRatio: 0 });
        expect(r.score).toBeLessThanOrEqual(100);
    });
});
