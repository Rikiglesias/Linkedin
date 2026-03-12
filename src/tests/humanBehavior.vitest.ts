import { describe, test, expect, beforeEach } from 'vitest';
import { MouseGenerator, type Point } from '../ml/mouseGenerator';
import { calculateContextualDelay, type TimingContext } from '../ml/timingModel';
import { computeSessionTypoRate, determineNextKeystroke, resetSessionTypoRate } from '../ai/typoGenerator';

// ─── MouseGenerator — Path generation ────────────────────────────────────────

describe('MouseGenerator — Path Generation', () => {
    test('genera il numero corretto di punti (+1 per start)', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 }, 20);
        expect(path).toHaveLength(21); // steps + 1 (incluso start)
    });

    test('inizia vicino al punto di partenza', () => {
        const start: Point = { x: 100, y: 200 };
        const target: Point = { x: 800, y: 600 };
        const path = MouseGenerator.generatePath(start, target, 30);
        const first = path[0] ?? { x: 0, y: 0 };
        // Il primo punto dovrebbe essere vicino allo start (entro noise range)
        expect(Math.abs(first.x - start.x)).toBeLessThan(50);
        expect(Math.abs(first.y - start.y)).toBeLessThan(50);
    });

    test('finisce vicino al target', () => {
        const start: Point = { x: 0, y: 0 };
        const target: Point = { x: 500, y: 300 };
        const path = MouseGenerator.generatePath(start, target, 30);
        const last = path[path.length - 1] ?? { x: 0, y: 0 };
        // L'ultimo punto dovrebbe essere vicino al target (entro tremor/noise)
        expect(Math.abs(last.x - target.x)).toBeLessThan(15);
        expect(Math.abs(last.y - target.y)).toBeLessThan(15);
    });

    test('non produce punti NaN o Infinity', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 1000, y: 800 }, 50);
        for (const point of path) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
        }
    });

    test('produce punti diversi (non una linea retta perfetta)', () => {
        const start: Point = { x: 0, y: 0 };
        const target: Point = { x: 500, y: 500 };
        const path = MouseGenerator.generatePath(start, target, 30);

        // Verifica che non tutti i punti siano sulla diagonale perfetta
        const midIdx = Math.floor(path.length / 2);
        const mid = path[midIdx] ?? { x: 0, y: 0 };
        const perfectMidX = start.x + (target.x - start.x) * (midIdx / (path.length - 1));
        const perfectMidY = start.y + (target.y - start.y) * (midIdx / (path.length - 1));

        // Almeno uno dei due assi deve deviare dalla linea retta
        const deviationX = Math.abs(mid.x - perfectMidX);
        const deviationY = Math.abs(mid.y - perfectMidY);
        expect(deviationX + deviationY).toBeGreaterThan(1);
    });

    test('gestisce start === target senza errori', () => {
        const path = MouseGenerator.generatePath({ x: 300, y: 300 }, { x: 300, y: 300 }, 10);
        expect(path.length).toBeGreaterThan(0);
        for (const point of path) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
        }
    });

    test('gestisce steps=1 senza errori', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 1);
        expect(path.length).toBeGreaterThanOrEqual(2); // start + end
    });

    test('due path consecutivi sono diversi (randomizzazione)', () => {
        const start: Point = { x: 0, y: 0 };
        const target: Point = { x: 500, y: 500 };
        const path1 = MouseGenerator.generatePath(start, target, 20);
        const path2 = MouseGenerator.generatePath(start, target, 20);

        // Almeno un punto intermedio deve differire tra le due generazioni
        let hasDifference = false;
        for (let i = 1; i < Math.min(path1.length, path2.length) - 1; i++) {
            if ((path1[i]?.x ?? 0) !== (path2[i]?.x ?? 0) || (path1[i]?.y ?? 0) !== (path2[i]?.y ?? 0)) {
                hasDifference = true;
                break;
            }
        }
        expect(hasDifference).toBe(true);
    });
});

// ─── TimingModel — Contextual Delay ──────────────────────────────────────────

describe('TimingModel — calculateContextualDelay', () => {
    test('delay sempre nel range ragionevole', () => {
        for (let i = 0; i < 100; i++) {
            const ctx: TimingContext = { actionType: 'read', baseMin: 1000, baseMax: 3000 };
            const delay = calculateContextualDelay(ctx);
            // Con fatigue e jitter, il range è circa baseMin * 0.85 ... baseMax * 1.35 * 1.15
            expect(delay).toBeGreaterThan(0);
            expect(delay).toBeLessThan(15000);
        }
    });

    test('delay mai negativo', () => {
        for (let i = 0; i < 50; i++) {
            const ctx: TimingContext = { actionType: 'click', baseMin: 50, baseMax: 100 };
            const delay = calculateContextualDelay(ctx);
            expect(delay).toBeGreaterThan(0);
        }
    });

    test('delay tipo read con contenuto lungo > delay base medio', () => {
        const delays: number[] = [];
        for (let i = 0; i < 100; i++) {
            delays.push(calculateContextualDelay({
                actionType: 'read',
                baseMin: 1000,
                baseMax: 3000,
                contentLength: 5000, // 5x la base di 1000
            }));
        }
        const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
        // Con contentMultiplier = 5000/1000 = 2.5 (capped), dovrebbe essere significativamente sopra il minimo
        expect(avgDelay).toBeGreaterThan(1500);
    });

    test('delay interJob nel range configurato', () => {
        for (let i = 0; i < 50; i++) {
            const ctx: TimingContext = { actionType: 'interJob', baseMin: 5000, baseMax: 10000 };
            const delay = calculateContextualDelay(ctx);
            expect(delay).toBeGreaterThan(0);
            expect(delay).toBeLessThan(30000);
        }
    });

    test('varianza: non produce sempre lo stesso valore', () => {
        const ctx: TimingContext = { actionType: 'read', baseMin: 1000, baseMax: 3000 };
        const values = new Set<number>();
        for (let i = 0; i < 20; i++) {
            values.add(calculateContextualDelay(ctx));
        }
        expect(values.size).toBeGreaterThan(5);
    });
});

