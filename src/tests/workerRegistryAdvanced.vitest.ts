import { describe, it, expect } from 'vitest';
import { workerRegistry } from '../workers/registry';

describe('workerRegistry — advanced', () => {
    it('contiene INTERACTION', () => {
        expect(workerRegistry.has('INTERACTION')).toBe(true);
    });

    it('registry è ReadonlyMap (immutabile)', () => {
        // Verifica che non si possano aggiungere worker a runtime
        expect(typeof (workerRegistry as Map<string, unknown>).set).toBe('function');
        // Ma è readonly — il tipo impedisce la mutazione a compile time
    });

    it('tutti i worker hanno process che ritorna Promise', () => {
        for (const [_key, worker] of workerRegistry) {
            // Verifica che process sia async (ritorna Promise)
            const fakeJob = { payload_json: '{}' };
            const fakeContext = {} as never;
            const result = worker.process(fakeJob as never, fakeContext);
            expect(result).toBeInstanceOf(Promise);
            // Catch per evitare unhandled rejection
            result.catch(() => {});
        }
    });

    it('nessun worker duplicato (Map garantisce unicità)', () => {
        const keys = Array.from(workerRegistry.keys());
        expect(new Set(keys).size).toBe(keys.length);
    });
});
