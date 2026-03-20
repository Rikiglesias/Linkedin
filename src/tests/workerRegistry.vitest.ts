import { describe, it, expect } from 'vitest';
import { workerRegistry } from '../workers/registry';

describe('workers/registry — workerRegistry', () => {
    it('registra almeno 7 worker', () => {
        expect(workerRegistry.size).toBeGreaterThanOrEqual(7);
    });

    it('contiene INVITE', () => {
        expect(workerRegistry.has('INVITE')).toBe(true);
    });

    it('contiene ACCEPTANCE_CHECK', () => {
        expect(workerRegistry.has('ACCEPTANCE_CHECK')).toBe(true);
    });

    it('contiene MESSAGE', () => {
        expect(workerRegistry.has('MESSAGE')).toBe(true);
    });

    it('contiene INBOX_CHECK (C09)', () => {
        expect(workerRegistry.has('INBOX_CHECK')).toBe(true);
    });

    it('contiene HYGIENE', () => {
        expect(workerRegistry.has('HYGIENE')).toBe(true);
    });

    it('contiene ENRICHMENT', () => {
        expect(workerRegistry.has('ENRICHMENT')).toBe(true);
    });

    it('contiene POST_CREATION', () => {
        expect(workerRegistry.has('POST_CREATION')).toBe(true);
    });

    it('ogni worker ha metodo process', () => {
        for (const [_key, worker] of workerRegistry) {
            expect(typeof worker.process).toBe('function');
        }
    });

    it('NON contiene FOLLOW_UP (meta-worker, non nel registry)', () => {
        expect(workerRegistry.has('FOLLOW_UP' as never)).toBe(false);
    });

    it('NON contiene DEAD_LETTER (meta-worker)', () => {
        expect(workerRegistry.has('DEAD_LETTER' as never)).toBe(false);
    });
});
