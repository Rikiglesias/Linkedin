import { describe, it, expect } from 'vitest';
import { parseConfirmationAnswer } from '../cli/stdinHelper';

/**
 * Regressione AB (audit-bot A1): askConfirmation ritornava SEMPRE true su INVIO a vuoto,
 * ignorando il default suggerito dal prompt. I gate "[y/N]" (forza override AI, pending ratio
 * oltre soglia, cancellazione IRREVERSIBILE) venivano quindi forzati premendo solo INVIO o in
 * ambiente non-TTY. Il default ora rispetta il prompt: "[y/N]" => false.
 */
describe('parseConfirmationAnswer', () => {
    it('INVIO a vuoto rispetta il default true ([Y/n])', () => {
        expect(parseConfirmationAnswer('', true)).toBe(true);
    });

    it('INVIO a vuoto rispetta il default false ([y/N]) — gate rischioso NON si forza', () => {
        expect(parseConfirmationAnswer('', false)).toBe(false);
    });

    it('risposte affermative -> true a prescindere dal default', () => {
        for (const a of ['y', 'Y', 'yes', 's', 'Si', 'SI', 'sì']) {
            expect(parseConfirmationAnswer(a, false)).toBe(true);
        }
    });

    it('"n"/"no" e input ambiguo -> false (default true)', () => {
        for (const a of ['n', 'no', 'NO', 'x', 'boh']) {
            expect(parseConfirmationAnswer(a, true)).toBe(false);
        }
    });

    it('spazi attorno alla risposta sono ignorati', () => {
        expect(parseConfirmationAnswer('  y  ', false)).toBe(true);
        expect(parseConfirmationAnswer('   ', false)).toBe(false);
        expect(parseConfirmationAnswer('   ', true)).toBe(true);
    });
});
