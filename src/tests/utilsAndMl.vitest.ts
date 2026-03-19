import { describe, it, expect } from 'vitest';
import { randomInt, randomElement } from '../utils/random';
import { normalizeNameForComparison, jaroWinklerSimilarity } from '../utils/text';
import { inferLeadSegment } from '../ml/segments';
import { inferTimezoneOffset } from '../ml/locationTimezone';

describe('utils/random', () => {
    it('randomInt ritorna valore nel range', () => {
        for (let i = 0; i < 50; i++) {
            const v = randomInt(5, 10);
            expect(v).toBeGreaterThanOrEqual(5);
            expect(v).toBeLessThanOrEqual(10);
        }
    });

    it('randomInt con min=max ritorna min', () => {
        expect(randomInt(7, 7)).toBe(7);
    });

    it('randomElement ritorna un elemento dell\'array', () => {
        const arr = ['a', 'b', 'c'];
        for (let i = 0; i < 20; i++) {
            expect(arr).toContain(randomElement(arr));
        }
    });
});

describe('utils/text', () => {
    it('normalizeNameForComparison: rimuove accenti e lowercase', () => {
        expect(normalizeNameForComparison('Márió Rössi')).toBe(normalizeNameForComparison('mario rossi'));
    });

    it('normalizeNameForComparison: null → stringa vuota', () => {
        expect(normalizeNameForComparison(null as unknown as string)).toBe('');
        expect(normalizeNameForComparison('')).toBe('');
    });

    it('jaroWinklerSimilarity: nomi identici → 1.0', () => {
        expect(jaroWinklerSimilarity('marco rossi', 'marco rossi')).toBe(1.0);
    });

    it('jaroWinklerSimilarity: nomi simili → > 0.8', () => {
        expect(jaroWinklerSimilarity('marco', 'marcco')).toBeGreaterThan(0.8);
    });

    it('jaroWinklerSimilarity: nomi diversi → < 0.5', () => {
        expect(jaroWinklerSimilarity('marco', 'giovanni')).toBeLessThan(0.6);
    });

    it('jaroWinklerSimilarity: stringhe vuote → 1.0', () => {
        expect(jaroWinklerSimilarity('', '')).toBe(1.0);
    });
});

describe('ml/segments', () => {
    it('inferLeadSegment ritorna un segmento non vuoto', () => {
        const segment = inferLeadSegment('CEO');
        expect(segment).toBeTruthy();
        expect(typeof segment).toBe('string');
    });

    it('inferLeadSegment con null → segmento default', () => {
        const segment = inferLeadSegment(null);
        expect(segment).toBeTruthy();
    });

    it('inferLeadSegment deterministico', () => {
        const a = inferLeadSegment('CTO');
        const b = inferLeadSegment('CTO');
        expect(a).toBe(b);
    });
});

describe('ml/locationTimezone', () => {
    it('risolve offset da location italiana', () => {
        const offset = inferTimezoneOffset('Milan, Italy');
        expect(offset).not.toBeNull();
        if (offset !== null) expect(offset).toBeGreaterThanOrEqual(0);
    });

    it('risolve offset da location USA', () => {
        const offset = inferTimezoneOffset('New York, United States');
        expect(offset).not.toBeNull();
        if (offset !== null) expect(offset).toBeLessThan(0);
    });

    it('location vuota → null', () => {
        expect(inferTimezoneOffset('')).toBeNull();
    });

    it('location sconosciuta → null', () => {
        expect(inferTimezoneOffset('Planet Mars')).toBeNull();
    });
});
