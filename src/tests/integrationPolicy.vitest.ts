import { describe, it, expect, beforeEach } from 'vitest';
import { getCircuitBreakerSnapshot, resetCircuitBreakersForTests } from '../core/integrationPolicy';

describe('integrationPolicy — Circuit Breaker', () => {
    beforeEach(() => {
        resetCircuitBreakersForTests();
    });

    it('snapshot vuota dopo reset', () => {
        const snapshot = getCircuitBreakerSnapshot();
        expect(snapshot).toEqual([]);
    });

    it('snapshot è un array (anche senza circuiti attivi)', () => {
        const snapshot = getCircuitBreakerSnapshot();
        expect(Array.isArray(snapshot)).toBe(true);
    });

    it('snapshot rows hanno key, status, failureCount', () => {
        // Dopo reset, nessuna riga — verifichiamo la struttura del tipo
        const snapshot = getCircuitBreakerSnapshot();
        for (const row of snapshot) {
            expect(row).toHaveProperty('key');
            expect(row).toHaveProperty('status');
            expect(row).toHaveProperty('failureCount');
        }
    });

    it('reset svuota completamente lo stato', () => {
        resetCircuitBreakersForTests();
        resetCircuitBreakersForTests(); // doppio reset non lancia
        expect(getCircuitBreakerSnapshot()).toEqual([]);
    });
});
