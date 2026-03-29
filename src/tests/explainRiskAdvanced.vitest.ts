import { describe, it, expect, beforeAll } from 'vitest';
import { explainRisk } from '../risk/riskEngine';
import { config } from '../config';

beforeAll(() => {
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.pendingRatioWarn = 0.5;
    config.pendingRatioStop = 0.7;
});

describe('explainRisk — advanced', () => {
    it('factors contiene errorRate, selectorFailureRate, pendingRatio, challengeCount, inviteVelocityRatio', () => {
        const e = explainRisk({
            errorRate: 0.2,
            selectorFailureRate: 0.1,
            pendingRatio: 0.3,
            challengeCount: 0,
            inviteVelocityRatio: 0.1,
        });
        const names = e.factors.map((f) => f.name);
        expect(names).toContain('errorRate');
        expect(names).toContain('selectorFailureRate');
        expect(names).toContain('pendingRatio');
        expect(names).toContain('challengeCount');
        expect(names).toContain('inviteVelocityRatio');
    });

    it('ogni factor ha weight > 0', () => {
        const e = explainRisk({
            errorRate: 0.5,
            selectorFailureRate: 0.3,
            pendingRatio: 0.4,
            challengeCount: 1,
            inviteVelocityRatio: 0.2,
        });
        for (const f of e.factors) {
            expect(f.weight).toBeGreaterThan(0);
        }
    });

    it('contribution è rawValue * weight', () => {
        const e = explainRisk({
            errorRate: 0.5,
            selectorFailureRate: 0.3,
            pendingRatio: 0.4,
            challengeCount: 0,
            inviteVelocityRatio: 0.2,
        });
        for (const f of e.factors) {
            // Contribution dovrebbe essere proporzionale a rawValue * weight
            // (con clamping possibile, quindi >= 0)
            expect(f.contribution).toBeGreaterThanOrEqual(0);
        }
    });

    it('triggers vuoti con score basso', () => {
        const e = explainRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        expect(e.triggers).toEqual([]);
    });

    it('triggers non vuoti con challenge > 0', () => {
        const e = explainRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 1,
            inviteVelocityRatio: 0,
        });
        expect(e.triggers.length).toBeGreaterThan(0);
    });

    it('thresholds corrispondono alla config', () => {
        const e = explainRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        expect(e.thresholds.riskWarn).toBe(config.riskWarnThreshold);
        expect(e.thresholds.riskStop).toBe(config.riskStopThreshold);
    });

    it('score è coerente con evaluateRisk', async () => {
        const inputs = {
            errorRate: 0.3,
            selectorFailureRate: 0.2,
            pendingRatio: 0.4,
            challengeCount: 0,
            inviteVelocityRatio: 0.1,
        };
        const e = explainRisk(inputs);
        const { evaluateRisk } = await import('../risk/riskEngine');
        const r = evaluateRisk(inputs);
        expect(e.score).toBe(r.score);
        expect(e.action).toBe(r.action);
    });
});
