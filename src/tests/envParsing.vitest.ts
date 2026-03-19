import { describe, it, expect, afterEach } from 'vitest';
import { parseIntEnv, parseFloatEnv, parseBoolEnv, isAiRequestConfigured } from '../config/env';

describe('config/env — parsing functions', () => {
    const origEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...origEnv };
    });

    describe('parseIntEnv', () => {
        it('ritorna fallback se variabile non definita', () => {
            delete process.env.TEST_INT_VAR;
            expect(parseIntEnv('TEST_INT_VAR', 42)).toBe(42);
        });

        it('parsa valore intero valido', () => {
            process.env.TEST_INT_VAR = '100';
            expect(parseIntEnv('TEST_INT_VAR', 0)).toBe(100);
        });

        it('ritorna fallback per valore non numerico', () => {
            process.env.TEST_INT_VAR = 'abc';
            expect(parseIntEnv('TEST_INT_VAR', 42)).toBe(42);
        });

        it('ritorna fallback per stringa vuota', () => {
            process.env.TEST_INT_VAR = '';
            expect(parseIntEnv('TEST_INT_VAR', 42)).toBe(42);
        });
    });

    describe('parseFloatEnv', () => {
        it('parsa float valido', () => {
            process.env.TEST_FLOAT = '3.14';
            expect(parseFloatEnv('TEST_FLOAT', 0)).toBeCloseTo(3.14);
        });

        it('ritorna fallback per NaN', () => {
            process.env.TEST_FLOAT = 'not-a-number';
            expect(parseFloatEnv('TEST_FLOAT', 1.5)).toBe(1.5);
        });
    });

    describe('parseBoolEnv', () => {
        it('true → true', () => {
            process.env.TEST_BOOL = 'true';
            expect(parseBoolEnv('TEST_BOOL', false)).toBe(true);
        });

        it('1 → true', () => {
            process.env.TEST_BOOL = '1';
            expect(parseBoolEnv('TEST_BOOL', false)).toBe(true);
        });

        it('false → false', () => {
            process.env.TEST_BOOL = 'false';
            expect(parseBoolEnv('TEST_BOOL', true)).toBe(false);
        });

        it('non definita → default', () => {
            delete process.env.TEST_BOOL;
            expect(parseBoolEnv('TEST_BOOL', true)).toBe(true);
        });

        it('stringa vuota → default', () => {
            process.env.TEST_BOOL = '';
            expect(parseBoolEnv('TEST_BOOL', true)).toBe(true);
        });
    });

    describe('isAiRequestConfigured', () => {
        it('local endpoint → true anche senza API key', () => {
            expect(isAiRequestConfigured('http://localhost:11434', '')).toBe(true);
        });

        it('remote endpoint con API key → true', () => {
            expect(isAiRequestConfigured('https://api.openai.com', 'sk-test123')).toBe(true);
        });

        it('remote endpoint senza API key → false', () => {
            expect(isAiRequestConfigured('https://api.openai.com', '')).toBe(false);
        });
    });
});
