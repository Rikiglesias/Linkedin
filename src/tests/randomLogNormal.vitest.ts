import { describe, it, expect } from 'vitest';
import { logNormalDelayMs, sampleStandardNormal } from '../utils/random';

/**
 * B2 (2026-06-07): verifica che logNormalDelayMs produca una distribuzione LOG-NORMALE
 * (right-skew, biometric umano) clampata — sostituisce i delay uniformi inter-keystroke.
 */
describe('logNormalDelayMs — distribuzione anti-ban inter-keystroke', () => {
    const N = 8000;

    function samples(median: number, sigma: number, min: number, max: number): number[] {
        return Array.from({ length: N }, () => logNormalDelayMs(median, sigma, min, max));
    }

    it('rispetta sempre il clamp [min, max] e ritorna interi', () => {
        for (const v of samples(60, 0.42, 28, 240)) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(28);
            expect(v).toBeLessThanOrEqual(240);
        }
    });

    it('mediana ≈ medianMs (entro tolleranza)', () => {
        const arr = samples(60, 0.42, 28, 240).sort((a, b) => a - b);
        const median = arr[Math.floor(arr.length / 2)];
        expect(median).toBeGreaterThan(50);
        expect(median).toBeLessThan(72);
    });

    it('right-skew: media > mediana (coda destra, non simmetrica/uniforme)', () => {
        const arr = samples(60, 0.42, 28, 240).sort((a, b) => a - b);
        const median = arr[Math.floor(arr.length / 2)];
        const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
        expect(mean).toBeGreaterThan(median);
    });

    it('sigma maggiore → maggiore dispersione (più varianza)', () => {
        const lowSigma = samples(60, 0.2, 1, 100000);
        const highSigma = samples(60, 0.6, 1, 100000);
        const variance = (xs: number[]): number => {
            const m = xs.reduce((s, x) => s + x, 0) / xs.length;
            return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
        };
        expect(variance(highSigma)).toBeGreaterThan(variance(lowSigma));
    });

    it('sampleStandardNormal: media ≈ 0, |valori| quasi sempre < 5', () => {
        const arr = Array.from({ length: N }, () => sampleStandardNormal());
        const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
        expect(Math.abs(mean)).toBeLessThan(0.15);
        expect(arr.every((x) => Math.abs(x) < 8)).toBe(true);
    });
});
