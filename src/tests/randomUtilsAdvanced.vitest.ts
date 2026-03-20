import { describe, it, expect } from 'vitest';
import { randomInt, randomElement } from '../utils/random';

describe('utils/random — advanced edge cases', () => {
    it('randomInt min=0 max=0 → 0', () => {
        expect(randomInt(0, 0)).toBe(0);
    });

    it('randomInt distribuzione uniforme (approssimativa)', () => {
        const counts = new Map<number, number>();
        for (let i = 0; i < 1000; i++) {
            const v = randomInt(0, 4);
            counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        // Con 1000 campioni e 5 valori, ogni valore dovrebbe apparire almeno 100 volte
        for (let v = 0; v <= 4; v++) {
            expect(counts.get(v) ?? 0).toBeGreaterThan(50);
        }
    });

    it('randomElement con array singolo → sempre quello', () => {
        for (let i = 0; i < 10; i++) {
            expect(randomElement(['only'])).toBe('only');
        }
    });

    it('randomElement con array grande → distribuzione', () => {
        const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
        const seen = new Set<string>();
        for (let i = 0; i < 100; i++) {
            seen.add(randomElement(items));
        }
        expect(seen.size).toBeGreaterThan(5);
    });

    it('randomInt risultato è intero', () => {
        for (let i = 0; i < 50; i++) {
            const v = randomInt(1, 100);
            expect(v % 1).toBe(0);
        }
    });
});
