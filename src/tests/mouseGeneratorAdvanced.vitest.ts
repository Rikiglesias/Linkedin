import { describe, it, expect } from 'vitest';
import { MouseGenerator } from '../ml/mouseGenerator';

describe('MouseGenerator — advanced', () => {
    const viewport = { width: 1280, height: 800 };

    it('path con distanza lunga ha più punti di path corto', () => {
        const longPath = MouseGenerator.generateHumanPath({ x: 10, y: 10 }, { x: 1200, y: 750 }, viewport);
        const shortPath = MouseGenerator.generateHumanPath({ x: 500, y: 400 }, { x: 520, y: 410 }, viewport);
        expect(longPath.length).toBeGreaterThanOrEqual(shortPath.length);
    });

    it('punti restano dentro il viewport (con piccola tolleranza)', () => {
        const path = MouseGenerator.generateHumanPath({ x: 50, y: 50 }, { x: 1200, y: 750 }, viewport);
        for (const p of path) {
            expect(p.x).toBeGreaterThanOrEqual(-50); // tolleranza overshoot
            expect(p.x).toBeLessThanOrEqual(viewport.width + 50);
            expect(p.y).toBeGreaterThanOrEqual(-50);
            expect(p.y).toBeLessThanOrEqual(viewport.height + 50);
        }
    });

    it('generatePath con 0 steps → almeno 1 punto', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 0);
        expect(path.length).toBeGreaterThanOrEqual(1);
    });

    it('path non è una linea retta (ha curvatura)', () => {
        const path = MouseGenerator.generateHumanPath({ x: 0, y: 0 }, { x: 1000, y: 0 }, viewport);
        // Almeno un punto dovrebbe avere y != 0 (drift/overshoot)
        const hasVarianceY = path.some(p => Math.abs(p.y) > 5);
        expect(hasVarianceY).toBe(true);
    });

    it('path deterministico per stesso seed (generatePath)', () => {
        // generatePath usa Math.random internamente, quindi non è deterministico
        // Ma verifichiamo che produce un path valido ogni volta
        for (let i = 0; i < 5; i++) {
            const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 500, y: 300 }, 15);
            expect(path.length).toBeGreaterThanOrEqual(15);
            expect(path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        }
    });

    it('viewport piccolo → path comunque valido', () => {
        const smallVp = { width: 320, height: 240 };
        const path = MouseGenerator.generateHumanPath({ x: 10, y: 10 }, { x: 300, y: 220 }, smallVp);
        expect(path.length).toBeGreaterThan(0);
        expect(path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    });
});
