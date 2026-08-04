import { describe, it, expect } from 'vitest';
import { sleep, retryDelayMs } from '../utils/async';

describe('utils/async — advanced', () => {
    it('sleep 0ms → cede il turno al timer, non risolve fra i microtask', async () => {
        // Volutamente senza misurare il tempo trascorso: un'asserzione su Date.now()
        // qui misurerebbe quanto è congestionato l'event loop, non il comportamento di
        // sleep — ed è il motivo per cui questo test falliva a intermittenza a suite piena
        // (misurato: con il thread occupato, sleep(0) impiega oltre 120 ms).
        //
        // Il controllo è sull'ORDINE, che le specifiche garantiscono a prescindere dal
        // carico: un timer è un macrotask, quindi deve arrivare dopo una promise già
        // risolta. Un `sleep` che risolvesse subito passerebbe per primo e fallirebbe qui.
        const ordine: string[] = [];

        const conSleep = sleep(0).then(() => {
            ordine.push('sleep');
        });
        const microtask = Promise.resolve().then(() => {
            ordine.push('microtask');
        });

        await Promise.all([conSleep, microtask]);

        expect(ordine).toEqual(['microtask', 'sleep']);
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
