import { describe, it, expect } from 'vitest';
import {
    configCapSchema,
    configTimingSchema,
    configRiskSchema,
    CONFIG_PROFILES,
    suggestConfigProfile,
} from '../config/schema';

describe('Config Schema — profile cross-validation', () => {
    it('tutti i profili passano tutti e 3 gli schema', () => {
        for (const [name, profile] of Object.entries(CONFIG_PROFILES)) {
            const caps = configCapSchema.safeParse(profile.caps);
            expect(caps.success, `${name} caps failed: ${JSON.stringify(caps.error?.issues)}`).toBe(true);
            const timing = configTimingSchema.safeParse(profile.timing);
            expect(timing.success, `${name} timing failed`).toBe(true);
            const risk = configRiskSchema.safeParse(profile.risk);
            expect(risk.success, `${name} risk failed`).toBe(true);
        }
    });

    it('conservative ha delay più lunghi di aggressive', () => {
        expect(CONFIG_PROFILES.conservative.timing.interJobMinDelaySec)
            .toBeGreaterThan(CONFIG_PROFILES.aggressive.timing.interJobMinDelaySec);
    });

    it('conservative ha risk threshold più bassi di aggressive', () => {
        expect(CONFIG_PROFILES.conservative.risk.riskStopThreshold)
            .toBeLessThan(CONFIG_PROFILES.aggressive.risk.riskStopThreshold);
    });

    it('suggestConfigProfile boundary: 90 giorni, 500 connessioni → conservative', () => {
        expect(suggestConfigProfile(90, 500)).toBe('moderate');
    });

    it('suggestConfigProfile boundary: 89 giorni, 499 connessioni → conservative', () => {
        expect(suggestConfigProfile(89, 499)).toBe('conservative');
    });

    it('suggestConfigProfile boundary: 365 giorni, 3000 connessioni → aggressive', () => {
        expect(suggestConfigProfile(365, 3000)).toBe('aggressive');
    });

    it('softInviteCap <= hardInviteCap per tutti i profili', () => {
        for (const profile of Object.values(CONFIG_PROFILES)) {
            expect(profile.caps.softInviteCap).toBeLessThanOrEqual(profile.caps.hardInviteCap);
        }
    });

    it('softMsgCap <= hardMsgCap per tutti i profili', () => {
        for (const profile of Object.values(CONFIG_PROFILES)) {
            expect(profile.caps.softMsgCap).toBeLessThanOrEqual(profile.caps.hardMsgCap);
        }
    });

    it('workingHoursStart < workingHoursEnd per tutti i profili', () => {
        for (const profile of Object.values(CONFIG_PROFILES)) {
            expect(profile.timing.workingHoursStart).toBeLessThan(profile.timing.workingHoursEnd);
        }
    });

    it('riskWarnThreshold < riskStopThreshold per tutti i profili', () => {
        for (const profile of Object.values(CONFIG_PROFILES)) {
            expect(profile.risk.riskWarnThreshold).toBeLessThan(profile.risk.riskStopThreshold);
        }
    });
});
