import { describe, it, expect } from 'vitest';
import { resolveLeadLanguage } from '../ai/leadLanguage';

describe('resolveLeadLanguage', () => {
    it('mappa i paesi reali (location scrapata in italiano) → lingua con template', () => {
        expect(resolveLeadLanguage({ location: 'Amsterdam, Olanda Settentrionale, Paesi Bassi' })).toBe('nl');
        expect(resolveLeadLanguage({ location: 'Barcellona, Catalogna, Spagna' })).toBe('es');
        expect(resolveLeadLanguage({ location: 'Parigi, Ile-de-France, Francia' })).toBe('fr');
        expect(resolveLeadLanguage({ location: 'Milano, Lombardia, Italia' })).toBe('it');
        expect(resolveLeadLanguage({ location: 'Berlino, Germania' })).toBe('de');
    });

    it('riconosce anche i nomi-paese in inglese (account EN)', () => {
        expect(resolveLeadLanguage({ location: 'London, United Kingdom' })).toBe('en');
        expect(resolveLeadLanguage({ location: 'New York, United States' })).toBe('en');
        expect(resolveLeadLanguage({ location: 'Berlin, Germany' })).toBe('de');
    });

    it('normalizza gli accenti nel nome-paese (Perù → es)', () => {
        expect(resolveLeadLanguage({ location: 'Lima, Perù' })).toBe('es');
    });

    it('è case-insensitive e tollera spazi', () => {
        expect(resolveLeadLanguage({ location: 'barcellona,  SPAGNA ' })).toBe('es');
    });

    it('fallback CONSERVATIVO a "it" (zero regressione)', () => {
        expect(resolveLeadLanguage({ location: '' })).toBe('it');
        expect(resolveLeadLanguage({ location: null })).toBe('it');
        expect(resolveLeadLanguage({ location: undefined })).toBe('it');
        // paese non in whitelist (nessun template) → it, non una lingua inventata
        expect(resolveLeadLanguage({ location: 'Lisbona, Portogallo' })).toBe('it');
        // solo città, nessun paese → it (non si indovina)
        expect(resolveLeadLanguage({ location: 'Amsterdam' })).toBe('it');
    });
});
