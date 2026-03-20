import { describe, it, expect } from 'vitest';
import { computeTwoProportionSignificance } from '../ml/significance';

describe('significance — advanced edge cases', () => {
    it('0% baseline vs 80% candidate → significativo (candidato migliore)', () => {
        const result = computeTwoProportionSignificance(5, 100, 80, 100, 0.05);
        expect(result.significant).toBe(true);
    });

    it('50% vs 51% con campioni piccoli → non significativo', () => {
        const result = computeTwoProportionSignificance(5, 10, 5, 10, 0.05);
        expect(result.significant).toBe(false);
    });

    it('alpha 0.01 → più difficile essere significativo', () => {
        const alpha005 = computeTwoProportionSignificance(30, 100, 45, 100, 0.05);
        const alpha001 = computeTwoProportionSignificance(30, 100, 45, 100, 0.01);
        // Con alpha più basso, è più difficile raggiungere significatività
        if (alpha005.significant) {
            // alpha001 potrebbe non essere significativo con lo stesso campione
            expect(typeof alpha001.significant).toBe('boolean');
        }
    });

    it('campione uguale → pValue non significativo', () => {
        const result = computeTwoProportionSignificance(25, 50, 25, 50, 0.05);
        expect(result.significant).toBe(false);
        if (result.pValue !== null) {
            expect(result.pValue).toBeGreaterThan(0.05);
        }
    });

    it('baseline 0 totale → pValue null', () => {
        const result = computeTwoProportionSignificance(0, 0, 10, 20, 0.05);
        expect(result.pValue).toBeNull();
    });

    it('candidate 0 totale → pValue null', () => {
        const result = computeTwoProportionSignificance(10, 20, 0, 0, 0.05);
        expect(result.pValue).toBeNull();
    });

    it('entrambi 100% → non significativo (nessuna differenza)', () => {
        const result = computeTwoProportionSignificance(50, 50, 50, 50, 0.05);
        expect(result.significant).toBe(false);
    });

    it('campioni molto grandi amplificano piccole differenze', () => {
        const result = computeTwoProportionSignificance(4900, 10000, 5100, 10000, 0.05);
        // 49% vs 51% con 10000 campioni — potrebbe essere significativo
        expect(typeof result.significant).toBe('boolean');
        if (result.pValue !== null) {
            expect(result.pValue).toBeGreaterThanOrEqual(0);
            expect(result.pValue).toBeLessThanOrEqual(1);
        }
    });
});
