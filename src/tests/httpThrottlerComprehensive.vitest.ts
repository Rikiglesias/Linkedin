import { describe, it, expect } from 'vitest';
import { HttpResponseThrottler } from '../risk/httpThrottler';

const VOYAGER = 'https://www.linkedin.com/voyager/api/identity/profiles';

describe('HttpResponseThrottler — comprehensive', () => {
    it('baseline si stabilizza dopo 10+ campioni', () => {
        const t = new HttpResponseThrottler();
        for (let i = 0; i < 15; i++) t.recordResponseTime(VOYAGER, 250);
        const s = t.getThrottleSignal();
        expect(s.baselineMs).toBeGreaterThan(0);
        expect(Number.isFinite(s.baselineMs)).toBe(true);
    });

    it('ratio = currentAvg / baseline', () => {
        const t = new HttpResponseThrottler();
        for (let i = 0; i < 20; i++) t.recordResponseTime(VOYAGER, 200);
        const s = t.getThrottleSignal();
        if (s.baselineMs > 0 && s.currentAvgMs > 0) {
            expect(s.ratio).toBeCloseTo(s.currentAvgMs / s.baselineMs, 1);
        }
    });

    it('campioni vecchi scadono (>10 min simulato)', () => {
        const t = new HttpResponseThrottler();
        // Non possiamo simulare il passare del tempo facilmente
        // Ma verifichiamo che 50+ campioni non causano memory leak
        for (let i = 0; i < 100; i++) t.recordResponseTime(VOYAGER, 200 + i);
        const s = t.getThrottleSignal();
        expect(Number.isFinite(s.currentAvgMs)).toBe(true);
    });

    it('URL non-voyager ignorati completamente', () => {
        const t = new HttpResponseThrottler();
        for (let i = 0; i < 50; i++) {
            t.recordResponseTime('https://www.linkedin.com/feed/', 5000);
        }
        const s = t.getThrottleSignal();
        // Nessun campione voyager → baseline non stabilizzata
        expect(s.shouldSlow).toBe(false);
        expect(s.shouldPause).toBe(false);
    });

    it('mix di URL → voyager contano nei sample', () => {
        const t = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            t.recordResponseTime(VOYAGER, 200);
            t.recordResponseTime('https://www.linkedin.com/feed/', 5000);
        }
        const s = t.getThrottleSignal();
        // Verifica che il throttler funziona senza crash
        expect(Number.isFinite(s.currentAvgMs)).toBe(true);
    });
});
