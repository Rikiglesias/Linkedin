import { describe, it, expect } from 'vitest';
import { resolveCorrelationId, runWithCorrelationId, getCorrelationId } from '../telemetry/correlation';

describe('correlation — advanced edge cases', () => {
    it('resolveCorrelationId tronca a 80 char', () => {
        const long = 'a'.repeat(200);
        expect(resolveCorrelationId(long).length).toBeLessThanOrEqual(80);
    });

    it('resolveCorrelationId rimuove caratteri non alfanumerici', () => {
        const result = resolveCorrelationId('test<>!@#$%^&*()id');
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toContain('!');
    });

    it('resolveCorrelationId preserva trattini e punti', () => {
        expect(resolveCorrelationId('test-id.123')).toBe('test-id.123');
    });

    it('resolveCorrelationId stringa vuota → UUID', () => {
        const result = resolveCorrelationId('');
        expect(result.length).toBeGreaterThan(0);
    });

    it('runWithCorrelationId ritorna il valore del callback', () => {
        const result = runWithCorrelationId('test', () => 42);
        expect(result).toBe(42);
    });

    it('runWithCorrelationId con async callback', async () => {
        const result = await runWithCorrelationId('test', async () => {
            return 'async-result';
        });
        expect(result).toBe('async-result');
    });

    it('getCorrelationId dentro runWithCorrelationId → id corretto', () => {
        runWithCorrelationId('my-id-123', () => {
            expect(getCorrelationId()).toBe('my-id-123');
        });
    });

    it('getCorrelationId fuori contesto → null', () => {
        expect(getCorrelationId()).toBeNull();
    });
});
