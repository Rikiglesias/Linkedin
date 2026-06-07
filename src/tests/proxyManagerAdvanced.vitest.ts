import { describe, it, expect } from 'vitest';
import { markProxyFailed, computeProxyCooldownMs, parseProxyEntry, buildProxyUrl } from '../proxyManager';

// H22 fix: il file precedente asseriva solo `.not.toThrow()` (tautologico). Ora il cooldown
// differenziato e' una funzione pura esportata (computeProxyCooldownMs) e si asseriscono valori reali.

describe('proxyManager — computeProxyCooldownMs (H22, cooldown differenziato)', () => {
    it('ordina i cooldown: ban > connection_refused > timeout > 0', () => {
        const ban = computeProxyCooldownMs('ban');
        const refused = computeProxyCooldownMs('connection_refused');
        const timeout = computeProxyCooldownMs('timeout');
        expect(ban).toBeGreaterThan(refused);
        expect(refused).toBeGreaterThan(timeout);
        expect(timeout).toBeGreaterThan(0);
    });

    it('usa i valori attesi: ban=2h, connection_refused=15min, timeout=5min', () => {
        expect(computeProxyCooldownMs('ban')).toBe(120 * 60_000);
        expect(computeProxyCooldownMs('connection_refused')).toBe(15 * 60_000);
        expect(computeProxyCooldownMs('timeout')).toBe(5 * 60_000);
    });

    it('errore sconosciuto/undefined → default config (> 0)', () => {
        expect(computeProxyCooldownMs(undefined)).toBeGreaterThan(0);
        expect(computeProxyCooldownMs('unknown')).toBeGreaterThan(0);
    });
});

describe('proxyManager — parseProxyEntry (H22)', () => {
    it('input vuoto / commento → null', () => {
        expect(parseProxyEntry('')).toBeNull();
        expect(parseProxyEntry('   ')).toBeNull();
        expect(parseProxyEntry('# commento')).toBeNull();
    });

    it('URL con credenziali → server, username e password estratti', () => {
        const p = parseProxyEntry('http://user:pass@proxy.example.com:8080');
        expect(p).not.toBeNull();
        expect(p?.server).toContain('proxy.example.com');
        expect(p?.username).toBe('user');
        expect(p?.password).toBe('pass');
    });

    it('formato host:port:user:pass → config con credenziali', () => {
        const p = parseProxyEntry('proxy.example.com:8080:user:pass');
        expect(p).not.toBeNull();
        expect(p?.server).toContain('proxy.example.com');
        expect(p?.username).toBe('user');
    });
});

describe('proxyManager — buildProxyUrl (H22)', () => {
    it('ricostruisce un URL non vuoto da un ProxyConfig parsato', () => {
        const p = parseProxyEntry('http://user:pass@proxy.example.com:8080');
        expect(p).not.toBeNull();
        if (p) {
            const url = buildProxyUrl(p);
            expect(typeof url).toBe('string');
            expect(url.length).toBeGreaterThan(0);
            expect(url).toContain('proxy.example.com');
        }
    });
});

describe('proxyManager — markProxyFailed (smoke, non deve lanciare)', () => {
    it('accetta tutti i tipi di errore senza lanciare', () => {
        for (const t of ['ban', 'timeout', 'connection_refused', undefined] as const) {
            expect(() => markProxyFailed({ server: 'http://proxy:8080' }, t)).not.toThrow();
        }
    });
});
