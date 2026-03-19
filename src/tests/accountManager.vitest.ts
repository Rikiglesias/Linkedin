import { describe, it, expect } from 'vitest';
import { getRuntimeAccountProfiles, pickAccountIdForLead, getSchedulingAccountIds } from '../accountManager';

describe('accountManager', () => {
    it('getRuntimeAccountProfiles ritorna array', () => {
        const profiles = getRuntimeAccountProfiles();
        expect(Array.isArray(profiles)).toBe(true);
    });

    it('ogni profilo ha id e sessionDir', () => {
        const profiles = getRuntimeAccountProfiles();
        for (const p of profiles) {
            expect(p.id).toBeTruthy();
            expect(typeof p.sessionDir).toBe('string');
        }
    });

    it('pickAccountIdForLead ritorna stringa non vuota', () => {
        const id = pickAccountIdForLead(123);
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('pickAccountIdForLead deterministico per stesso leadId', () => {
        const a = pickAccountIdForLead(42);
        const b = pickAccountIdForLead(42);
        expect(a).toBe(b);
    });

    it('getSchedulingAccountIds ritorna array di stringhe', () => {
        const ids = getSchedulingAccountIds();
        expect(Array.isArray(ids)).toBe(true);
        for (const id of ids) {
            expect(typeof id).toBe('string');
        }
    });
});
