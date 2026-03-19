import { describe, it, expect } from 'vitest';
import {
    configCapSchema,
    configTimingSchema,
    configRiskSchema,
    CONFIG_PROFILES,
    validateConfigCaps,
    suggestConfigProfile,
} from '../config/schema';

describe('Config Zod Schema (A18)', () => {
    describe('configCapSchema', () => {
        it('profilo moderate passa validazione', () => {
            const result = configCapSchema.safeParse(CONFIG_PROFILES.moderate.caps);
            expect(result.success).toBe(true);
        });

        it('profilo conservative passa validazione', () => {
            const result = configCapSchema.safeParse(CONFIG_PROFILES.conservative.caps);
            expect(result.success).toBe(true);
        });

        it('profilo aggressive passa validazione', () => {
            const result = configCapSchema.safeParse(CONFIG_PROFILES.aggressive.caps);
            expect(result.success).toBe(true);
        });

        it('cap negativo → errore', () => {
            const result = configCapSchema.safeParse({ ...CONFIG_PROFILES.moderate.caps, hardInviteCap: -1 });
            expect(result.success).toBe(false);
        });

        it('cap troppo alto → errore', () => {
            const result = configCapSchema.safeParse({ ...CONFIG_PROFILES.moderate.caps, hardInviteCap: 500 });
            expect(result.success).toBe(false);
        });

        it('cap non intero → errore', () => {
            const result = configCapSchema.safeParse({ ...CONFIG_PROFILES.moderate.caps, hardInviteCap: 10.5 });
            expect(result.success).toBe(false);
        });
    });

    describe('configTimingSchema', () => {
        it('profilo moderate passa', () => {
            const result = configTimingSchema.safeParse(CONFIG_PROFILES.moderate.timing);
            expect(result.success).toBe(true);
        });

        it('workingHoursStart > 23 → errore', () => {
            const result = configTimingSchema.safeParse({ ...CONFIG_PROFILES.moderate.timing, workingHoursStart: 25 });
            expect(result.success).toBe(false);
        });
    });

    describe('configRiskSchema', () => {
        it('profilo moderate passa', () => {
            const result = configRiskSchema.safeParse(CONFIG_PROFILES.moderate.risk);
            expect(result.success).toBe(true);
        });

        it('pendingRatioStop > 1 → errore', () => {
            const result = configRiskSchema.safeParse({ ...CONFIG_PROFILES.moderate.risk, pendingRatioStop: 1.5 });
            expect(result.success).toBe(false);
        });
    });

    describe('validateConfigCaps', () => {
        it('caps validi → valid=true', () => {
            const result = validateConfigCaps(CONFIG_PROFILES.moderate.caps);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('caps invalidi → valid=false con errori', () => {
            const result = validateConfigCaps({ ...CONFIG_PROFILES.moderate.caps, hardInviteCap: -1 });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('suggestConfigProfile', () => {
        it('account nuovo → conservative', () => {
            expect(suggestConfigProfile(30, 200)).toBe('conservative');
        });

        it('account medio → moderate', () => {
            expect(suggestConfigProfile(180, 1500)).toBe('moderate');
        });

        it('account maturo → aggressive', () => {
            expect(suggestConfigProfile(500, 5000)).toBe('aggressive');
        });

        it('account vecchio ma poche connessioni → moderate', () => {
            expect(suggestConfigProfile(400, 500)).toBe('moderate');
        });
    });

    describe('CONFIG_PROFILES', () => {
        it('3 profili definiti', () => {
            expect(Object.keys(CONFIG_PROFILES)).toHaveLength(3);
        });

        it('ogni profilo ha nome e descrizione', () => {
            for (const profile of Object.values(CONFIG_PROFILES)) {
                expect(profile.name).toBeTruthy();
                expect(profile.description).toBeTruthy();
            }
        });

        it('conservative ha cap più bassi di aggressive', () => {
            expect(CONFIG_PROFILES.conservative.caps.hardInviteCap).toBeLessThan(CONFIG_PROFILES.aggressive.caps.hardInviteCap);
            expect(CONFIG_PROFILES.conservative.caps.hardMsgCap).toBeLessThan(CONFIG_PROFILES.aggressive.caps.hardMsgCap);
        });
    });
});
