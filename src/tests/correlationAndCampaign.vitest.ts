import { describe, it, expect } from 'vitest';
import { resolveCorrelationId, runWithCorrelationId, getCorrelationId } from '../telemetry/correlation';

describe('telemetry/correlation', () => {
    it('resolveCorrelationId con valore → sanitizzato', () => {
        const id = resolveCorrelationId('test-correlation-123');
        expect(id).toBe('test-correlation-123');
    });

    it('resolveCorrelationId senza valore → UUID', () => {
        const id = resolveCorrelationId(null);
        expect(id).toBeTruthy();
        expect(id.length).toBeGreaterThan(0);
    });

    it('resolveCorrelationId con caratteri speciali → sanitizzati', () => {
        const id = resolveCorrelationId('test<script>alert(1)</script>');
        expect(id).not.toContain('<');
        expect(id).not.toContain('>');
    });

    it('resolveCorrelationId max 80 caratteri', () => {
        const long = 'a'.repeat(200);
        const id = resolveCorrelationId(long);
        expect(id.length).toBeLessThanOrEqual(80);
    });

    it('runWithCorrelationId propaga il correlation ID', () => {
        const result = runWithCorrelationId('test-run-123', () => {
            return getCorrelationId();
        });
        expect(result).toBe('test-run-123');
    });

    it('getCorrelationId fuori dal contesto → null', () => {
        const id = getCorrelationId();
        expect(id).toBeNull();
    });

    it('runWithCorrelationId nested → ultimo vince', () => {
        const result = runWithCorrelationId('outer', () => {
            return runWithCorrelationId('inner', () => {
                return getCorrelationId();
            });
        });
        expect(result).toBe('inner');
    });
});
