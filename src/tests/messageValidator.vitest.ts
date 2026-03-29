import { describe, it, expect } from 'vitest';
import { validateMessageContent, extractUnresolvedPlaceholders, hashMessage } from '../validation/messageValidator';

describe('messageValidator', () => {
    describe('validateMessageContent', () => {
        it('messaggio valido', () => {
            const result = validateMessageContent('Ciao Marco, ho visto il tuo profilo.', {
                duplicateCountLast24h: 0,
            });
            expect(result.valid).toBe(true);
            expect(result.reasons).toHaveLength(0);
        });

        it('messaggio vuoto → invalido', () => {
            const result = validateMessageContent('', { duplicateCountLast24h: 0 });
            expect(result.valid).toBe(false);
            expect(result.reasons).toContain('Messaggio vuoto.');
        });

        it('messaggio solo spazi → invalido', () => {
            const result = validateMessageContent('   \n\t  ', { duplicateCountLast24h: 0 });
            expect(result.valid).toBe(false);
        });

        it('messaggio troppo lungo → invalido', () => {
            const long = 'a'.repeat(600);
            const result = validateMessageContent(long, { duplicateCountLast24h: 0 });
            expect(result.valid).toBe(false);
            expect(result.reasons[0]).toContain('troppo lungo');
        });

        it('maxLen custom rispettato', () => {
            const msg = 'a'.repeat(100);
            const valid = validateMessageContent(msg, { duplicateCountLast24h: 0, maxLen: 200 });
            expect(valid.valid).toBe(true);
            const invalid = validateMessageContent(msg, { duplicateCountLast24h: 0, maxLen: 50 });
            expect(invalid.valid).toBe(false);
        });

        it('placeholder non risolti → invalido', () => {
            const result = validateMessageContent('Ciao {{firstName}}, come stai?', {
                duplicateCountLast24h: 0,
            });
            expect(result.valid).toBe(false);
            expect(result.reasons[0]).toContain('Placeholder non risolti');
        });

        it('placeholder con parentesi quadre → invalido', () => {
            const result = validateMessageContent('Ciao [NOME], ti scrivo per [MOTIVO].', {
                duplicateCountLast24h: 0,
            });
            expect(result.valid).toBe(false);
        });

        it('duplicato troppo frequente → invalido', () => {
            const result = validateMessageContent('Messaggio normale.', {
                duplicateCountLast24h: 3,
            });
            expect(result.valid).toBe(false);
            expect(result.reasons[0]).toContain('ripetitivo');
        });

        it('duplicateCountLast24h = 2 → valido (sotto soglia 3)', () => {
            const result = validateMessageContent('Messaggio normale.', {
                duplicateCountLast24h: 2,
            });
            expect(result.valid).toBe(true);
        });

        it('errori multipli accumulati', () => {
            const result = validateMessageContent('', { duplicateCountLast24h: 5 });
            expect(result.valid).toBe(false);
            expect(result.reasons.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('extractUnresolvedPlaceholders', () => {
        it('nessun placeholder', () => {
            expect(extractUnresolvedPlaceholders('Ciao Marco')).toEqual([]);
        });

        it('estrae {{placeholder}}', () => {
            const result = extractUnresolvedPlaceholders('{{name}} at {{company}}');
            expect(result).toEqual(['{{name}}', '{{company}}']);
        });

        it('estrae [placeholder]', () => {
            const result = extractUnresolvedPlaceholders('[NOME] lavora a [AZIENDA]');
            expect(result).toEqual(['[NOME]', '[AZIENDA]']);
        });

        it('misto {{}} e []', () => {
            const result = extractUnresolvedPlaceholders('{{name}} è [RUOLO]');
            expect(result).toHaveLength(2);
        });

        it('stringa vuota → nessun placeholder', () => {
            expect(extractUnresolvedPlaceholders('')).toEqual([]);
        });
    });

    describe('hashMessage', () => {
        it('hash deterministico', () => {
            const h1 = hashMessage('test message');
            const h2 = hashMessage('test message');
            expect(h1).toBe(h2);
        });

        it('messaggi diversi → hash diversi', () => {
            const h1 = hashMessage('message A');
            const h2 = hashMessage('message B');
            expect(h1).not.toBe(h2);
        });

        it('hash è hex string di lunghezza 64 (SHA256)', () => {
            const h = hashMessage('any message');
            expect(h).toMatch(/^[a-f0-9]{64}$/);
        });

        it('stringa vuota → hash valido', () => {
            const h = hashMessage('');
            expect(h).toMatch(/^[a-f0-9]{64}$/);
        });
    });
});
