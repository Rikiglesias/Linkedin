import { describe, it, expect } from 'vitest';
import { parseOutboxPayload } from '../sync/outboxUtils';

describe('parseOutboxPayload — advanced', () => {
    it('oggetto con valori numerici', () => {
        const r = parseOutboxPayload('{"count": 42, "ratio": 0.75}');
        expect(r.count).toBe(42);
        expect(r.ratio).toBe(0.75);
    });

    it('oggetto con boolean', () => {
        const r = parseOutboxPayload('{"active": true, "deleted": false}');
        expect(r.active).toBe(true);
        expect(r.deleted).toBe(false);
    });

    it('oggetto con null values', () => {
        const r = parseOutboxPayload('{"name": null}');
        expect(r.name).toBeNull();
    });

    it('oggetto profondamente nested', () => {
        const r = parseOutboxPayload('{"a":{"b":{"c":{"d":"deep"}}}}');
        expect((((r.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>).d).toBe(
            'deep',
        );
    });

    it('stringa JSON number → fallback {raw}', () => {
        const r = parseOutboxPayload('42');
        expect(r.raw).toBe('42');
    });

    it('stringa JSON boolean → fallback {raw}', () => {
        const r = parseOutboxPayload('true');
        expect(r.raw).toBe('true');
    });

    it('stringa JSON string → fallback {raw}', () => {
        const r = parseOutboxPayload('"hello"');
        expect(r.raw).toBe('"hello"');
    });
});
