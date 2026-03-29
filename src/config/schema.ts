/**
 * A18: Config Zod schema con validazione min/max e profili pre-testati.
 *
 * Tre profili:
 * - conservative: account nuovi, volumi bassi, massima sicurezza
 * - moderate: default raccomandato, bilanciato
 * - aggressive: account maturi (5000+ connessioni, 1+ anno), volumi alti
 *
 * Lo schema valida TUTTI i parametri numerici con min/max.
 * Se un valore è fuori range, Zod lancia con messaggio chiaro.
 */

import { z } from 'zod';

export const configCapSchema = z.object({
    softInviteCap: z.number().int().min(1).max(50).describe('Inviti soft cap giornaliero'),
    hardInviteCap: z.number().int().min(1).max(80).describe('Inviti hard cap giornaliero'),
    weeklyInviteLimit: z.number().int().min(1).max(300).describe('Inviti limite settimanale'),
    softMsgCap: z.number().int().min(1).max(60).describe('Messaggi soft cap giornaliero'),
    hardMsgCap: z.number().int().min(1).max(100).describe('Messaggi hard cap giornaliero'),
    weeklyMessageLimit: z.number().int().min(1).max(500).describe('Messaggi limite settimanale'),
    followUpDailyCap: z.number().int().min(1).max(30).describe('Follow-up cap giornaliero'),
    followUpMax: z.number().int().min(1).max(10).describe('Max follow-up per lead'),
    profileViewDailyCap: z.number().int().min(1).max(150).describe('Profile view cap giornaliero'),
});

export const configTimingSchema = z.object({
    interJobMinDelaySec: z.number().min(5).max(300).describe('Delay minimo tra job (secondi)'),
    interJobMaxDelaySec: z.number().min(10).max(600).describe('Delay massimo tra job (secondi)'),
    workingHoursStart: z.number().int().min(0).max(23).describe('Ora inizio attività'),
    workingHoursEnd: z.number().int().min(1).max(24).describe('Ora fine attività'),
    challengePauseMinutes: z.number().int().min(5).max(1440).describe('Pausa dopo challenge (minuti)'),
});

export const configRiskSchema = z.object({
    riskWarnThreshold: z.number().int().min(10).max(90).describe('Soglia risk warning'),
    riskStopThreshold: z.number().int().min(20).max(100).describe('Soglia risk stop'),
    pendingRatioWarn: z.number().min(0.1).max(0.9).describe('Pending ratio warning'),
    pendingRatioStop: z.number().min(0.2).max(1.0).describe('Pending ratio stop'),
});

export type ConfigCapValues = z.infer<typeof configCapSchema>;
export type ConfigTimingValues = z.infer<typeof configTimingSchema>;
export type ConfigRiskValues = z.infer<typeof configRiskSchema>;

export interface ConfigProfile {
    name: string;
    description: string;
    caps: ConfigCapValues;
    timing: ConfigTimingValues;
    risk: ConfigRiskValues;
}

export const CONFIG_PROFILES: Record<string, ConfigProfile> = {
    conservative: {
        name: 'conservative',
        description: 'Account nuovi o a rischio — volumi bassi, delay lunghi, soglie basse',
        caps: {
            softInviteCap: 5,
            hardInviteCap: 10,
            weeklyInviteLimit: 40,
            softMsgCap: 5,
            hardMsgCap: 10,
            weeklyMessageLimit: 40,
            followUpDailyCap: 3,
            followUpMax: 2,
            profileViewDailyCap: 30,
        },
        timing: {
            interJobMinDelaySec: 45,
            interJobMaxDelaySec: 120,
            workingHoursStart: 9,
            workingHoursEnd: 17,
            challengePauseMinutes: 240,
        },
        risk: {
            riskWarnThreshold: 25,
            riskStopThreshold: 45,
            pendingRatioWarn: 0.4,
            pendingRatioStop: 0.55,
        },
    },
    moderate: {
        name: 'moderate',
        description: 'Default raccomandato — bilanciato tra volume e sicurezza',
        caps: {
            softInviteCap: 15,
            hardInviteCap: 25,
            weeklyInviteLimit: 100,
            softMsgCap: 20,
            hardMsgCap: 35,
            weeklyMessageLimit: 150,
            followUpDailyCap: 10,
            followUpMax: 3,
            profileViewDailyCap: 80,
        },
        timing: {
            interJobMinDelaySec: 30,
            interJobMaxDelaySec: 90,
            workingHoursStart: 8,
            workingHoursEnd: 19,
            challengePauseMinutes: 180,
        },
        risk: {
            riskWarnThreshold: 35,
            riskStopThreshold: 60,
            pendingRatioWarn: 0.5,
            pendingRatioStop: 0.65,
        },
    },
    aggressive: {
        name: 'aggressive',
        description: 'Account maturi (1+ anno, 5000+ connessioni) — volumi alti, delay corti',
        caps: {
            softInviteCap: 25,
            hardInviteCap: 40,
            weeklyInviteLimit: 180,
            softMsgCap: 30,
            hardMsgCap: 50,
            weeklyMessageLimit: 250,
            followUpDailyCap: 15,
            followUpMax: 3,
            profileViewDailyCap: 120,
        },
        timing: {
            interJobMinDelaySec: 20,
            interJobMaxDelaySec: 60,
            workingHoursStart: 7,
            workingHoursEnd: 21,
            challengePauseMinutes: 120,
        },
        risk: {
            riskWarnThreshold: 40,
            riskStopThreshold: 70,
            pendingRatioWarn: 0.55,
            pendingRatioStop: 0.7,
        },
    },
};

/**
 * Valida i cap numerici della config corrente contro lo schema Zod.
 * Ritorna errori leggibili se valori fuori range.
 */
export function validateConfigCaps(cfg: Partial<ConfigCapValues>): { valid: boolean; errors: string[] } {
    const result = configCapSchema.safeParse(cfg);
    if (result.success) return { valid: true, errors: [] };
    return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
}

/**
 * Ritorna il profilo consigliato in base all'età dell'account e al numero di connessioni.
 */
export function suggestConfigProfile(accountAgeDays: number, connectionCount: number): string {
    if (accountAgeDays < 90 || connectionCount < 500) return 'conservative';
    if (accountAgeDays >= 365 && connectionCount >= 3000) return 'aggressive';
    return 'moderate';
}
