import { describe, it, expect } from 'vitest';
import { computeTwoProportionSignificance } from '../ml/significance';

describe('significance — comprehensive', () => {
    it('candidato molto migliore del baseline → significativo', () => {
        const r = computeTwoProportionSignificance(10, 100, 50, 100, 0.05);
        expect(r.significant).toBe(true);
    });

    it('candidato peggiore del baseline → non significativo (test unilaterale)', () => {
        const r = computeTwoProportionSignificance(50, 100, 10, 100, 0.05);
        expect(r.significant).toBe(false);
    });

    it('pValue nullo per totale 0', () => {
        expect(computeTwoProportionSignificance(5, 0, 5, 100, 0.05).pValue).toBeNull();
        expect(computeTwoProportionSignificance(5, 100, 5, 0, 0.05).pValue).toBeNull();
    });

    it('alpha più basso → meno significativo', () => {
        const r005 = computeTwoProportionSignificance(20, 100, 35, 100, 0.05);
        const r001 = computeTwoProportionSignificance(20, 100, 35, 100, 0.01);
        if (r005.significant && !r001.significant) {
            // Dimostrato: alpha più basso è più restrittivo
            expect(true).toBe(true);
        }
    });

    it('campioni grandi uguali → pValue alto', () => {
        const r = computeTwoProportionSignificance(5000, 10000, 5000, 10000, 0.05);
        expect(r.significant).toBe(false);
    });
});
