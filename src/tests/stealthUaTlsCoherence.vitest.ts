/**
 * stealthUaTlsCoherence.vitest.ts — C12 del contratto `bot-operativo`: guardia UA↔engine FAIL-CLOSED su ENTRAMBI i pool.
 *
 * (a) pool locale senza UA coerente con l'engine → errore che nomina l'engine e la famiglia attesa (mai il pool intero);
 * (b) `useJa3Proxy=true` NON bypassa più la guardia: stesso pool del caso `false` (CycleTLS spoofa il JA3 delle richieste
 *     proxate, ma l'engine — Gecko vs Blink — resta osservabile dalla pagina: uno UA Chrome su Camoufox è spoofing);
 * (c) pool cloud TUTTO incoerente → fingerprint LOCALE della famiglia attesa + warn (prima: ricadeva sul cloud incoerente);
 * (d) pool cloud misto → solo i coerenti.
 * I pool locali sono mockati (mutabili per caso), `pickDeterministicFingerprint` è quello reale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Fingerprint } from '../fingerprint/pool';

const h = vi.hoisted(() => ({
    config: {
        browserEngine: 'camoufox' as 'chromium' | 'firefox' | 'camoufox',
        useJa3Proxy: false,
        mobileProbability: 0,
        timezone: 'Europe/Rome',
        ja3Fingerprint: '',
    },
    desktop: [] as Fingerprint[],
    mobile: [] as Fingerprint[],
}));

vi.mock('../config', () => ({ config: h.config }));
vi.mock('../fingerprint/pool', async (importOriginal) => {
    const real = await importOriginal<typeof import('../fingerprint/pool')>();
    return { ...real, desktopFingerprintPool: h.desktop, mobileFingerprintPool: h.mobile };
});

import { pickBrowserFingerprint, pickDesktopFingerprint, pickMobileFingerprint } from '../browser/stealth';
import type { CloudFingerprint } from '../browser/stealth';
import { detectBrowserFamily } from '../proxy/ja3Validator';

const CHROME_UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
const FIREFOX_UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0',
];
const CHROME_ANDROID_UAS = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
];
const FIREFOX_ANDROID_UA = 'Mozilla/5.0 (Android 15; Mobile; rv:134.0) Gecko/134.0 Firefox/134.0';

function local(id: string, userAgent: string, isMobile = false): Fingerprint {
    return {
        id,
        ja3: '',
        userAgent,
        viewport: isMobile ? { width: 412, height: 915 } : { width: 1920, height: 1080 },
        isMobile,
        hasTouch: isMobile,
        deviceScaleFactor: isMobile ? 2.5 : 1,
    };
}

function cloud(userAgent: string, isMobile = false): CloudFingerprint {
    return { userAgent, isMobile, viewport: isMobile ? { width: 412, height: 915 } : { width: 1920, height: 1080 } };
}

function setLocalPools(desktop: Fingerprint[], mobile: Fingerprint[]): void {
    h.desktop.splice(0, h.desktop.length, ...desktop);
    h.mobile.splice(0, h.mobile.length, ...mobile);
}

const MIXED_DESKTOP = [...CHROME_UAS.map((ua, i) => local(`c${i}`, ua)), ...FIREFOX_UAS.map((ua, i) => local(`f${i}`, ua))];
const MIXED_MOBILE = [...CHROME_ANDROID_UAS.map((ua, i) => local(`cm${i}`, ua, true)), local('fm0', FIREFOX_ANDROID_UA, true)];
const ACCOUNTS = Array.from({ length: 25 }, (_, i) => `acc-${i}`);

describe('C12 — guardia UA↔engine fail-closed', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        h.config.browserEngine = 'camoufox';
        h.config.useJa3Proxy = false;
        setLocalPools(MIXED_DESKTOP, MIXED_MOBILE);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it('(a) pool locale solo-Chrome con engine camoufox → errore che nomina engine e famiglia attesa, mai il pool intero', () => {
        setLocalPools(
            CHROME_UAS.map((ua, i) => local(`c${i}`, ua)),
            CHROME_ANDROID_UAS.map((ua, i) => local(`cm${i}`, ua, true)),
        );
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/camoufox/);
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/firefox/i);
        expect(() => pickMobileFingerprint([], 'acc-0')).toThrow(/camoufox/);
        expect(() => pickMobileFingerprint([], 'acc-0')).toThrow(/firefox/i);
    });

    it('(a-bis) engine firefox si comporta come camoufox; engine chromium rifiuta un pool locale solo-Firefox', () => {
        h.config.browserEngine = 'firefox';
        setLocalPools(
            CHROME_UAS.map((ua, i) => local(`c${i}`, ua)),
            CHROME_ANDROID_UAS.map((ua, i) => local(`cm${i}`, ua, true)),
        );
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/firefox/i);

        h.config.browserEngine = 'chromium';
        setLocalPools(
            FIREFOX_UAS.map((ua, i) => local(`f${i}`, ua)),
            [local('fm0', FIREFOX_ANDROID_UA, true)],
        );
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/chromium/);
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/chrome/i);
    });

    it('(b) useJa3Proxy=true + camoufox → stesso pool (e stesso fingerprint) del caso false: nessun bypass', () => {
        for (const account of ACCOUNTS) {
            h.config.useJa3Proxy = false;
            const senza = pickDesktopFingerprint([], account);
            h.config.useJa3Proxy = true;
            const con = pickDesktopFingerprint([], account);
            expect(con.userAgent).toBe(senza.userAgent);
            expect(con.id).toBe(senza.id);
            expect(detectBrowserFamily(con.userAgent)).toBe('firefox');
        }
        // Anche con useJa3Proxy=true il pool solo-Chrome resta rifiutato.
        setLocalPools(CHROME_UAS.map((ua, i) => local(`c${i}`, ua)), []);
        expect(() => pickDesktopFingerprint([], 'acc-0')).toThrow(/camoufox/);
    });

    it('(c) pool cloud TUTTO incoerente + camoufox → fingerprint LOCALE della famiglia attesa + warn', () => {
        const cloudAllChrome = CHROME_UAS.map((ua) => cloud(ua));
        const localFirefoxUas = new Set(FIREFOX_UAS);
        for (const account of ACCOUNTS) {
            const fp = pickDesktopFingerprint(cloudAllChrome, account);
            expect(detectBrowserFamily(fp.userAgent)).toBe('firefox');
            expect(localFirefoxUas.has(fp.userAgent)).toBe(true);
        }
        expect(warn).toHaveBeenCalled();
        const messaggio = String(warn.mock.calls[0]?.[0] ?? '');
        expect(messaggio).toMatch(/camoufox/);
        expect(messaggio).toMatch(/incoerente/i);
        expect(messaggio).toMatch(/firefox/i);
    });

    it('(c-bis) cloud mobile tutto-Chrome + camoufox → UA Firefox Android locale', () => {
        const cloudMobileChrome = CHROME_ANDROID_UAS.map((ua) => cloud(ua, true));
        const fp = pickMobileFingerprint(cloudMobileChrome, 'acc-3');
        expect(fp.userAgent).toBe(FIREFOX_ANDROID_UA);
        expect(fp.isMobile).toBe(true);
    });

    it('(d) pool cloud misto → solo i coerenti: con camoufox mai uno UA Chrome, con chromium mai uno UA Firefox', () => {
        const cloudMixed = [...CHROME_UAS.map((ua) => cloud(ua)), ...FIREFOX_UAS.map((ua) => cloud(ua))];
        const cloudFirefox = new Set(FIREFOX_UAS);
        const cloudChrome = new Set(CHROME_UAS);

        for (const account of ACCOUNTS) {
            const fp = pickBrowserFingerprint(cloudMixed, false, account);
            expect(cloudFirefox.has(fp.userAgent), `${account}: ${fp.userAgent}`).toBe(true);
        }
        expect(warn).not.toHaveBeenCalled();

        h.config.browserEngine = 'chromium';
        for (const account of ACCOUNTS) {
            const fp = pickBrowserFingerprint(cloudMixed, false, account);
            expect(cloudChrome.has(fp.userAgent), `${account}: ${fp.userAgent}`).toBe(true);
        }
        expect(warn).not.toHaveBeenCalled();
    });

    it('determinismo conservato: stesso account → stesso fingerprint, account diversi → più di un fingerprint', () => {
        const prima = ACCOUNTS.map((a) => pickDesktopFingerprint([], a).userAgent);
        const dopo = ACCOUNTS.map((a) => pickDesktopFingerprint([], a).userAgent);
        expect(dopo).toEqual(prima);
        expect(new Set(prima).size).toBeGreaterThan(1);
    });
});
