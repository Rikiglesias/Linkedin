import { describe, it, expect } from 'vitest';
import { configCapSchema, configTimingSchema, configRiskSchema } from '../config/schema';

describe('configCapSchema — Zod parse vs safeParse', () => {
    it('parse valido → ritorna oggetto', () => {
        const valid = {
            softInviteCap: 10,
            hardInviteCap: 25,
            weeklyInviteLimit: 100,
            softMsgCap: 10,
            hardMsgCap: 35,
            weeklyMessageLimit: 150,
            followUpDailyCap: 10,
            followUpMax: 3,
            profileViewDailyCap: 80,
        };
        const result = configCapSchema.parse(valid);
        expect(result.hardInviteCap).toBe(25);
    });

    it('parse invalido → lancia ZodError', () => {
        expect(() => configCapSchema.parse({ softInviteCap: -1 })).toThrow();
    });

    it('safeParse invalido → success=false con issues', () => {
        const result = configCapSchema.safeParse({ softInviteCap: 999 });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.length).toBeGreaterThan(0);
        }
    });
});

describe('configTimingSchema — Zod parse', () => {
    it('parse valido → ritorna oggetto', () => {
        const valid = {
            interJobMinDelaySec: 30,
            interJobMaxDelaySec: 90,
            workingHoursStart: 8,
            workingHoursEnd: 19,
            challengePauseMinutes: 180,
        };
        const result = configTimingSchema.parse(valid);
        expect(result.workingHoursStart).toBe(8);
    });
});

describe('configRiskSchema — Zod parse', () => {
    it('parse valido → ritorna oggetto', () => {
        const valid = { riskWarnThreshold: 30, riskStopThreshold: 60, pendingRatioWarn: 0.5, pendingRatioStop: 0.7 };
        const result = configRiskSchema.parse(valid);
        expect(result.riskWarnThreshold).toBe(30);
    });
});
