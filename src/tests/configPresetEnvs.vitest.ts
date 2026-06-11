/**
 * tests/configPresetEnvs.vitest.ts
 * Verifica le env introdotte per i preset (goal preset-profili, T4):
 * - CHALLENGE_AUTO_RESOLVE_ENABLED (default true = comportamento storico invariato)
 * - GDPR_ANONYMIZE_AFTER_DAYS / GDPR_DELETE_AFTER_DAYS (default 180/365, floor difensivi)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildRuntimeDomainConfig } from '../config/domains';

const KEYS = ['CHALLENGE_AUTO_RESOLVE_ENABLED', 'GDPR_ANONYMIZE_AFTER_DAYS', 'GDPR_DELETE_AFTER_DAYS'] as const;

describe('config preset envs (T4 preset-profili)', () => {
    const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

    beforeEach(() => {
        for (const key of KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('default: auto-resolve attivo, soglie GDPR 180/365 (comportamento storico invariato)', () => {
        const cfg = buildRuntimeDomainConfig([]);
        expect(cfg.challengeAutoResolveEnabled).toBe(true);
        expect(cfg.gdprAnonymizeAfterDays).toBe(180);
        expect(cfg.gdprDeleteAfterDays).toBe(365);
    });

    it('CHALLENGE_AUTO_RESOLVE_ENABLED=false disattiva l\'auto-solve (preset max-stealth)', () => {
        process.env.CHALLENGE_AUTO_RESOLVE_ENABLED = 'false';
        const cfg = buildRuntimeDomainConfig([]);
        expect(cfg.challengeAutoResolveEnabled).toBe(false);
    });

    it('soglie GDPR env-overridable (es. max-stealth 90/180)', () => {
        process.env.GDPR_ANONYMIZE_AFTER_DAYS = '90';
        process.env.GDPR_DELETE_AFTER_DAYS = '180';
        const cfg = buildRuntimeDomainConfig([]);
        expect(cfg.gdprAnonymizeAfterDays).toBe(90);
        expect(cfg.gdprDeleteAfterDays).toBe(180);
    });

    it('floor difensivi: anonymize mai sotto 30 giorni, delete mai sotto 60', () => {
        process.env.GDPR_ANONYMIZE_AFTER_DAYS = '5';
        process.env.GDPR_DELETE_AFTER_DAYS = '10';
        const cfg = buildRuntimeDomainConfig([]);
        expect(cfg.gdprAnonymizeAfterDays).toBe(30);
        expect(cfg.gdprDeleteAfterDays).toBe(60);
    });
});
