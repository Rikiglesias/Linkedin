import { describe, it, expect } from 'vitest';
import { sanitizeForLogs } from '../security/redaction';

describe('security/redaction — sanitizeForLogs', () => {
    it('null → null', () => {
        expect(sanitizeForLogs(null)).toBeNull();
    });

    it('undefined → undefined', () => {
        expect(sanitizeForLogs(undefined)).toBeUndefined();
    });

    it('stringa semplice → invariata', () => {
        expect(sanitizeForLogs('hello world')).toBe('hello world');
    });

    it('numero → invariato', () => {
        expect(sanitizeForLogs(42)).toBe(42);
    });

    it('oggetto con password → redacted', () => {
        const input = { user: 'admin', password: 'secret123' };
        const result = sanitizeForLogs(input);
        expect(result.user).toBe('admin');
        expect(result.password).not.toBe('secret123');
    });

    it('oggetto con apiKey → redacted', () => {
        const input = { name: 'test', apiKey: 'sk-abc123def456' };
        const result = sanitizeForLogs(input);
        expect(result.name).toBe('test');
        expect(result.apiKey).not.toBe('sk-abc123def456');
    });

    it('API key con trattino nel testo → redacted (sk-, sk-ant-, sk-proj-, legacy sk_)', () => {
        const r1 = sanitizeForLogs({ note: 'chiave sk-ant-api03-AAAABBBBCCCCDDDD1234efgh' }) as { note: string };
        expect(r1.note).not.toContain('sk-ant-api03');
        expect(r1.note).toContain('[REDACTED]');
        const r2 = sanitizeForLogs({ note: 'tok sk-proj-AAAABBBBCCCCDDDD1234efgh' }) as { note: string };
        expect(r2.note).toContain('[REDACTED]');
        const r3 = sanitizeForLogs({ note: 'legacy sk_live_AAAABBBBCCCCDDDD1234' }) as { note: string };
        expect(r3.note).toContain('[REDACTED]');
    });

    it('oggetto con token → redacted', () => {
        const input = { id: 1, token: 'eyJhbGciOiJIUzI1NiJ9.test' };
        const result = sanitizeForLogs(input);
        expect(result.token).not.toBe('eyJhbGciOiJIUzI1NiJ9.test');
    });

    it('array → ogni elemento sanitizzato', () => {
        const input = [{ password: 'secret' }, { name: 'safe' }];
        const result = sanitizeForLogs(input);
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].password).not.toBe('secret');
        expect(result[1].name).toBe('safe');
    });

    it('profondità limitata → non stack overflow', () => {
        const deep: Record<string, unknown> = { a: { b: { c: { d: { e: 'deep' } } } } };
        expect(() => sanitizeForLogs(deep)).not.toThrow();
    });
});
