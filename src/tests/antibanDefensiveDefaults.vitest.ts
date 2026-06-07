import { describe, it, expect, afterEach } from 'vitest';
import {
    buildLimitsAndRiskDomainConfig,
    buildCommsAndBusinessDomainConfig,
    buildProxyDomainConfig,
} from '../config/domains';

/**
 * Invarianti anti-ban DIFENSIVI (Gruppo A hardening 2026-06-07).
 * Lock dei default che proteggono l'account: un cambio futuro che li allenta
 * (pending stop sopra il red-flag, like/follow illimitati, Tor fallback default-on)
 * deve far fallire questo test. Tutti restano env-overridable: sono DEFAULT, non hard-cap.
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

describe('anti-ban defensive defaults — interaction caps (A4)', () => {
    const KEYS = ['LIKE_DAILY_CAP', 'FOLLOW_DAILY_CAP'] as const;
    const saved: Record<string, string | undefined> = {};

    function withCleanEnv(): ReturnType<typeof buildCommsAndBusinessDomainConfig> {
        for (const k of KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
        return buildCommsAndBusinessDomainConfig();
    }

    afterEach(() => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it('default likeDailyCap = 30 (prima illimitato)', () => {
        expect(withCleanEnv().likeDailyCap).toBe(30);
    });

    it('default followDailyCap = 15 (prima illimitato, più conservativo dei like)', () => {
        expect(withCleanEnv().followDailyCap).toBe(15);
    });

    it('invariante: follow cap <= like cap (i follow sono più rischiosi)', () => {
        const cfg = withCleanEnv();
        expect(cfg.followDailyCap).toBeLessThanOrEqual(cfg.likeDailyCap);
    });

    it('resta env-overridable (LIKE_DAILY_CAP ha precedenza)', () => {
        saved.LIKE_DAILY_CAP = process.env.LIKE_DAILY_CAP;
        process.env.LIKE_DAILY_CAP = '50';
        expect(buildCommsAndBusinessDomainConfig().likeDailyCap).toBe(50);
    });
});

describe('anti-ban defensive defaults — Tor fallback opt-in (A5)', () => {
    const KEY = 'PROXY_TOR_FALLBACK_ENABLED';
    let saved: string | undefined;

    afterEach(() => {
        if (saved === undefined) delete process.env[KEY];
        else process.env[KEY] = saved;
    });

    it('default proxyTorFallbackEnabled = false (Tor NON instradato di default)', () => {
        saved = process.env[KEY];
        delete process.env[KEY];
        expect(buildProxyDomainConfig().proxyTorFallbackEnabled).toBe(false);
    });

    it('resta env-overridable (PROXY_TOR_FALLBACK_ENABLED=true lo abilita)', () => {
        saved = process.env[KEY];
        process.env[KEY] = 'true';
        expect(buildProxyDomainConfig().proxyTorFallbackEnabled).toBe(true);
    });
});
