import { describe, it, expect } from 'vitest';
import { getRuntimeAccountProfiles, pickAccountIdForLead, getSchedulingAccountIds, getAccountProfileById } from '../accountManager';

describe('accountManager — advanced', () => {
    it('pickAccountIdForLead distribuzione per leadId diversi', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(pickAccountIdForLead(i));
        }
        // Con 1-2 account, dovremmo avere 1-2 id diversi
        expect(ids.size).toBeGreaterThanOrEqual(1);
    });

    it('getAccountProfileById con id valido → profilo', () => {
        const profiles = getRuntimeAccountProfiles();
        if (profiles.length > 0) {
            const profile = getAccountProfileById(profiles[0].id);
            expect(profile.id).toBe(profiles[0].id);
        }
    });

    it('getAccountProfileById con id null → profilo default', () => {
        const profile = getAccountProfileById(null);
        expect(profile).toBeDefined();
        expect(profile.id).toBeTruthy();
    });

    it('getAccountProfileById con id inesistente → profilo default', () => {
        const profile = getAccountProfileById('nonexistent-id-12345');
        expect(profile).toBeDefined();
    });

    it('getSchedulingAccountIds corrisponde a getRuntimeAccountProfiles', () => {
        const ids = getSchedulingAccountIds();
        const profiles = getRuntimeAccountProfiles();
        expect(ids.length).toBe(profiles.length);
    });

    it('ogni profilo ha inviteWeight e messageWeight > 0', () => {
        const profiles = getRuntimeAccountProfiles();
        for (const p of profiles) {
            expect(p.inviteWeight).toBeGreaterThan(0);
            expect(p.messageWeight).toBeGreaterThan(0);
        }
    });

    it('ogni profilo ha warmupEnabled boolean', () => {
        const profiles = getRuntimeAccountProfiles();
        for (const p of profiles) {
            expect(typeof p.warmupEnabled).toBe('boolean');
        }
    });
});
