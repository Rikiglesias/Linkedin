import { describe, test, expect } from 'vitest';
import {
    clampBackpressureLevel,
    computeBackpressureBatchSize,
    computeNextBackpressureLevel,
} from '../sync/backpressure';

describe('Backpressure', () => {
    test('clamp limiti', () => {
        expect(clampBackpressureLevel(0)).toBe(1);
        expect(clampBackpressureLevel(99)).toBe(8);
        expect(clampBackpressureLevel(4)).toBe(4);
    });

    test('batch size ridotto dal livello', () => {
        expect(computeBackpressureBatchSize(20, 1)).toBe(20);
        expect(computeBackpressureBatchSize(20, 4)).toBe(5);
    });

    test('failure aumenta il livello', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 1,
            sent: 2,
            failed: 4,
            permanentFailures: 1,
        });
        expect(next).toBeGreaterThan(1);
    });

    test('successo riduce il livello', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 4,
            sent: 5,
            failed: 0,
            permanentFailures: 0,
        });
        expect(next).toBeLessThan(4);
    });
});
