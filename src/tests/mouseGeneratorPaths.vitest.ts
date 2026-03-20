import { describe, it, expect } from 'vitest';
import { MouseGenerator } from '../ml/mouseGenerator';

describe('MouseGenerator — path quality', () => {
    const vp = { width: 1280, height: 800 };

    it('path con distanza 0 → almeno qualche punto (drift)', () => {
        const path = MouseGenerator.generateHumanPath({ x: 640, y: 400 }, { x: 640, y: 400 }, vp);
        expect(path.length).toBeGreaterThan(0);
    });

    it('path non ha punti NaN', () => {
        for (let i = 0; i < 5; i++) {
            const path = MouseGenerator.generateHumanPath({ x: 100, y: 100 }, { x: 1000, y: 700 }, vp);
            for (const p of path) {
                expect(Number.isNaN(p.x)).toBe(false);
                expect(Number.isNaN(p.y)).toBe(false);
            }
        }
    });

    it('path con target fuori viewport → punti comunque generati', () => {
        const path = MouseGenerator.generateHumanPath({ x: 100, y: 100 }, { x: 2000, y: 1500 }, vp);
        expect(path.length).toBeGreaterThan(0);
    });

    it('path con start negativo → punti comunque generati', () => {
        const path = MouseGenerator.generateHumanPath({ x: -50, y: -30 }, { x: 500, y: 300 }, vp);
        expect(path.length).toBeGreaterThan(0);
    });

    it('generatePath con steps=1 → almeno 1 punto', () => {
        const path = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 1);
        expect(path.length).toBeGreaterThanOrEqual(1);
    });

    it('tutti i punti sono oggetti con x e y', () => {
        const path = MouseGenerator.generateHumanPath({ x: 50, y: 50 }, { x: 800, y: 600 }, vp);
        for (const p of path) {
            expect(p).toHaveProperty('x');
            expect(p).toHaveProperty('y');
        }
    });
});
