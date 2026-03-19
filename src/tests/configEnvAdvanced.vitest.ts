import { describe, it, expect, afterEach } from 'vitest';
import { parseStringEnv, parseCsvEnv, parseIntEnv } from '../config/env';

describe('config/env — advanced parsing', () => {
    const origEnv = { ...process.env };
    afterEach(() => { process.env = { ...origEnv }; });

    describe('parseStringEnv', () => {
        it('ritorna valore se definito', () => {
            process.env.TEST_STR = 'hello';
            expect(parseStringEnv('TEST_STR', 'default')).toBe('hello');
        });

        it('ritorna default se non definito', () => {
            delete process.env.TEST_STR_MISSING;
            expect(parseStringEnv('TEST_STR_MISSING', 'fallback')).toBe('fallback');
        });

        it('stringa vuota → stringa vuota (non fallback)', () => {
            process.env.TEST_STR_EMPTY = '';
            expect(parseStringEnv('TEST_STR_EMPTY', 'fallback')).toBe('');
        });

        it('trimma spazi', () => {
            process.env.TEST_STR_SPACES = '  hello  ';
            const result = parseStringEnv('TEST_STR_SPACES', '');
            expect(result).toBe('hello');
        });
    });

    describe('parseCsvEnv', () => {
        it('parsa lista CSV', () => {
            process.env.TEST_CSV = 'a,b,c';
            expect(parseCsvEnv('TEST_CSV')).toEqual(['a', 'b', 'c']);
        });

        it('non definita → array vuoto', () => {
            delete process.env.TEST_CSV_MISSING;
            expect(parseCsvEnv('TEST_CSV_MISSING')).toEqual([]);
        });

        it('stringa vuota → array vuoto', () => {
            process.env.TEST_CSV_EMPTY = '';
            expect(parseCsvEnv('TEST_CSV_EMPTY')).toEqual([]);
        });

        it('singolo valore senza virgola', () => {
            process.env.TEST_CSV_SINGLE = 'only';
            expect(parseCsvEnv('TEST_CSV_SINGLE')).toEqual(['only']);
        });

        it('trimma spazi in ogni elemento', () => {
            process.env.TEST_CSV_SPACES = ' a , b , c ';
            const result = parseCsvEnv('TEST_CSV_SPACES');
            expect(result).toEqual(['a', 'b', 'c']);
        });
    });

    describe('parseIntEnv edge cases', () => {
        it('valore float → tronca a intero', () => {
            process.env.TEST_INT_FLOAT = '3.7';
            expect(parseIntEnv('TEST_INT_FLOAT', 0)).toBe(3);
        });

        it('valore negativo', () => {
            process.env.TEST_INT_NEG = '-5';
            expect(parseIntEnv('TEST_INT_NEG', 0)).toBe(-5);
        });

        it('valore con spazi', () => {
            process.env.TEST_INT_SPACE = ' 42 ';
            expect(parseIntEnv('TEST_INT_SPACE', 0)).toBe(42);
        });
    });
});
