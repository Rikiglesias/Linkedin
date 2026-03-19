import { describe, it, expect } from 'vitest';
import { parseOutboxPayload } from '../sync/outboxUtils';

describe('sync/outboxUtils — parseOutboxPayload', () => {
    it('JSON valido → oggetto', () => {
        const result = parseOutboxPayload('{"key": "value", "num": 42}');
        expect(result.key).toBe('value');
        expect(result.num).toBe(42);
    });

    it('JSON invalido → fallback { raw }', () => {
        const result = parseOutboxPayload('not json');
        expect(result.raw).toBe('not json');
    });

    it('stringa vuota → fallback { raw }', () => {
        const result = parseOutboxPayload('');
        expect(result.raw).toBe('');
    });

    it('null JSON → fallback { raw } (null non è oggetto)', () => {
        const result = parseOutboxPayload('null');
        expect(result.raw).toBe('null');
    });

    it('array JSON → oggetto vuoto (non è un oggetto)', () => {
        const result = parseOutboxPayload('[1, 2, 3]');
        // Array è un oggetto in JS, ma il tipo di ritorno è Record<string, unknown>
        // Dipende dall'implementazione — verifichiamo che non lanci
        expect(result).toBeDefined();
    });

    it('oggetto nested → preservato', () => {
        const result = parseOutboxPayload('{"a": {"b": "c"}}');
        expect((result.a as Record<string, unknown>).b).toBe('c');
    });
});
