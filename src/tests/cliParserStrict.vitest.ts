import { describe, test, expect } from 'vitest';
import { parseIntStrict } from '../cli/cliParser';

// Ondata-3: parseIntStrict accettava code non numeriche ('12abc' -> 12). Ora richiede match completo.
describe('parseIntStrict (Ondata-3)', () => {
    test('interi validi → parse', () => {
        expect(parseIntStrict('12', 'limit')).toBe(12);
        expect(parseIntStrict('  7  ', 'limit')).toBe(7);
        expect(parseIntStrict('-5', 'offset')).toBe(-5);
        expect(parseIntStrict('0', 'x')).toBe(0);
    });

    test('coda non numerica → throw (prima troncava silenziosamente)', () => {
        expect(() => parseIntStrict('12abc', 'limit')).toThrow();
        expect(() => parseIntStrict('3.5', 'limit')).toThrow();
        expect(() => parseIntStrict('abc', 'limit')).toThrow();
        expect(() => parseIntStrict('', 'limit')).toThrow();
        expect(() => parseIntStrict('1e3', 'limit')).toThrow();
    });
});
