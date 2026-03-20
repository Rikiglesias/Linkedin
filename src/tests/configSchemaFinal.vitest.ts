import { describe, it, expect } from 'vitest';
import { configCapSchema, configTimingSchema, configRiskSchema, CONFIG_PROFILES, validateConfigCaps, suggestConfigProfile } from '../config/schema';

describe('configSchema — final comprehensive', () => {
    it('tutti i profili hanno weeklyMessageLimit >= hardMsgCap * 3', () => {
        for (const profile of Object.values(CONFIG_PROFILES)) {
            expect(profile.caps.weeklyMessageLimit).toBeGreaterThanOrEqual(profile.caps.hardMsgCap * 3);
        }
    });

    it('moderate è il profilo di default consigliato per account medi', () => {
        expect(suggestConfigProfile(180, 1500)).toBe('moderate');
    });

    it('conservative ha il challengePauseMinutes più alto', () => {
        const cons = CONFIG_PROFILES.conservative.timing.challengePauseMinutes;
        const mod = CONFIG_PROFILES.moderate.timing.challengePauseMinutes;
        const agg = CONFIG_PROFILES.aggressive.timing.challengePauseMinutes;
        expect(cons).toBeGreaterThanOrEqual(mod);
        expect(mod).toBeGreaterThanOrEqual(agg);
    });

    it('validateConfigCaps con profilo moderate → valido', () => {
        expect(validateConfigCaps(CONFIG_PROFILES.moderate.caps).valid).toBe(true);
    });

    it('validateConfigCaps con oggetto vuoto → invalido', () => {
        expect(validateConfigCaps({} as never).valid).toBe(false);
    });

    it('configCapSchema rejects non-integer followUpDailyCap', () => {
        const result = configCapSchema.safeParse({ ...CONFIG_PROFILES.moderate.caps, followUpDailyCap: 5.5 });
        expect(result.success).toBe(false);
    });

    it('configTimingSchema accepts boundary values', () => {
        expect(configTimingSchema.safeParse({ interJobMinDelaySec: 5, interJobMaxDelaySec: 10, workingHoursStart: 0, workingHoursEnd: 1, challengePauseMinutes: 5 }).success).toBe(true);
    });

    it('configRiskSchema accepts boundary values', () => {
        expect(configRiskSchema.safeParse({ riskWarnThreshold: 10, riskStopThreshold: 20, pendingRatioWarn: 0.1, pendingRatioStop: 0.2 }).success).toBe(true);
    });
});
