import { describe, it, expect } from 'vitest';
import { validateConfigCaps, configCapSchema } from '../config/schema';

describe('validateConfigCaps — advanced', () => {
    it('hardInviteCap = 0 → errore (min 1)', () => {
        const result = validateConfigCaps({
            softInviteCap: 0,
            hardInviteCap: 0,
            weeklyInviteLimit: 1,
            softMsgCap: 1,
            hardMsgCap: 1,
            weeklyMessageLimit: 1,
            followUpDailyCap: 1,
            followUpMax: 1,
            profileViewDailyCap: 1,
        });
        expect(result.valid).toBe(false);
    });

    it('weeklyInviteLimit = 301 → errore (max 300)', () => {
        const result = validateConfigCaps({
            softInviteCap: 10,
            hardInviteCap: 25,
            weeklyInviteLimit: 301,
            softMsgCap: 10,
            hardMsgCap: 25,
            weeklyMessageLimit: 100,
            followUpDailyCap: 5,
            followUpMax: 3,
            profileViewDailyCap: 50,
        });
        expect(result.valid).toBe(false);
    });

    it('hardMsgCap = 101 → errore (max 100)', () => {
        const result = validateConfigCaps({
            softInviteCap: 10,
            hardInviteCap: 25,
            weeklyInviteLimit: 100,
            softMsgCap: 10,
            hardMsgCap: 101,
            weeklyMessageLimit: 100,
            followUpDailyCap: 5,
            followUpMax: 3,
            profileViewDailyCap: 50,
        });
        expect(result.valid).toBe(false);
    });

    it('followUpMax = 11 → errore (max 10)', () => {
        const result = validateConfigCaps({
            softInviteCap: 10,
            hardInviteCap: 25,
            weeklyInviteLimit: 100,
            softMsgCap: 10,
            hardMsgCap: 25,
            weeklyMessageLimit: 100,
            followUpDailyCap: 5,
            followUpMax: 11,
            profileViewDailyCap: 50,
        });
        expect(result.valid).toBe(false);
    });

    it('profileViewDailyCap = 151 → errore (max 150)', () => {
        const result = validateConfigCaps({
            softInviteCap: 10,
            hardInviteCap: 25,
            weeklyInviteLimit: 100,
            softMsgCap: 10,
            hardMsgCap: 25,
            weeklyMessageLimit: 100,
            followUpDailyCap: 5,
            followUpMax: 3,
            profileViewDailyCap: 151,
        });
        expect(result.valid).toBe(false);
    });

    it('errori multipli riportati', () => {
        const result = validateConfigCaps({
            softInviteCap: -1,
            hardInviteCap: -1,
            weeklyInviteLimit: -1,
            softMsgCap: -1,
            hardMsgCap: -1,
            weeklyMessageLimit: -1,
            followUpDailyCap: -1,
            followUpMax: -1,
            profileViewDailyCap: -1,
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(3);
    });

    it('configCapSchema.parse lancia per input invalido', () => {
        expect(() => configCapSchema.parse({ softInviteCap: -1 })).toThrow();
    });
});
