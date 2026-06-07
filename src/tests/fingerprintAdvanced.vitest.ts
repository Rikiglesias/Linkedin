import { describe, it, expect } from 'vitest';
import { desktopFingerprintPool, mobileFingerprintPool, pickDeterministicFingerprint } from '../fingerprint/pool';

describe('Fingerprint Pool — advanced', () => {
    it('nessun fingerprint desktop ha viewport < 1024px width', () => {
        for (const fp of desktopFingerprintPool) {
            expect(fp.viewport.width).toBeGreaterThanOrEqual(1024);
        }
    });

    it('tutti i mobile hanno isMobile=true', () => {
        for (const fp of mobileFingerprintPool) {
            expect(fp.isMobile).toBe(true);
        }
    });

    it('tutti i mobile hanno hasTouch=true', () => {
        for (const fp of mobileFingerprintPool) {
            expect(fp.hasTouch).toBe(true);
        }
    });

    it('tutti i mobile hanno deviceScaleFactor > 1', () => {
        for (const fp of mobileFingerprintPool) {
            expect(fp.deviceScaleFactor).toBeGreaterThan(1);
        }
    });

    it('JA3 fingerprint non vuoti', () => {
        for (const fp of [...desktopFingerprintPool, ...mobileFingerprintPool]) {
            expect(fp.ja3.length).toBeGreaterThan(50);
        }
    });

    it('userAgent contiene versione browser', () => {
        for (const fp of desktopFingerprintPool) {
            // Tutti i UA contengono almeno un numero di versione (es. "132.0")
            expect(fp.userAgent).toMatch(/\d+\.\d+/);
        }
    });

    it('pickDeterministicFingerprint: account diversi → fingerprint diversi (buona distribuzione)', () => {
        // A7 (2026-06-07): fingerprint STABILE per account (rimossa la rotazione settimanale che
        // poteva fare downgrade versione / cambio OS-famiglia). Qui verifichiamo la distribuzione:
        // account diversi producono fingerprint diversi (de-correlazione).
        const results = new Set<string>();
        for (let i = 0; i < desktopFingerprintPool.length + 5; i++) {
            results.add(pickDeterministicFingerprint(desktopFingerprintPool, `acc-${i}`).id);
        }
        // Con 24+ fingerprint e N account, dovremmo avere buona distribuzione
        expect(results.size).toBeGreaterThan(5);
    });

    it('mobile pool ha viewport width < 500', () => {
        for (const fp of mobileFingerprintPool) {
            expect(fp.viewport.width).toBeLessThan(500);
        }
    });
});
