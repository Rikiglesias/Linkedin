import { describe, it, expect, afterEach } from 'vitest';
import { buildLimitsAndRiskDomainConfig } from '../config/domains';

/**
 * Invarianti anti-ban DIFENSIVI (Gruppo A hardening 2026-06-07).
 * Lock dei default che proteggono l'account: un cambio futuro che li allenta
 * (es. alza il pending stop sopra il red-flag) deve far fallire questo test.
 * Tutti restano env-overridable: questi sono i DEFAULT, non hard-cap.
 */
describe('anti-ban defensive defaults — pending ratio', () => {
    const KEYS = ['PENDING_RATIO_STOP', 'PENDING_RATIO_WARN'] as const;
    const saved: Record<string, string | undefined> = {};

    function withCleanEnv(): ReturnType<typeof buildLimitsAndRiskDomainConfig> {
        for (const k of KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
        return buildLimitsAndRiskDomainConfig();
    }

    afterEach(() => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it('default pendingRatioStop = 0.65 (hard STOP al red-flag, non 0.80)', () => {
        const cfg = withCleanEnv();
        expect(cfg.pendingRatioStop).toBe(0.65);
    });

    it('default pendingRatioWarn = 0.55 (anticipato)', () => {
        const cfg = withCleanEnv();
        expect(cfg.pendingRatioWarn).toBe(0.55);
    });

    it('invariante escalation: warn < stop, stop <= 0.65 (anti red-flag)', () => {
        const cfg = withCleanEnv();
        expect(cfg.pendingRatioWarn).toBeLessThan(cfg.pendingRatioStop);
        expect(cfg.pendingRatioStop).toBeLessThanOrEqual(0.65);
    });

    it('resta env-overridable (PENDING_RATIO_STOP ha precedenza)', () => {
        saved.PENDING_RATIO_STOP = process.env.PENDING_RATIO_STOP;
        process.env.PENDING_RATIO_STOP = '0.7';
        const cfg = buildLimitsAndRiskDomainConfig();
        expect(cfg.pendingRatioStop).toBe(0.7);
    });
});
