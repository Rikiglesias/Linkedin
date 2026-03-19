import { describe, it, expect } from 'vitest';
import { computeTwoProportionSignificance } from '../ml/significance';
import { getAccountGrowthBudget } from '../risk/accountBehaviorModel';

describe('significance — computeTwoProportionSignificance', () => {
    it('campioni identici → non significativo', () => {
        const result = computeTwoProportionSignificance(50, 100, 50, 100, 0.05);
        expect(result.significant).toBe(false);
    });

    it('differenza enorme → significativo', () => {
        const result = computeTwoProportionSignificance(10, 100, 80, 100, 0.05);
        expect(result.significant).toBe(true);
        expect(result.pValue).toBeLessThan(0.05);
    });

    it('campioni troppo piccoli → non significativo', () => {
        const result = computeTwoProportionSignificance(1, 3, 2, 3, 0.05);
        expect(result.significant).toBe(false);
    });

    it('zero successi → non significativo', () => {
        const result = computeTwoProportionSignificance(0, 100, 0, 100, 0.05);
        expect(result.significant).toBe(false);
    });

    it('pValue è null o tra 0 e 1', () => {
        const result = computeTwoProportionSignificance(30, 100, 40, 100, 0.05);
        if (result.pValue !== null) {
            expect(result.pValue).toBeGreaterThanOrEqual(0);
            expect(result.pValue).toBeLessThanOrEqual(1);
        }
    });

    it('totale 0 → pValue null', () => {
        const result = computeTwoProportionSignificance(0, 0, 0, 0, 0.05);
        expect(result.pValue).toBeNull();
        expect(result.significant).toBe(false);
    });
});

describe('accountBehaviorModel — getAccountGrowthBudget', () => {
    it('account 0 giorni → budget minimo', () => {
        const growth = getAccountGrowthBudget(0);
        expect(growth.phase).toBeTruthy();
        expect(growth.inviteMaxPerDay).toBeGreaterThanOrEqual(0);
    });

    it('account 30 giorni → budget intermedio', () => {
        const growth = getAccountGrowthBudget(30);
        expect(growth.inviteMaxPerDay).toBeGreaterThan(0);
    });

    it('account 365 giorni → budget pieno (Infinity o alto)', () => {
        const growth = getAccountGrowthBudget(365);
        expect(growth.inviteMaxPerDay).toBeGreaterThanOrEqual(getAccountGrowthBudget(30).inviteMaxPerDay);
    });

    it('budget cresce con età', () => {
        const young = getAccountGrowthBudget(7);
        const mid = getAccountGrowthBudget(90);
        const old = getAccountGrowthBudget(365);
        expect(mid.inviteMaxPerDay).toBeGreaterThanOrEqual(young.inviteMaxPerDay);
        expect(old.inviteMaxPerDay).toBeGreaterThanOrEqual(mid.inviteMaxPerDay);
    });

    it('phase è una stringa non vuota', () => {
        for (const days of [0, 7, 30, 90, 180, 365]) {
            const growth = getAccountGrowthBudget(days);
            expect(growth.phase).toBeTruthy();
            expect(typeof growth.phase).toBe('string');
        }
    });

    it('NaN giorni → gestito senza crash', () => {
        const growth = getAccountGrowthBudget(NaN);
        expect(growth).toBeDefined();
        expect(growth.phase).toBeTruthy();
    });

    it('giorni negativi → gestito senza crash', () => {
        const growth = getAccountGrowthBudget(-10);
        expect(growth).toBeDefined();
    });
});
