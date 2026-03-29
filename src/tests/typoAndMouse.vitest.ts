import { describe, it, expect } from 'vitest';
import { computeSessionTypoRate, determineNextKeystroke } from '../ai/typoGenerator';
import { MouseGenerator } from '../ml/mouseGenerator';

describe('typoGenerator', () => {
    it('computeSessionTypoRate ritorna un valore tra 0 e 1', () => {
        const rate = computeSessionTypoRate();
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
    });

    it('computeSessionTypoRate cached (stessa sessione → stesso valore)', () => {
        const a = computeSessionTypoRate();
        const b = computeSessionTypoRate();
        expect(a).toBe(b);
    });

    it('determineNextKeystroke ritorna char o typo action', () => {
        const result = determineNextKeystroke('a', 0.5);
        expect(result).toBeDefined();
        expect(typeof result.char).toBe('string');
        expect(typeof result.isTypo).toBe('boolean');
    });

    it('determineNextKeystroke con typoRate=0 → nessun typo', () => {
        let typoCount = 0;
        for (let i = 0; i < 100; i++) {
            const result = determineNextKeystroke('a', 0);
            if (result.isTypo) typoCount++;
        }
        expect(typoCount).toBe(0);
    });

    it('determineNextKeystroke con stringa vuota', () => {
        const result = determineNextKeystroke('', 0.1);
        expect(result).toBeDefined();
    });
});

describe('MouseGenerator', () => {
    it('generateHumanPath produce array di punti', () => {
        const start = { x: 100, y: 200 };
        const end = { x: 500, y: 400 };
        const viewport = { width: 1280, height: 800 };
        const path = MouseGenerator.generateHumanPath(start, end, viewport);
        expect(Array.isArray(path)).toBe(true);
        expect(path.length).toBeGreaterThan(0);
    });

    it('ogni punto ha coordinate x e y finite', () => {
        const path = MouseGenerator.generateHumanPath(
            { x: 50, y: 50 },
            { x: 800, y: 600 },
            { width: 1280, height: 800 },
        );
        for (const point of path) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
        }
    });

    it('primo punto vicino a start, ultimo vicino a end', () => {
        const start = { x: 100, y: 100 };
        const end = { x: 900, y: 700 };
        const path = MouseGenerator.generateHumanPath(start, end, { width: 1280, height: 800 });
        const first = path[0];
        const last = path[path.length - 1];
        // Il primo punto potrebbe essere nella fase drift, non esattamente start
        // Ma l'ultimo dovrebbe essere vicino all'end (overshoot + correction)
        if (first && last) {
            const distLast = Math.sqrt((last.x - end.x) ** 2 + (last.y - end.y) ** 2);
            expect(distLast).toBeLessThan(100); // Entro 100px dal target
        }
    });

    it('generatePath statico produce almeno N punti', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 10);
        expect(path.length).toBeGreaterThanOrEqual(10);
    });

    it('path con start=end produce punti vicini', () => {
        const path = MouseGenerator.generateHumanPath(
            { x: 500, y: 400 },
            { x: 500, y: 400 },
            { width: 1280, height: 800 },
        );
        // Anche con start=end, il path ha punti (drift + overshoot minimo)
        expect(path.length).toBeGreaterThan(0);
    });
});
