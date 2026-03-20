import { describe, it, expect } from 'vitest';
import { joinSelectors, SELECTORS } from '../selectors';

describe('selectors.ts — joinSelectors', () => {
    it('connectButtonPrimary → stringa non vuota', () => {
        expect(joinSelectors('connectButtonPrimary').length).toBeGreaterThan(0);
    });

    it('esclude XPath (//) da tutti i selettori', () => {
        const keys = Object.keys(SELECTORS) as Array<keyof typeof SELECTORS>;
        for (const key of keys) {
            expect(joinSelectors(key)).not.toContain('//');
        }
    });

    it('sendWithoutNote → contiene selettore', () => {
        expect(joinSelectors('sendWithoutNote').length).toBeGreaterThan(0);
    });

    it('messageButton → contiene aria-label', () => {
        expect(joinSelectors('messageButton')).toContain('aria-label');
    });

    it('invitePendingIndicators → contiene Pending o In attesa', () => {
        const sel = joinSelectors('invitePendingIndicators');
        expect(sel.includes('Pending') || sel.includes('In attesa')).toBe(true);
    });

    it('messageSendButton → contiene send-button', () => {
        expect(joinSelectors('messageSendButton')).toContain('send-button');
    });

    it('globalNav → contiene global-nav', () => {
        expect(joinSelectors('globalNav')).toContain('global-nav');
    });

    it('SELECTORS ha almeno 10 chiavi', () => {
        expect(Object.keys(SELECTORS).length).toBeGreaterThanOrEqual(10);
    });

    it('ogni chiave SELECTORS ha almeno 1 selettore', () => {
        for (const [key, values] of Object.entries(SELECTORS)) {
            expect(values.length, `${key} ha 0 selettori`).toBeGreaterThan(0);
        }
    });

    it('sendFallback contiene Send o Invia', () => {
        const sel = joinSelectors('sendFallback');
        expect(sel.includes('Send') || sel.includes('Invia')).toBe(true);
    });
});
