import { describe, it, expect } from 'vitest';
import { sleep, retryDelayMs } from '../utils/async';

describe('utils/async', () => {
    it('sleep risolve dopo il delay', async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(40); // tolleranza timer
    });

    it('retryDelayMs cresce esponenzialmente', () => {
        const d1 = retryDelayMs(1, 1000, 0);
        const d2 = retryDelayMs(2, 1000, 0);
        const d3 = retryDelayMs(3, 1000, 0);
        expect(d1).toBe(1000);
        expect(d2).toBe(2000);
        expect(d3).toBe(4000);
    });

    it('retryDelayMs con jitter > base', () => {
        const delays = new Set<number>();
        for (let i = 0; i < 20; i++) {
            delays.add(retryDelayMs(1, 1000, 500));
        }
        // Con jitter, dovremmo avere almeno 2 valori diversi su 20 tentativi
        expect(delays.size).toBeGreaterThan(1);
    });

    it('retryDelayMs attempt 0 → base delay', () => {
        expect(retryDelayMs(0, 1000, 0)).toBe(1000);
    });

    it('retryDelayMs con jitter=0 → deterministico', () => {
        const a = retryDelayMs(2, 500, 0);
        const b = retryDelayMs(2, 500, 0);
        expect(a).toBe(b);
    });
});
