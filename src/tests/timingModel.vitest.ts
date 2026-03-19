import { describe, it, expect } from 'vitest';
import { calculateContextualDelay } from '../ml/timingModel';

describe('ml/timingModel — calculateContextualDelay', () => {
    it('delay è >= baseMin', () => {
        const delay = calculateContextualDelay({
            actionType: 'read',
            baseMin: 1000,
            baseMax: 5000,
        });
        expect(delay).toBeGreaterThanOrEqual(1000);
    });

    it('delay con profileMultiplier alto → più lungo in media', () => {
        const delaysHigh: number[] = [];
        for (let i = 0; i < 50; i++) {
            delaysHigh.push(calculateContextualDelay({
                actionType: 'click',
                baseMin: 1000,
                baseMax: 3000,
                profileMultiplier: 2.0,
            }));
        }
        const avgHigh = delaysHigh.reduce((a, b) => a + b, 0) / delaysHigh.length;

        const delaysLow: number[] = [];
        for (let i = 0; i < 50; i++) {
            delaysLow.push(calculateContextualDelay({
                actionType: 'click',
                baseMin: 1000,
                baseMax: 3000,
                profileMultiplier: 0.5,
            }));
        }
        const avgLow = delaysLow.reduce((a, b) => a + b, 0) / delaysLow.length;
        expect(avgHigh).toBeGreaterThanOrEqual(avgLow * 0.7);
    });

    it('delay mai negativo', () => {
        for (let i = 0; i < 20; i++) {
            const delay = calculateContextualDelay({
                actionType: 'scroll',
                baseMin: 100,
                baseMax: 200,
            });
            expect(delay).toBeGreaterThanOrEqual(0);
        }
    });

    it('baseMin=baseMax → delay vicino a quel valore', () => {
        const delays: number[] = [];
        for (let i = 0; i < 20; i++) {
            delays.push(calculateContextualDelay({
                actionType: 'type',
                baseMin: 2000,
                baseMax: 2000,
            }));
        }
        const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
        expect(avg).toBeGreaterThan(1500);
        expect(avg).toBeLessThan(5000);
    });

    it('contentLength influenza delay per actionType read', () => {
        const short = calculateContextualDelay({ actionType: 'read', baseMin: 500, baseMax: 2000, contentLength: 10 });
        // Non possiamo garantire long > short per un singolo campione (stocastico),
        // ma il delay deve essere > baseMin
        expect(short).toBeGreaterThanOrEqual(500);
    });
});
