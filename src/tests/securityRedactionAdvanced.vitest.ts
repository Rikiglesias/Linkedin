import { describe, it, expect } from 'vitest';
import { sanitizeForLogs } from '../security/redaction';

describe('sanitizeForLogs — advanced', () => {
    it('oggetto con secret → redacted', () => {
        const result = sanitizeForLogs({ secret: 'my-secret-123', name: 'safe' });
        expect(result.secret).not.toBe('my-secret-123');
        expect(result.name).toBe('safe');
    });

    it('oggetto con authorization → redacted', () => {
        const result = sanitizeForLogs({ authorization: 'Bearer sk-123', id: 1 });
        expect(result.authorization).not.toBe('Bearer sk-123');
    });

    it('nested object → deep sanitization', () => {
        const result = sanitizeForLogs({ level1: { password: 'deep-secret', value: 42 } });
        expect((result.level1 as Record<string, unknown>).password).not.toBe('deep-secret');
        expect((result.level1 as Record<string, unknown>).value).toBe(42);
    });

    it('boolean → invariato', () => {
        expect(sanitizeForLogs(true)).toBe(true);
        expect(sanitizeForLogs(false)).toBe(false);
    });

    it('numero → invariato', () => {
        expect(sanitizeForLogs(42)).toBe(42);
        expect(sanitizeForLogs(0)).toBe(0);
    });

    it('array di stringhe → invariato', () => {
        const result = sanitizeForLogs(['a', 'b', 'c']);
        expect(result).toEqual(['a', 'b', 'c']);
    });

    it('array con oggetti sensibili → redacted', () => {
        const result = sanitizeForLogs([{ password: 'x' }, { name: 'y' }]);
        expect(result[0].password).not.toBe('x');
        expect(result[1].name).toBe('y');
    });
});
