import { describe, it, expect } from 'vitest';
import { normalizeLinkedInUrl, isSalesNavigatorUrl, isLinkedInUrl } from '../linkedinUrl';

describe('linkedinUrl — final edge cases', () => {
    it('normalizeLinkedInUrl con URL SalesNav con NAME_SEARCH suffix', () => {
        const url = normalizeLinkedInUrl('https://www.linkedin.com/sales/lead/ABC123,NAME_SEARCH');
        expect(url).toContain('/sales/lead/ABC123');
        expect(url).not.toContain('NAME_SEARCH');
    });

    it('normalizeLinkedInUrl con URL /pub/ (vecchio formato)', () => {
        const url = normalizeLinkedInUrl('https://www.linkedin.com/pub/marco-rossi/1a/2b/3c');
        expect(url).toContain('linkedin.com');
    });

    it('isLinkedInUrl con sottodominio', () => {
        expect(isLinkedInUrl('https://it.linkedin.com/in/marco')).toBe(true);
    });

    it('isLinkedInUrl con www', () => {
        expect(isLinkedInUrl('https://www.linkedin.com/in/marco')).toBe(true);
    });

    it('isSalesNavigatorUrl con /sales/lists/', () => {
        expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/lists/people/123')).toBe(true);
    });

    it('normalizeLinkedInUrl preserva /in/ slug con numeri', () => {
        const url = normalizeLinkedInUrl('https://www.linkedin.com/in/marco-rossi-123abc/');
        expect(url).toContain('/in/marco-rossi-123abc/');
    });

    it('normalizeLinkedInUrl con URL company → non canonicalizza come /in/', () => {
        const url = normalizeLinkedInUrl('https://www.linkedin.com/company/acme-corp/');
        expect(url).not.toContain('/in/');
    });
});
