import { describe, it, expect } from 'vitest';
import { configTimingSchema, configRiskSchema } from '../config/schema';

describe('configTimingSchema — edge cases', () => {
    it('interJobMinDelaySec = 4 → errore (min 5)', () => {
        const result = configTimingSchema.safeParse({
            interJobMinDelaySec: 4,
            interJobMaxDelaySec: 60,
            workingHoursStart: 8,
            workingHoursEnd: 19,
            challengePauseMinutes: 120,
        });
        expect(result.success).toBe(false);
    });

    it('interJobMaxDelaySec = 601 → errore (max 600)', () => {
        const result = configTimingSchema.safeParse({
            interJobMinDelaySec: 30,
            interJobMaxDelaySec: 601,
            workingHoursStart: 8,
            workingHoursEnd: 19,
            challengePauseMinutes: 120,
        });
        expect(result.success).toBe(false);
    });

    it('workingHoursEnd = 25 → errore (max 24)', () => {
        const result = configTimingSchema.safeParse({
            interJobMinDelaySec: 30,
            interJobMaxDelaySec: 90,
            workingHoursStart: 8,
            workingHoursEnd: 25,
            challengePauseMinutes: 120,
        });
        expect(result.success).toBe(false);
    });

    it('challengePauseMinutes = 4 → errore (min 5)', () => {
        const result = configTimingSchema.safeParse({
            interJobMinDelaySec: 30,
            interJobMaxDelaySec: 90,
            workingHoursStart: 8,
            workingHoursEnd: 19,
            challengePauseMinutes: 4,
        });
        expect(result.success).toBe(false);
    });

    it('valori al limite → valido', () => {
        const result = configTimingSchema.safeParse({
            interJobMinDelaySec: 5,
            interJobMaxDelaySec: 600,
            workingHoursStart: 0,
            workingHoursEnd: 24,
            challengePauseMinutes: 1440,
        });
        expect(result.success).toBe(true);
    });
});

describe('configRiskSchema — edge cases', () => {
    it('riskWarnThreshold = 9 → errore (min 10)', () => {
        const result = configRiskSchema.safeParse({
            riskWarnThreshold: 9,
            riskStopThreshold: 60,
            pendingRatioWarn: 0.5,
            pendingRatioStop: 0.7,
        });
        expect(result.success).toBe(false);
    });

    it('riskStopThreshold = 101 → errore (max 100)', () => {
        const result = configRiskSchema.safeParse({
            riskWarnThreshold: 30,
            riskStopThreshold: 101,
            pendingRatioWarn: 0.5,
            pendingRatioStop: 0.7,
        });
        expect(result.success).toBe(false);
    });

    it('pendingRatioWarn = 0.09 → errore (min 0.1)', () => {
        const result = configRiskSchema.safeParse({
            riskWarnThreshold: 30,
            riskStopThreshold: 60,
            pendingRatioWarn: 0.09,
            pendingRatioStop: 0.7,
        });
        expect(result.success).toBe(false);
    });

    it('pendingRatioStop = 1.1 → errore (max 1.0)', () => {
        const result = configRiskSchema.safeParse({
            riskWarnThreshold: 30,
            riskStopThreshold: 60,
            pendingRatioWarn: 0.5,
            pendingRatioStop: 1.1,
        });
        expect(result.success).toBe(false);
    });

    it('valori al limite → valido', () => {
        const result = configRiskSchema.safeParse({
            riskWarnThreshold: 10,
            riskStopThreshold: 100,
            pendingRatioWarn: 0.1,
            pendingRatioStop: 1.0,
        });
        expect(result.success).toBe(true);
    });
});
