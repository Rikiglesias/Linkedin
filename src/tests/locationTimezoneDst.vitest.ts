import { describe, it, expect } from 'vitest';
import { inferTimeZone, inferTimezoneOffset, computeTimezoneDelaySec } from '../ml/locationTimezone';

/**
 * Copre l'ora legale, che la tabella di offset fissi precedente non poteva rappresentare.
 *
 * Perché i test già presenti non bastavano: `locationTimezoneAdvanced` asserisce range
 * (`Germany → +1 o +2`), quindi resta verde sia col DST sia senza — passava anche quando il valore
 * era costante tutto l'anno. Qui le date sono FISSE e passate come parametro, così l'asserzione è
 * deterministica e non dipende da quando gira la suite (niente wall-clock, cfr. il flaky già
 * corretto in `asyncUtilsAdvanced`).
 */

const INVERNO = new Date('2026-01-15T12:00:00Z');
const ESTATE = new Date('2026-08-04T12:00:00Z');

describe('locationTimezone — ora legale', () => {
    describe('zone CON ora legale: l offset cambia con la stagione', () => {
        const casi: ReadonlyArray<{ location: string; inverno: number; estate: number }> = [
            { location: 'Milan, Italy', inverno: 1, estate: 2 },
            { location: 'Berlin, Germany', inverno: 1, estate: 2 },
            { location: 'London, United Kingdom', inverno: 0, estate: 1 },
            { location: 'New York, United States', inverno: -5, estate: -4 },
            { location: 'San Francisco, CA', inverno: -8, estate: -7 },
        ];

        for (const caso of casi) {
            it(`${caso.location}: ${caso.inverno} in inverno, ${caso.estate} in ora legale`, () => {
                expect(inferTimezoneOffset(caso.location, INVERNO)).toBe(caso.inverno);
                expect(inferTimezoneOffset(caso.location, ESTATE)).toBe(caso.estate);
            });
        }
    });

    describe('zone SENZA ora legale: l offset non deve muoversi', () => {
        const casi: ReadonlyArray<{ location: string; offset: number }> = [
            { location: 'Tokyo, Japan', offset: 9 },
            { location: 'Mumbai, India', offset: 5.5 },
            { location: 'Dubai, UAE', offset: 4 },
            { location: 'São Paulo, Brazil', offset: -3 },
            { location: 'Phoenix, Arizona', offset: -7 },
        ];

        for (const caso of casi) {
            it(`${caso.location}: sempre ${caso.offset}`, () => {
                expect(inferTimezoneOffset(caso.location, INVERNO)).toBe(caso.offset);
                expect(inferTimezoneOffset(caso.location, ESTATE)).toBe(caso.offset);
            });
        }
    });

    describe('zone che la tabella precedente accorpava sotto un unico offset', () => {
        it('Phoenix non segue Denver in ora legale (stessa riga prima, -7 entrambe)', () => {
            expect(inferTimezoneOffset('Phoenix, Arizona', ESTATE)).toBe(-7);
            expect(inferTimezoneOffset('Denver, Colorado', ESTATE)).toBe(-6);
        });

        it('Vancouver e Edmonton distano un ora (entrambe -7 prima)', () => {
            expect(inferTimezoneOffset('Vancouver, Canada', INVERNO)).toBe(-8);
            expect(inferTimezoneOffset('Edmonton, Canada', INVERNO)).toBe(-7);
        });

        it('Perth, Brisbane, Adelaide e Sydney sono quattro zone diverse (tutte +10 prima)', () => {
            expect(inferTimezoneOffset('Perth, Australia', ESTATE)).toBe(8);
            expect(inferTimezoneOffset('Brisbane, Australia', ESTATE)).toBe(10);
            expect(inferTimezoneOffset('Adelaide, Australia', ESTATE)).toBe(9.5);
            expect(inferTimezoneOffset('Sydney, Australia', ESTATE)).toBe(10);
        });
    });

    describe('emisfero sud: la stagione e invertita', () => {
        it('Sydney ha ora legale a gennaio, non ad agosto', () => {
            expect(inferTimezoneOffset('Sydney, Australia', INVERNO)).toBe(11);
            expect(inferTimezoneOffset('Sydney, Australia', ESTATE)).toBe(10);
        });

        it('Auckland idem', () => {
            expect(inferTimezoneOffset('Auckland, New Zealand', INVERNO)).toBe(13);
            expect(inferTimezoneOffset('Auckland, New Zealand', ESTATE)).toBe(12);
        });
    });

    describe('risoluzione della zona e casi degeneri', () => {
        it('restituisce identificatori IANA, non offset', () => {
            expect(inferTimeZone('Milan, Italy')).toBe('Europe/Rome');
            expect(inferTimeZone('New York, United States')).toBe('America/New_York');
        });

        it('location sconosciuta o vuota → null, in entrambe le funzioni', () => {
            expect(inferTimeZone('Planet Mars')).toBeNull();
            expect(inferTimezoneOffset('Planet Mars', ESTATE)).toBeNull();
            expect(inferTimeZone('')).toBeNull();
            expect(inferTimezoneOffset(undefined, ESTATE)).toBeNull();
        });

        it('senza data esplicita usa adesso e resta nel range della zona', () => {
            const romaOra = inferTimezoneOffset('Milan, Italy');
            expect(romaOra === 1 || romaOra === 2).toBe(true);
        });
    });

    describe('contratto del delay verso lo scheduler (invariato)', () => {
        it('location sconosciuta → nessun rinvio', () => {
            expect(computeTimezoneDelaySec('Planet Mars')).toBe(0);
            expect(computeTimezoneDelaySec(undefined)).toBe(0);
        });

        it('delay intero, non negativo e sotto le 24h', () => {
            for (const loc of ['Milan, Italy', 'Tokyo, Japan', 'New York, United States', 'Perth, Australia']) {
                const delay = computeTimezoneDelaySec(loc);
                expect(Number.isInteger(delay)).toBe(true);
                expect(delay).toBeGreaterThanOrEqual(0);
                expect(delay).toBeLessThan(24 * 60 * 60);
            }
        });
    });
});
