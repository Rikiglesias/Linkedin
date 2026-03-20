import { describe, it, expect } from 'vitest';
import { sleep, retryDelayMs } from '../utils/async';

describe('utils/async — advanced', () => {
    it('sleep 0ms → risolve immediatamente', async () => {
        const start = Date.now();
        await sleep(0);
        expect(Date.now() - start).toBeLessThan(50);
    });

    it('retryDelayMs attempt 5 con base 100 → >= 1600', () => {
        // 100 * 2^4 = 1600 (attempt 5 → exponent 4)
        expect(retryDelayMs(5, 100, 0)).toBe(1600);
    });

    it('retryDelayMs attempt 10 → cresce esponenzialmente', () => {
        const d10 = retryDelayMs(10, 100, 0);
        expect(d10).toBeGreaterThan(10000);
    });

    it('retryDelayMs con jitter grande → valore variabile', () => {
        const results = new Set<number>();
        for (let i = 0; i < 30; i++) {
            results.add(retryDelayMs(1, 1000, 2000));
        }
        expect(results.size).toBeGreaterThan(5);
    });

    it('retryDelayMs con base 0 → solo jitter', () => {
        const delay = retryDelayMs(1, 0, 100);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(100);
    });
});
