import { describe, it, expect } from 'vitest';
import { inferHourBucket } from '../ml/abBandit';
import { validateConfigCaps, suggestConfigProfile } from '../config/schema';

describe('abBandit — inferHourBucket boundaries', () => {
    it('ora 5 → undefined (notte)', () => expect(inferHourBucket(5)).toBeUndefined());
    it('ora 6 → morning', () => expect(inferHourBucket(6)).toBe('morning'));
    it('ora 11 → morning', () => expect(inferHourBucket(11)).toBe('morning'));
    it('ora 12 → afternoon', () => expect(inferHourBucket(12)).toBe('afternoon'));
    it('ora 17 → afternoon', () => expect(inferHourBucket(17)).toBe('afternoon'));
    it('ora 18 → evening', () => expect(inferHourBucket(18)).toBe('evening'));
    it('ora 21 → evening', () => expect(inferHourBucket(21)).toBe('evening'));
    it('ora 22 → undefined', () => expect(inferHourBucket(22)).toBeUndefined());
    it('ora 23 → undefined', () => expect(inferHourBucket(23)).toBeUndefined());
    it('ora 0 → undefined', () => expect(inferHourBucket(0)).toBeUndefined());
});

describe('configSchema — validateConfigCaps edge cases', () => {
    it('tutti i cap al minimo (1) → valido', () => {
        const result = validateConfigCaps({
            softInviteCap: 1, hardInviteCap: 1, weeklyInviteLimit: 1,
            softMsgCap: 1, hardMsgCap: 1, weeklyMessageLimit: 1,
            followUpDailyCap: 1, followUpMax: 1, profileViewDailyCap: 1,
        });
        expect(result.valid).toBe(true);
    });

    it('tutti i cap al massimo → valido', () => {
        const result = validateConfigCaps({
            softInviteCap: 50, hardInviteCap: 80, weeklyInviteLimit: 300,
            softMsgCap: 60, hardMsgCap: 100, weeklyMessageLimit: 500,
            followUpDailyCap: 30, followUpMax: 10, profileViewDailyCap: 150,
        });
        expect(result.valid).toBe(true);
    });

    it('campo mancante → errore', () => {
        const result = validateConfigCaps({ softInviteCap: 10 } as never);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

describe('suggestConfigProfile — edge cases', () => {
    it('0 giorni, 0 connessioni → conservative', () => {
        expect(suggestConfigProfile(0, 0)).toBe('conservative');
    });

    it('9999 giorni, 99999 connessioni → aggressive', () => {
        expect(suggestConfigProfile(9999, 99999)).toBe('aggressive');
    });

    it('364 giorni, 2999 connessioni → moderate (non aggressive)', () => {
        expect(suggestConfigProfile(364, 2999)).toBe('moderate');
    });
});