// ─── TypoGenerator — Session Typo Rate ───────────────────────────────────────

describe('TypoGenerator — computeSessionTypoRate', () => {
    beforeEach(() => {
        resetSessionTypoRate();
    });

    test('typo rate nel range 0.015–0.07', () => {
        const rate = computeSessionTypoRate();
        expect(rate).toBeGreaterThanOrEqual(0.015);
        expect(rate).toBeLessThanOrEqual(0.07);
    });

    test('typo rate è cached (stessa sessione = stesso valore)', () => {
        const rate1 = computeSessionTypoRate();
        const rate2 = computeSessionTypoRate();
        expect(rate1).toBe(rate2);
    });

    test('reset funziona', () => {
        const rateBefore = computeSessionTypoRate();
        expect(rateBefore).toBeGreaterThanOrEqual(0.015);
        resetSessionTypoRate();
        // Dopo reset, il rate potrebbe essere diverso (dipende dal momento)
        // ma deve comunque essere nel range valido
        const rateAfter = computeSessionTypoRate();
        expect(rateAfter).toBeGreaterThanOrEqual(0.015);
        expect(rateAfter).toBeLessThanOrEqual(0.07);
    });
});

// ─── TypoGenerator — determineNextKeystroke ──────────────────────────────────

describe('TypoGenerator — determineNextKeystroke', () => {
    test('con probability 0 non genera mai typo', () => {
        for (let i = 0; i < 100; i++) {
            const result = determineNextKeystroke('a', 0);
            expect(result.isTypo).toBe(false);
            expect(result.char).toBe('a');
        }
    });

    test('con probability 1 genera typo nella maggior parte dei casi', () => {
        let typoCount = 0;
        for (let i = 0; i < 200; i++) {
            const result = determineNextKeystroke('a', 1);
            if (result.isTypo) typoCount++;
        }
        // ~85% typo (transposition fa fall-through se non c'è contesto di char successivo)
        expect(typoCount / 200).toBeGreaterThan(0.70);
    });

    test('typo adjacent per "a" genera tasti vicini QWERTY', () => {
        const validNeighbors = new Set(['q', 'w', 's', 'z', 'x', 'à', 'a', 'aa', '']);
        let foundAdjacent = false;
        for (let i = 0; i < 200; i++) {
            const result = determineNextKeystroke('a', 1);
            if (result.isTypo && result.char.length === 1 && result.char !== 'a') {
                expect(validNeighbors.has(result.char)).toBe(true);
                foundAdjacent = true;
            }
        }
        expect(foundAdjacent).toBe(true);
    });

    test('typo double raddoppia il carattere', () => {
        let foundDouble = false;
        for (let i = 0; i < 300; i++) {
            const result = determineNextKeystroke('n', 1);
            if (result.isTypo && result.char === 'nn') {
                foundDouble = true;
                break;
            }
        }
        expect(foundDouble).toBe(true);
    });

    test('typo missing produce stringa vuota', () => {
        let foundMissing = false;
        for (let i = 0; i < 300; i++) {
            const result = determineNextKeystroke('e', 1);
            if (result.isTypo && result.char === '') {
                foundMissing = true;
                break;
            }
        }
        expect(foundMissing).toBe(true);
    });

    test('preserva case per lettere maiuscole', () => {
        let foundUpperTypo = false;
        for (let i = 0; i < 200; i++) {
            const result = determineNextKeystroke('A', 1);
            if (result.isTypo && result.char.length === 1 && result.char !== 'A' && result.char !== '') {
                // Se è un adjacent typo, deve essere uppercase
                expect(result.char).toBe(result.char.toUpperCase());
                foundUpperTypo = true;
                break;
            }
        }
        expect(foundUpperTypo).toBe(true);
    });

    test('caratteri speciali passano senza typo (no neighbors)', () => {
        for (let i = 0; i < 50; i++) {
            const result = determineNextKeystroke('@', 0.5);
            // '@' non ha neighbors QWERTY → se typo, solo double/missing
            if (result.isTypo) {
                expect(result.char === '@@' || result.char === '').toBe(true);
            }
        }
    });

    test('distribuzione typo con rate realistico (3%)', () => {
        let typoCount = 0;
        const trials = 10000;
        for (let i = 0; i < trials; i++) {
            const result = determineNextKeystroke('e', 0.03);
            if (result.isTypo) typoCount++;
        }
        const rate = typoCount / trials;
        // 3% ± 1% con 10000 trial è statisticamente ragionevole
        expect(rate).toBeGreaterThan(0.01);
        expect(rate).toBeLessThan(0.06);
    });
});
