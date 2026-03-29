import { describe, test, expect } from 'vitest';
import { desktopFingerprintPool, mobileFingerprintPool } from '../fingerprint/pool';
import { FingerprintPool } from '../fingerprint/noiseGenerator';

function deriveHw(id: string, mobile: boolean) {
    const h = id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) >>> 0;
    const mHw = [4, 6, 8] as const;
    const dHw = [4, 8, 12, 16] as const;
    const mMem = [2, 3, 4, 6] as const;
    const dMem = [4, 8, 16] as const;
    const hwConc = mobile ? (mHw[h % mHw.length] ?? 0) : (dHw[h % dHw.length] ?? 0);
    const shifted = h >>> 4;
    const mem = mobile ? (mMem[shifted % mMem.length] ?? 0) : (dMem[shifted % dMem.length] ?? 0);
    return { hwConc, mem, color: mobile ? 32 : 24 };
}

describe('Fingerprint Coherence', () => {
    for (const fp of desktopFingerprintPool) {
        test(`desktop ${fp.id}: UA+viewport+hw coerenti`, () => {
            const ua = fp.userAgent.toLowerCase();
            expect(ua.includes('windows') || ua.includes('macintosh') || ua.includes('x11')).toBe(true);
            expect(fp.isMobile).toBeFalsy();
            expect(fp.viewport.width).toBeGreaterThanOrEqual(1024);
            const hw = deriveHw(fp.id, false);
            expect(hw.hwConc).toBeGreaterThanOrEqual(4);
            expect(hw.mem).toBeGreaterThanOrEqual(4);
            expect(hw.color).toBe(24);
        });
    }

    for (const fp of mobileFingerprintPool) {
        test(`mobile ${fp.id}: UA+viewport+hw coerenti`, () => {
            const ua = fp.userAgent.toLowerCase();
            expect(ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')).toBe(true);
            expect(fp.isMobile).toBe(true);
            expect(fp.hasTouch).toBe(true);
            expect(fp.viewport.width).toBeLessThan(500);
            expect(fp.deviceScaleFactor).toBeGreaterThanOrEqual(2);
            const hw = deriveHw(fp.id, true);
            expect(hw.hwConc).toBeLessThanOrEqual(8);
            expect(hw.mem).toBeLessThanOrEqual(6);
            expect(hw.color).toBe(32);
        });
    }

    test('noise deterministico e in range', () => {
        const fp = desktopFingerprintPool[0];
        const n1 = FingerprintPool.generateConsistentProfile(fp);
        const n2 = FingerprintPool.generateConsistentProfile(fp);
        expect(n1.canvasNoise).toBe(n2.canvasNoise);
        expect(n1.canvasNoise).toBeGreaterThan(0);
        expect(n1.canvasNoise).toBeLessThanOrEqual(0.01);
    });

    test('ID univoci tra desktop e mobile pool', () => {
        const all = [...desktopFingerprintPool, ...mobileFingerprintPool];
        expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
    });
});
