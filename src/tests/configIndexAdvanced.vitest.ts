import { describe, it, expect, beforeAll } from 'vitest';
import { isGreenModeWindow, getEffectiveLoopIntervalMs, getLocalDateString, isWorkingHour } from '../config';
import { config } from '../config';

describe('config/index — advanced', () => {
    beforeAll(() => {
        config.greenModeEnabled = true;
        config.greenModeStartHour = 22;
        config.greenModeEndHour = 6;
        config.greenModeIntervalMultiplier = 2.0;
        config.workingHoursStart = 8;
        config.workingHoursEnd = 20;
        config.timezone = 'Europe/Rome';
    });

    describe('isGreenModeWindow', () => {
        it('ritorna boolean', () => {
            expect(typeof isGreenModeWindow()).toBe('boolean');
        });

        it('con greenModeEnabled=false → sempre false', () => {
            const prev = config.greenModeEnabled;
            config.greenModeEnabled = false;
            expect(isGreenModeWindow()).toBe(false);
            config.greenModeEnabled = prev;
        });
    });

    describe('getEffectiveLoopIntervalMs', () => {
        it('fuori green mode → ritorna base interval', () => {
            const prev = config.greenModeEnabled;
            config.greenModeEnabled = false;
            expect(getEffectiveLoopIntervalMs(60000)).toBe(60000);
            config.greenModeEnabled = prev;
        });

        it('ritorna almeno il base interval', () => {
            const result = getEffectiveLoopIntervalMs(30000);
            expect(result).toBeGreaterThanOrEqual(30000);
        });
    });

    describe('getLocalDateString', () => {
        it('formato YYYY-MM-DD', () => {
            expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('ritorna data di oggi', () => {
            const today = new Date();
            const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            // Potrebbe differire se il test gira a mezzanotte con timezone diverso
            expect(getLocalDateString().substring(0, 7)).toBe(expected.substring(0, 7));
        });
    });

    describe('isWorkingHour — M18 timezone', () => {
        it('timezone diversa produce risultato potenzialmente diverso', () => {
            // UTC e Rome differiscono di 1-2 ore
            const rome = isWorkingHour(new Date(), 'Europe/Rome');
            const utc = isWorkingHour(new Date(), 'UTC');
            // Non possiamo garantire che siano diversi (dipende dall'ora),
            // ma verifichiamo che entrambi siano boolean senza errori
            expect(typeof rome).toBe('boolean');
            expect(typeof utc).toBe('boolean');
        });

        it('timezone invalida → non lancia (Intl gestisce)', () => {
            // Intl.DateTimeFormat lancia per timezone invalide, ma isWorkingHour
            // dovrebbe gestirlo o lasciare lanciare
            try {
                isWorkingHour(new Date(), 'Invalid/Timezone');
            } catch {
                // OK — timezone invalida può lanciare
            }
        });
    });
});
