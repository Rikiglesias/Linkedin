import { describe, it, expect } from 'vitest';
import { desktopFingerprintPool, mobileFingerprintPool, pickDeterministicFingerprint } from '../fingerprint/pool';

describe('Fingerprint Pool (M27/M33)', () => {
    it('desktop pool ha almeno 20 fingerprint', () => {
        expect(desktopFingerprintPool.length).toBeGreaterThanOrEqual(20);
    });

    it('mobile pool ha almeno 5 fingerprint', () => {
        expect(mobileFingerprintPool.length).toBeGreaterThanOrEqual(5);
    });

    it('ogni fingerprint ha id, ja3, userAgent, viewport', () => {
        for (const fp of desktopFingerprintPool) {
            expect(fp.id).toBeTruthy();
            expect(fp.ja3).toBeTruthy();
            expect(fp.userAgent).toBeTruthy();
            expect(fp.viewport.width).toBeGreaterThan(0);
            expect(fp.viewport.height).toBeGreaterThan(0);
        }
    });

    it('id unici nel pool desktop', () => {
        const ids = desktopFingerprintPool.map(fp => fp.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('id unici nel pool mobile', () => {
        const ids = mobileFingerprintPool.map(fp => fp.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('locale diversificato (non solo it-IT)', () => {
        const locales = new Set(desktopFingerprintPool.map(fp => fp.locale).filter(Boolean));
        expect(locales.size).toBeGreaterThan(1);
    });

    it('browser diversificati (Chrome, Firefox, Edge, Safari)', () => {
        const uas = desktopFingerprintPool.map(fp => fp.userAgent);
        expect(uas.some(ua => ua.includes('Chrome'))).toBe(true);
        expect(uas.some(ua => ua.includes('Firefox'))).toBe(true);
        expect(uas.some(ua => ua.includes('Edg'))).toBe(true);
        expect(uas.some(ua => ua.includes('Safari') && !ua.includes('Chrome'))).toBe(true);
    });

    it('viewport diversificati', () => {
        const viewports = new Set(desktopFingerprintPool.map(fp => `${fp.viewport.width}x${fp.viewport.height}`));
        expect(viewports.size).toBeGreaterThan(5);
    });

    describe('pickDeterministicFingerprint', () => {
        it('stesso accountId → stesso fingerprint (deterministico)', () => {
            const a = pickDeterministicFingerprint(desktopFingerprintPool, 'account-1');
            const b = pickDeterministicFingerprint(desktopFingerprintPool, 'account-1');
            expect(a.id).toBe(b.id);
        });

        it('accountId diversi → fingerprint potenzialmente diversi', () => {
            const results = new Set<string>();
            for (let i = 0; i < 10; i++) {
                const fp = pickDeterministicFingerprint(desktopFingerprintPool, `account-${i}`);
                results.add(fp.id);
            }
            expect(results.size).toBeGreaterThan(1);
        });

        it('pool vuoto → fallback a desktopFingerprintPool', () => {
            const fp = pickDeterministicFingerprint([], 'test');
            expect(fp).toBeTruthy();
            expect(fp.id).toBeTruthy();
        });

        it('pool con 1 elemento → ritorna sempre quello', () => {
            const single = [desktopFingerprintPool[0] as typeof desktopFingerprintPool[number]];
            const fp = pickDeterministicFingerprint(single, 'any-account');
            expect(fp.id).toBe(single[0].id);
        });
    });
});
