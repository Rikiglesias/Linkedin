import { describe, it, expect } from 'vitest';
import { inferHourBucket } from '../ml/abBandit';
import { computeTimezoneDelaySec } from '../ml/locationTimezone';

describe('abBandit — inferHourBucket', () => {
    it('6-11 → morning', () => {
        expect(inferHourBucket(6)).toBe('morning');
        expect(inferHourBucket(9)).toBe('morning');
        expect(inferHourBucket(11)).toBe('morning');
    });

    it('12-17 → afternoon', () => {
        expect(inferHourBucket(12)).toBe('afternoon');
        expect(inferHourBucket(15)).toBe('afternoon');
        expect(inferHourBucket(17)).toBe('afternoon');
    });

    it('18-21 → evening', () => {
        expect(inferHourBucket(18)).toBe('evening');
        expect(inferHourBucket(20)).toBe('evening');
        expect(inferHourBucket(21)).toBe('evening');
    });

    it('22-23 e 0-5 → undefined (notte)', () => {
        expect(inferHourBucket(22)).toBeUndefined();
        expect(inferHourBucket(0)).toBeUndefined();
        expect(inferHourBucket(5)).toBeUndefined();
    });

    it('undefined → undefined', () => {
        expect(inferHourBucket(undefined)).toBeUndefined();
    });

    it('NaN → undefined', () => {
        expect(inferHourBucket(NaN)).toBeUndefined();
    });
});

describe('timingModel — computeTimezoneDelaySec', () => {
    it('location null → 0', () => {
        expect(computeTimezoneDelaySec(null)).toBe(0);
    });

    it('location vuota → 0', () => {
        expect(computeTimezoneDelaySec('')).toBe(0);
    });

    it('location con timezone nota → numero finito >= 0', () => {
        const delay = computeTimezoneDelaySec('Milan, Italy');
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('location sconosciuta → 0', () => {
        const delay = computeTimezoneDelaySec('Planet Mars');
        expect(delay).toBe(0);
    });

    it('delay mai negativo', () => {
        const locations = ['New York, USA', 'London, UK', 'Tokyo, Japan', 'Sydney, Australia'];
        for (const loc of locations) {
            expect(computeTimezoneDelaySec(loc)).toBeGreaterThanOrEqual(0);
        }
    });
});
