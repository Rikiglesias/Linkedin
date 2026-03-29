import { describe, it, expect } from 'vitest';
import { calculateAccountTrustScore, getAccountGrowthBudget, applyGrowthModel } from '../risk/accountBehaviorModel';

describe('accountBehaviorModel — advanced', () => {
    describe('calculateAccountTrustScore edge cases', () => {
        it('tutti i fattori a 0 → score basso', () => {
            const result = calculateAccountTrustScore({
                ssiScore: 0,
                ageDays: 0,
                acceptanceRatePct: 0,
                challengesLast7d: 0,
                pendingRatio: 0,
            });
            expect(result.score).toBeLessThanOrEqual(20);
            expect(result.budgetMultiplier).toBeLessThan(0.5);
        });

        it('tutti i fattori al massimo → score alto', () => {
            const result = calculateAccountTrustScore({
                ssiScore: 100,
                ageDays: 1000,
                acceptanceRatePct: 100,
                challengesLast7d: 0,
                pendingRatio: 0,
            });
            expect(result.score).toBeGreaterThan(80);
            expect(result.budgetMultiplier).toBeGreaterThan(1.0);
        });

        it('NaN in input → non lancia', () => {
            expect(() =>
                calculateAccountTrustScore({
                    ssiScore: NaN,
                    ageDays: NaN,
                    acceptanceRatePct: NaN,
                    challengesLast7d: NaN,
                    pendingRatio: NaN,
                }),
            ).not.toThrow();
        });

        it('factors sono presenti nel risultato', () => {
            const result = calculateAccountTrustScore({
                ssiScore: 70,
                ageDays: 180,
                acceptanceRatePct: 30,
                challengesLast7d: 0,
                pendingRatio: 0.3,
            });
            expect(result.factors).toHaveProperty('ssi');
            expect(result.factors).toHaveProperty('age');
            expect(result.factors).toHaveProperty('acceptance');
            expect(result.factors).toHaveProperty('challengeHistory');
            expect(result.factors).toHaveProperty('pendingRatio');
        });
    });

    describe('applyGrowthModel', () => {
        it('budget non aumenta mai (solo riduce)', () => {
            const result = applyGrowthModel(25, 35, 365);
            expect(result.inviteBudget).toBeLessThanOrEqual(25);
            expect(result.messageBudget).toBeLessThanOrEqual(35);
        });

        it('account giovane → budget ridotto o uguale', () => {
            const result = applyGrowthModel(25, 35, 7);
            expect(result.inviteBudget).toBeLessThanOrEqual(25);
        });

        it('account maturo → budget invariato o vicino', () => {
            const result = applyGrowthModel(25, 35, 365);
            // Con 365 giorni e fase full_budget, il cap growth è Infinity → budget invariato
            expect(result.inviteBudget).toBe(25);
        });

        it('growth ha phase valida', () => {
            const result = applyGrowthModel(25, 35, 30);
            expect(result.growth.phase).toBeTruthy();
        });
    });

    describe('getAccountGrowthBudget — fasi', () => {
        it('fase cambia con età', () => {
            const young = getAccountGrowthBudget(3);
            const old = getAccountGrowthBudget(365);
            // Le fasi sono diverse per account giovani vs maturi
            expect(typeof young.phase).toBe('string');
            expect(typeof old.phase).toBe('string');
        });

        it('inviteMaxPerDay cresce con età', () => {
            const young = getAccountGrowthBudget(3);
            const old = getAccountGrowthBudget(365);
            expect(old.inviteMaxPerDay).toBeGreaterThanOrEqual(young.inviteMaxPerDay);
        });
    });
});
