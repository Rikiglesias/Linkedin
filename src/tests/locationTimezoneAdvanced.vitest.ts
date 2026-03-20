import { describe, it, expect } from 'vitest';
import { inferTimezoneOffset, computeTimezoneDelaySec } from '../ml/locationTimezone';

describe('locationTimezone — advanced', () => {
    describe('inferTimezoneOffset — country patterns', () => {
        it('Germany → +1 o +2 (CET/CEST)', () => {
            const offset = inferTimezoneOffset('Berlin, Germany');
            if (offset !== null) {
                expect(offset).toBeGreaterThanOrEqual(1);
                expect(offset).toBeLessThanOrEqual(2);
            }
        });

        it('UK → 0 o +1 (GMT/BST)', () => {
            const offset = inferTimezoneOffset('London, United Kingdom');
            if (offset !== null) {
                expect(offset).toBeGreaterThanOrEqual(0);
                expect(offset).toBeLessThanOrEqual(1);
            }
        });

        it('Japan → +9', () => {
            const offset = inferTimezoneOffset('Tokyo, Japan');
            if (offset !== null) {
                expect(offset).toBe(9);
            }
        });

        it('India → +5.5', () => {
            const offset = inferTimezoneOffset('Mumbai, India');
            if (offset !== null) {
                expect(offset).toBe(5.5);
            }
        });

        it('Australia → +8 a +11', () => {
            const offset = inferTimezoneOffset('Sydney, Australia');
            if (offset !== null) {
                expect(offset).toBeGreaterThanOrEqual(8);
                expect(offset).toBeLessThanOrEqual(11);
            }
        });

        it('Brazil → -3 a -5', () => {
            const offset = inferTimezoneOffset('São Paulo, Brazil');
            if (offset !== null) {
                expect(offset).toBeGreaterThanOrEqual(-5);
                expect(offset).toBeLessThanOrEqual(-2);
            }
        });
    });

    describe('computeTimezoneDelaySec — edge cases', () => {
        it('delay è sempre intero (secondi)', () => {
            const delay = computeTimezoneDelaySec('Milan, Italy');
            expect(delay % 1).toBe(0);
        });

        it('delay max ragionevole (< 24h)', () => {
            const delay = computeTimezoneDelaySec('Tokyo, Japan');
            expect(delay).toBeLessThan(24 * 60 * 60);
        });

        it('undefined location → 0', () => {
            expect(computeTimezoneDelaySec(undefined)).toBe(0);
        });

        it('location con solo paese', () => {
            const delay = computeTimezoneDelaySec('France');
            expect(delay).toBeGreaterThanOrEqual(0);
        });

        it('location con accenti', () => {
            const delay = computeTimezoneDelaySec('São Paulo, Brasil');
            expect(delay).toBeGreaterThanOrEqual(0);
        });
    });
});
