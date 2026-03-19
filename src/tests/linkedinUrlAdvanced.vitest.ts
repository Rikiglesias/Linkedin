import { describe, it, expect } from 'vitest';
import { normalizeLinkedInUrl, isSalesNavigatorUrl, isLinkedInUrl } from '../linkedinUrl';

describe('linkedinUrl — advanced', () => {
    describe('normalizeLinkedInUrl — SalesNav URLs', () => {
        it('canonicalizza /sales/lead/ URL', () => {
            const url = normalizeLinkedInUrl('https://www.linkedin.com/sales/lead/ABC123,NAME_SEARCH?foo=bar');
            expect(url).toContain('/sales/lead/ABC123');
            expect(url).not.toContain('NAME_SEARCH');
            expect(url).not.toContain('foo=bar');
        });

        it('canonicalizza /sales/people/ URL', () => {
            const url = normalizeLinkedInUrl('https://www.linkedin.com/sales/people/XYZ789,NAME_SEARCH');
            expect(url).toContain('/sales/people/XYZ789');
            expect(url).not.toContain('NAME_SEARCH');
        });

        it('URL non LinkedIn → ritorna trimmed', () => {
            expect(normalizeLinkedInUrl('https://google.com/search?q=test')).toBe('https://google.com/search?q=test');
        });

        it('URL con hash → hash rimosso', () => {
            const url = normalizeLinkedInUrl('https://www.linkedin.com/in/marco-rossi#section');
            expect(url).not.toContain('#');
        });

        it('protocollo http → normalizzato a https', () => {
            const url = normalizeLinkedInUrl('http://www.linkedin.com/in/marco-rossi');
            expect(url.startsWith('https://')).toBe(true);
        });

        it('hostname linkedin.com senza www → normalizzato', () => {
            const url = normalizeLinkedInUrl('https://linkedin.com/in/marco-rossi');
            expect(url).toContain('www.linkedin.com');
        });
    });

    describe('isLinkedInUrl', () => {
        it('URL LinkedIn valido → true', () => {
            expect(isLinkedInUrl('https://www.linkedin.com/in/marco-rossi')).toBe(true);
        });

        it('URL non LinkedIn → false', () => {
            expect(isLinkedInUrl('https://google.com')).toBe(false);
        });

        it('stringa vuota → false', () => {
            expect(isLinkedInUrl('')).toBe(false);
        });

        it('URL malformato → false', () => {
            expect(isLinkedInUrl('not-a-url')).toBe(false);
        });
    });

    describe('isSalesNavigatorUrl — edge cases', () => {
        it('/sales/ generico → true', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/home')).toBe(true);
        });

        it('/sales/search → true', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/search/people')).toBe(true);
        });

        it('/in/ con sales nel slug → false', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/in/sales-manager-john')).toBe(false);
        });
    });
});
