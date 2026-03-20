import { describe, it, expect } from 'vitest';
import { CONFIG_PROFILES, configCapSchema, configTimingSchema, configRiskSchema } from '../config/schema';

describe('CONFIG_PROFILES — exhaustive consistency', () => {
    for (const [name, profile] of Object.entries(CONFIG_PROFILES)) {
        describe(`profilo "${name}"`, () => {
            it('caps passano schema', () => {
                expect(configCapSchema.safeParse(profile.caps).success).toBe(true);
            });
            it('timing passa schema', () => {
                expect(configTimingSchema.safeParse(profile.timing).success).toBe(true);
            });
            it('risk passa schema', () => {
                expect(configRiskSchema.safeParse(profile.risk).success).toBe(true);
            });
            it('softInviteCap <= hardInviteCap', () => {
                expect(profile.caps.softInviteCap).toBeLessThanOrEqual(profile.caps.hardInviteCap);
            });
            it('softMsgCap <= hardMsgCap', () => {
                expect(profile.caps.softMsgCap).toBeLessThanOrEqual(profile.caps.hardMsgCap);
            });
            it('riskWarnThreshold < riskStopThreshold', () => {
                expect(profile.risk.riskWarnThreshold).toBeLessThan(profile.risk.riskStopThreshold);
            });
            it('pendingRatioWarn < pendingRatioStop', () => {
                expect(profile.risk.pendingRatioWarn).toBeLessThan(profile.risk.pendingRatioStop);
            });
            it('interJobMinDelaySec < interJobMaxDelaySec', () => {
                expect(profile.timing.interJobMinDelaySec).toBeLessThan(profile.timing.interJobMaxDelaySec);
            });
            it('workingHoursStart < workingHoursEnd', () => {
                expect(profile.timing.workingHoursStart).toBeLessThan(profile.timing.workingHoursEnd);
            });
            it('weeklyInviteLimit >= hardInviteCap * 3', () => {
                expect(profile.caps.weeklyInviteLimit).toBeGreaterThanOrEqual(profile.caps.hardInviteCap * 3);
            });
        });
    }
});
