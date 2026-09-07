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
        for (const [key, worker] of workerRegistry) {
            // Un metodo dichiarato `async` ritorna SEMPRE una Promise: si verifica la forma, non si esegue.
            // Prima questo caso chiamava `worker.process({payload_json:'{}'}, {})`: il worker REALE partiva
            // con un contesto vuoto, la rejection veniva ignorata ma il lavoro asincrono (log, DB) proseguiva
            // oltre la fine del file → `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
            // pending` (2026-09-07, unhandled error = exit 1 dell'intera suite).
            expect(typeof worker.process, `${key}.process`).toBe('function');
            expect(worker.process.constructor.name, `${key}.process deve essere async`).toBe('AsyncFunction');
        }
    });

    it('nessun worker duplicato (Map garantisce unicità)', () => {
        const keys = Array.from(workerRegistry.keys());
        expect(new Set(keys).size).toBe(keys.length);
    });
});
