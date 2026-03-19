import { describe, it, expect, beforeAll } from 'vitest';
import { getTodayStrategy } from '../risk/strategyPlanner';
import { config } from '../config';

describe('risk/strategyPlanner — getTodayStrategy', () => {
    beforeAll(() => {
        config.weeklyStrategyEnabled = true;
    });

    it('ritorna un DayStrategy con inviteFactor e messageFactor', () => {
        const strategy = getTodayStrategy();
        expect(typeof strategy.inviteFactor).toBe('number');
        expect(typeof strategy.messageFactor).toBe('number');
        expect(strategy.inviteFactor).toBeGreaterThanOrEqual(0);
        expect(strategy.messageFactor).toBeGreaterThanOrEqual(0);
    });

    it('dayOfWeek è 0-6', () => {
        const strategy = getTodayStrategy();
        expect(strategy.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(strategy.dayOfWeek).toBeLessThanOrEqual(6);
    });

    it('dayName è non vuoto', () => {
        const strategy = getTodayStrategy();
        expect(strategy.dayName).toBeTruthy();
    });

    it('description è non vuoto', () => {
        const strategy = getTodayStrategy();
        expect(strategy.description).toBeTruthy();
    });

    it('weekend ha inviteFactor 0', () => {
        // Domenica (0) e Sabato (6) hanno inviteFactor 0 nel piano default
        const strategy = getTodayStrategy();
        const dow = strategy.dayOfWeek;
        if (dow === 0 || dow === 6) {
            expect(strategy.inviteFactor).toBe(0);
        }
    });
});
