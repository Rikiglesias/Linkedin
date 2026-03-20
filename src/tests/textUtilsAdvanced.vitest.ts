import { describe, it, expect } from 'vitest';
import { normalizeNameForComparison, jaroWinklerSimilarity } from '../utils/text';

describe('utils/text — advanced', () => {
    describe('normalizeNameForComparison — unicode', () => {
        it('accenti francesi → normalizzati', () => {
            expect(normalizeNameForComparison('François Müller')).toBe(normalizeNameForComparison('francois muller'));
        });

        it('caratteri cinesi → gestiti senza crash', () => {
            expect(() => normalizeNameForComparison('张三')).not.toThrow();
        });

        it('spazi multipli → collassati', () => {
            const result = normalizeNameForComparison('Marco   Rossi');
            expect(result).not.toContain('  ');
        });

        it('trattini → preservati o normalizzati', () => {
            const result = normalizeNameForComparison('Jean-Pierre');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('jaroWinklerSimilarity — edge cases', () => {
        it('una stringa vuota e una no → bassa similarità', () => {
            expect(jaroWinklerSimilarity('', 'Marco')).toBeLessThan(0.5);
        });

        it('stessa stringa con case diverso → gestito', () => {
            // jaroWinklerSimilarity potrebbe essere case-sensitive
            const sim = jaroWinklerSimilarity('marco rossi', 'MARCO ROSSI');
            expect(Number.isFinite(sim)).toBe(true);
        });

        it('nomi con typo → alta similarità', () => {
            expect(jaroWinklerSimilarity('Marco', 'Marcoo')).toBeGreaterThan(0.85);
        });

        it('nomi completamente diversi → similarità < 0.6', () => {
            expect(jaroWinklerSimilarity('Alessandro', 'Beatrice')).toBeLessThan(0.6);
        });

        it('nomi molto corti (2 char) → funziona', () => {
            expect(jaroWinklerSimilarity('ab', 'ab')).toBe(1.0);
        });

        it('nomi con prefisso comune → alta similarità (Jaro-Winkler bonus)', () => {
            expect(jaroWinklerSimilarity('Marco', 'Marcel')).toBeGreaterThan(0.7);
        });

        it('ordine invertito → stessa similarità', () => {
            const ab = jaroWinklerSimilarity('Marco', 'Giovanni');
            const ba = jaroWinklerSimilarity('Giovanni', 'Marco');
            expect(Math.abs(ab - ba)).toBeLessThan(0.01);
        });

        it('singolo carattere → funziona senza crash', () => {
            expect(() => jaroWinklerSimilarity('a', 'b')).not.toThrow();
        });
    });
});
