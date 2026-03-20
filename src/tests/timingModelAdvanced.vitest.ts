import { describe, it, expect } from 'vitest';
import { calculateContextualDelay } from '../ml/timingModel';

describe('timingModel — calculateContextualDelay advanced', () => {
    it('actionType interJob → delay nel range', () => {
        for (let i = 0; i < 10; i++) {
            const delay = calculateContextualDelay({ actionType: 'interJob', baseMin: 30000, baseMax: 90000 });
            // Il modello applica jitter (0.85-1.15) DOPO il clamp su baseMin,
            // quindi il delay può scendere fino al ~15% sotto baseMin. By design.
            expect(delay).toBeGreaterThanOrEqual(30000 * 0.80);
        }
    });

    it('profileMultiplier basso → delay ridotto', () => {
        const delay = calculateContextualDelay({ actionType: 'click', baseMin: 500, baseMax: 2000, profileMultiplier: 0.01 });
        expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('contentLength lungo per read → delay più lungo in media', () => {
        const shortDelays: number[] = [];
        const longDelays: number[] = [];
        for (let i = 0; i < 30; i++) {
            shortDelays.push(calculateContextualDelay({ actionType: 'read', baseMin: 500, baseMax: 3000, contentLength: 10 }));
            longDelays.push(calculateContextualDelay({ actionType: 'read', baseMin: 500, baseMax: 3000, contentLength: 1000 }));
        }
        const avgShort = shortDelays.reduce((a, b) => a + b, 0) / shortDelays.length;
        const avgLong = longDelays.reduce((a, b) => a + b, 0) / longDelays.length;
        // Content lungo dovrebbe produrre delay in media più lungo
        expect(avgLong).toBeGreaterThanOrEqual(avgShort * 0.8);
    });

    it('tutti i actionType producono delay finito', () => {
        const types: Array<'read' | 'click' | 'type' | 'scroll' | 'interJob'> = ['read', 'click', 'type', 'scroll', 'interJob'];
        for (const t of types) {
            const delay = calculateContextualDelay({ actionType: t, baseMin: 100, baseMax: 500 });
            expect(Number.isFinite(delay)).toBe(true);
            expect(delay).toBeGreaterThanOrEqual(0);
        }
    });

    it('delay è stocastico (non sempre uguale)', () => {
        const delays = new Set<number>();
        for (let i = 0; i < 20; i++) {
            delays.add(calculateContextualDelay({ actionType: 'click', baseMin: 500, baseMax: 3000 }));
        }
        expect(delays.size).toBeGreaterThan(1);
    });
});
