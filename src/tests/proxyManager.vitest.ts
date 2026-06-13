import { describe, it, expect } from 'vitest';
import { markProxyFailed, markIntegrationProxyFailed, computeProxyCooldownMs } from '../proxyManager';

describe('proxyManager — markProxyFailed (M34)', () => {
    it('non lancia con proxy valido e timeout', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'timeout')).not.toThrow();
    });

    it('non lancia con proxy valido e ban', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'ban')).not.toThrow();
    });

    it('non lancia con proxy valido e connection_refused', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'connection_refused')).not.toThrow();
    });

    it('non lancia con errorType undefined', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' })).not.toThrow();
    });

    it('non lancia con errorType unknown', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'unknown')).not.toThrow();
    });
});

describe('proxyManager — markIntegrationProxyFailed (M34 esteso, cooldown differenziato)', () => {
    it('non lancia con i vari errorType e con undefined', () => {
        for (const t of ['timeout', 'connection_refused', 'ban', 'unknown', undefined] as const) {
            expect(() => markIntegrationProxyFailed({ server: 'http://proxy.test:8081' }, t)).not.toThrow();
        }
    });

    it('usa computeProxyCooldownMs: cooldown transient << cooldown default (poolSize=1 non bloccato 30min)', () => {
        // Invariante che il fix sfrutta: un timeout sull'enrichment non deve costare quanto il default.
        expect(computeProxyCooldownMs('timeout')).toBeLessThan(computeProxyCooldownMs(undefined));
        expect(computeProxyCooldownMs('connection_refused')).toBeLessThan(computeProxyCooldownMs(undefined));
        expect(computeProxyCooldownMs('timeout')).toBeLessThan(computeProxyCooldownMs('connection_refused'));
        // I ban restano puniti a lungo (invariato).
        expect(computeProxyCooldownMs('ban')).toBeGreaterThan(computeProxyCooldownMs('connection_refused'));
    });
});
