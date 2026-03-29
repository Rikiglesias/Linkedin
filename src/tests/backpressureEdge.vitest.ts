import { describe, it, expect } from 'vitest';
import {
    clampBackpressureLevel,
    computeBackpressureBatchSize,
    computeNextBackpressureLevel,
} from '../sync/backpressure';

describe('backpressure — edge cases finali', () => {
    it('Infinity → clamped a 1 (NaN path)', () => {
        // Infinity non è NaN ma clampBackpressureLevel usa Math.floor che preserva Infinity
        // poi Math.min(8, Infinity) = 8, Math.max(1, 8) = 8... ma il check !Number.isFinite → 1
        expect(clampBackpressureLevel(Infinity)).toBe(1);
    });

    it('-Infinity → clamped a 1', () => {
        expect(clampBackpressureLevel(-Infinity)).toBe(1);
    });

    it('computeBackpressureBatchSize con base grande e livello 1', () => {
        expect(computeBackpressureBatchSize(100, 1)).toBe(100);
    });

    it('livello max 8 con failure severe consecutivo', () => {
        let level = 1;
        for (let i = 0; i < 10; i++) {
            level = computeNextBackpressureLevel({
                currentLevel: level,
                sent: 5,
                failed: 5,
                permanentFailures: 1,
            });
        }
        expect(level).toBe(8); // cap a 8
    });
});
