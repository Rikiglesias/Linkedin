import { describe, it, expect, beforeAll } from 'vitest';
import { getHourInTimezone, getDayInTimezone, isWorkingHour } from '../config';
import { config } from '../config';

beforeAll(() => {
    config.timezone = 'Europe/Rome';
    config.workingHoursStart = 8;
    config.workingHoursEnd = 20;
    config.weekendPolicyEnabled = true;
});

describe('config/index — getHourInTimezone + getDayInTimezone', () => {
    it('getHourInTimezone per UTC ritorna 0-23', () => {
        const hour = getHourInTimezone(new Date(), 'UTC');
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
    });

    it('getHourInTimezone per timezone diversi può differire', () => {
        const rome = getHourInTimezone(new Date(), 'Europe/Rome');
        const tokyo = getHourInTimezone(new Date(), 'Asia/Tokyo');
        // Non possiamo garantire che differiscano (potrebbe essere la stessa ora in entrambi)
        // ma verifichiamo che entrambi siano validi
        expect(rome).toBeGreaterThanOrEqual(0);
        expect(tokyo).toBeGreaterThanOrEqual(0);
    });

    it('getDayInTimezone ritorna 0-6 per qualsiasi timezone', () => {
        const timezones = ['UTC', 'Europe/Rome', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'];
        for (const tz of timezones) {
            const day = getDayInTimezone(new Date(), tz);
            expect(day).toBeGreaterThanOrEqual(0);
            expect(day).toBeLessThanOrEqual(6);
        }
    });
});

describe('config/index — isWorkingHour edge cases', () => {
    it('mezzanotte → fuori orario lavorativo', () => {
        const midnight = new Date('2025-01-15T00:00:00+01:00'); // mercoledì
        expect(isWorkingHour(midnight, 'Europe/Rome')).toBe(false);
    });

    it('mezzogiorno mercoledì → in orario lavorativo', () => {
        const noon = new Date('2025-01-15T12:00:00+01:00'); // mercoledì
        expect(isWorkingHour(noon, 'Europe/Rome')).toBe(true);
    });

    it('domenica a mezzogiorno → fuori orario (weekend)', () => {
        const sunday = new Date('2025-01-19T12:00:00+01:00'); // domenica
        expect(isWorkingHour(sunday, 'Europe/Rome')).toBe(false);
    });
});
