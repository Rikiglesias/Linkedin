import { describe, it, expect } from 'vitest';
import { getAccountGrowthBudget } from '../risk/accountBehaviorModel';

describe('getAccountGrowthBudget — phase transitions', () => {
    it('fasi sono ordinate cronologicamente', () => {
        const phases = [0, 7, 14, 15, 30, 31, 60, 61, 90, 365].map(d => ({
            days: d,
            phase: getAccountGrowthBudget(d).phase,
            inviteMax: getAccountGrowthBudget(d).inviteMaxPerDay,
        }));

        // inviteMaxPerDay è monotonicamente crescente o uguale
        for (let i = 1; i < phases.length; i++) {
            expect(phases[i].inviteMax).toBeGreaterThanOrEqual(phases[i - 1].inviteMax);
        }
    });

    it('account 0 giorni ha inviteMaxPerDay definito', () => {
        const g = getAccountGrowthBudget(0);
        expect(g.inviteMaxPerDay).toBeGreaterThanOrEqual(0);
    });

    it('account 365+ giorni ha inviteMaxPerDay alto o Infinity', () => {
        const g = getAccountGrowthBudget(365);
        expect(g.inviteMaxPerDay).toBeGreaterThan(10);
    });

    it('messageMaxPerDay segue la stessa logica', () => {
        const young = getAccountGrowthBudget(7);
        const old = getAccountGrowthBudget(365);
        expect(old.messageMaxPerDay).toBeGreaterThanOrEqual(young.messageMaxPerDay);
    });

    it('phase è una stringa non vuota per tutti i giorni', () => {
        for (let d = 0; d <= 400; d += 50) {
            expect(getAccountGrowthBudget(d).phase).toBeTruthy();
        }
    });
});
