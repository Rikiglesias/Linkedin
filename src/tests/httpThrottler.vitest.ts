import { describe, test, expect } from 'vitest';
import { HttpResponseThrottler } from '../risk/httpThrottler';

describe('HTTP Response Throttler', () => {
    test('segnale neutro senza campioni', () => {
        const throttler = new HttpResponseThrottler();
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(false);
        expect(signal.shouldPause).toBe(false);
        expect(signal.ratio).toBe(0);
    });

    test('baseline calcolata dopo 10 campioni', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime('https://www.linkedin.com/voyager/api/test', 200);
        }
        expect(throttler.getBaseline()).not.toBeNull();
        expect(throttler.getSampleCount()).toBe(10);
    });

    test('response time normali → no throttle', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime('https://www.linkedin.com/voyager/api/test', 200);
        }
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime('https://www.linkedin.com/voyager/api/test', 220);
        }
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(false);
        expect(signal.shouldPause).toBe(false);
    });

    test('rallentamento 2x → shouldSlow', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime('url', 100);
        }
        for (let i = 0; i < 20; i++) {
            throttler.recordResponseTime('url', 250);
        }
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(true);
        expect(signal.shouldPause).toBe(false);
    });

    test('rallentamento 3.5x → shouldPause', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 10; i++) {
            throttler.recordResponseTime('url', 100);
        }
        for (let i = 0; i < 50; i++) {
            throttler.recordResponseTime('url', 400);
        }
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(true);
        expect(signal.shouldPause).toBe(true);
    });

    test('reset pulisce tutto', () => {
        const throttler = new HttpResponseThrottler();
        for (let i = 0; i < 15; i++) {
            throttler.recordResponseTime('url', 200);
        }
        throttler.reset();
        expect(throttler.getSampleCount()).toBe(0);
        expect(throttler.getBaseline()).toBeNull();
    });
});

describe('HttpResponseThrottler signal', () => {
    test('restituisce segnale dal throttler', () => {
        const throttler = new HttpResponseThrottler();
        const signal = throttler.getThrottleSignal();
        expect(signal.shouldSlow).toBe(false);
        expect(signal.shouldPause).toBe(false);
    });
});
