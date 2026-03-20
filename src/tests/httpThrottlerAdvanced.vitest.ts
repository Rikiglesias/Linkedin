import { describe, it, expect } from 'vitest';
import { HttpResponseThrottler } from '../risk/httpThrottler';

const VOYAGER_URL = 'https://www.linkedin.com/voyager/api/identity/profiles';

describe('HttpResponseThrottler — advanced', () => {
    it('nuovo throttler → signal neutro', () => {
        const throttler = new HttpResponseThrottler();
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(false);
        expect(signal.shouldPause).toBe(false);
        expect(signal.ratio).toBeGreaterThanOrEqual(0);
    });

    it('dopo response veloci → non slow', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime(VOYAGER_URL, 200);
        }
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(false);
        expect(signal.shouldPause).toBe(false);
    });

    it('dopo response molto lenti → ratio alto', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 20; i++) {
            throttler.recordResponseTime(VOYAGER_URL, 200);
        }
        for (let i = 0; i < 30; i++) {
            throttler.recordResponseTime(VOYAGER_URL, 2000);
        }
        const signal = throttler.getThrottleSignal();
        expect(signal.ratio).toBeGreaterThan(1);
    });

    it('currentAvgMs è numero finito', () => {
        const throttler = new HttpResponseThrottler();
        throttler.recordResponseTime(VOYAGER_URL, 300);
        const signal = throttler.getThrottleSignal();
        expect(Number.isFinite(signal.currentAvgMs)).toBe(true);
    });

    it('baselineMs è numero finito dopo abbastanza campioni', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 15; i++) {
            throttler.recordResponseTime(VOYAGER_URL, 250);
        }
        const signal = throttler.getThrottleSignal();
        expect(Number.isFinite(signal.baselineMs)).toBe(true);
    });

    it('response 0ms → ignorato (no crash)', () => {
        const throttler = new HttpResponseThrottler();
        expect(() => throttler.recordResponseTime(VOYAGER_URL, 0)).not.toThrow();
    });

    it('URL non-voyager → ignorato', () => {
        const throttler = new HttpResponseThrottler();
        throttler.recordResponseTime('https://www.linkedin.com/feed/', 5000);
        const signal = throttler.getThrottleSignal();
        // Nessun sample registrato → signal neutro
        expect(signal.shouldSlow).toBe(false);
    });
});
