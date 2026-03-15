/**
 * tests/dlqAndConfig.vitest.ts
 * Test mirati per Dead Letter Worker (isErrorRecoverable) e Config Validation (validateConfigFull).
 * Queste due aree erano senza copertura test — P2-19.
 */

import { describe, it, expect } from 'vitest';
import { isErrorRecoverable } from '../workers/deadLetterWorker';
import { validateConfigFull } from '../config/validation';
import type { AppConfig } from '../config/types';

// ─── isErrorRecoverable ──────────────────────────────────────────────────────

describe('Dead Letter Worker — isErrorRecoverable', () => {
    // Recoverable errors (temporanei — il job dovrebbe essere riciclato)
    const recoverableErrors = [
        'Timeout waiting for selector .pv-text-details',
        'net::ERR_CONNECTION_RESET — network error',
        'Navigation failed because page was closed',
        'Target closed before action completed',
        'ECONNREFUSED 127.0.0.1:3128',
        'page target is closed',
        'proxy error: upstream timeout',
        'HTTP 429 Too Many Requests',
        'Rate limit exceeded',
        'HTTP 502 Bad Gateway',
        'HTTP 503 Service Unavailable',
        'HTTP 504 Gateway Timeout',
    ];

    for (const error of recoverableErrors) {
        it(`"${error.substring(0, 50)}..." è recoverable`, () => {
            expect(isErrorRecoverable(error)).toBe(true);
        });
    }

    // Terminal errors (permanenti — il job NON dovrebbe essere riciclato)
    const terminalErrors = [
        'Page not found (404)',
        'Invalid URL: not a valid linkedin url',
        'User not found on LinkedIn',
        'Account banned by LinkedIn',
        'Account restricted — contact support',
        '404 — profile does not exist',
    ];

    for (const error of terminalErrors) {
        it(`"${error.substring(0, 50)}..." è terminale`, () => {
            expect(isErrorRecoverable(error)).toBe(false);
        });
    }

    // Unknown errors — default to recoverable (vogliamo riciclare dopo un git pull fix)
    it('errore sconosciuto è recoverable di default', () => {
        expect(isErrorRecoverable('failed to find element .artdeco-button--primary')).toBe(true);
    });

    it('errore vuoto è recoverable di default', () => {
        expect(isErrorRecoverable('')).toBe(true);
    });

    // DLQ recycle cap: [DLQ_RECYCLED] marker non è testabile qui perché
    // il check è nel worker, non in isErrorRecoverable. Ma il worker
    // lo testa nel proprio flow (priority >= 50 || marker nel last_error).
});

// ─── validateConfigFull ──────────────────────────────────────────────────────

// Helper: config base valida (tutti i campi al minimo necessario)
function buildValidConfig(): AppConfig {
    // Usiamo un cast parziale — i test verificano solo le regole di validazione,
    // non la completezza di tutti i 200+ campi.
    return {
        supabaseSyncEnabled: false,
        supabaseUrl: '',
        supabaseServiceRoleKey: '',
        webhookSyncEnabled: false,
        webhookSyncUrl: '',
        dashboardAuthEnabled: false,
        dashboardApiKey: '',
        dashboardBasicUser: '',
        dashboardBasicPassword: '',
        dailyReportHour: 9,
        aiPersonalizationEnabled: false,
        aiSentimentEnabled: false,
        aiGuardianEnabled: false,
        openaiBaseUrl: '',
        openaiApiKey: '',
        inviteNoteMode: 'template',
        useJa3Proxy: false,
        ja3Fingerprint: '',
        ssiInviteMin: 5,
        ssiInviteMax: 20,
        ssiMessageMin: 3,
        ssiMessageMax: 15,
        interJobMinDelaySec: 10,
        interJobMaxDelaySec: 30,
        lowActivityRiskThreshold: 50,
        riskStopThreshold: 80,
        riskWarnThreshold: 30,
        behaviorDecoyMinIntervalJobs: 3,
        behaviorDecoyMaxIntervalJobs: 8,
        behaviorCoffeeBreakMinIntervalJobs: 5,
        behaviorCoffeeBreakMaxIntervalJobs: 12,
        behaviorCoffeeBreakMinSec: 60,
        behaviorCoffeeBreakMaxSec: 180,
        mobileProbability: 0.3,
        timingExplorationProbability: 0.1,
        timingMinSlotSample: 5,
        timingScoreThreshold: 0.5,
        timingRecentWindowDays: 14,
        timingRecentWeight: 0.6,
        timingBayesPriorWeight: 1.0,
        timingMaxDelayHours: 8,
        timingAbLookbackDays: 30,
        timingAbSignificanceAlpha: 0.05,
        disasterRecoveryRestoreTestIntervalDays: 7,
        securityAdvisorIntervalDays: 7,
        securityAdvisorDocMaxAgeDays: 90,
        securityAdvisorAuditLookbackDays: 30,
        securityAdvisorMinAuditEvents: 0,
        rampUpModelWarmupDays: 14,
        selectorLearningMinSuccess: 3,
        selectorLearningLimit: 100,
        selectorLearningEvaluationWindowDays: 7,
        selectorLearningFailureDegradeRatio: 0.5,
        selectorLearningFailureDegradeMinDelta: 1,
        selectorCacheKpiMinBaselineFailures: 0,
        observabilitySloWindowShortDays: 1,
        observabilitySloWindowLongDays: 7,
        observabilitySloErrorRateWarn: 0.1,
        observabilitySloErrorRateCritical: 0.3,
        observabilitySloChallengeRateWarn: 0.05,
        observabilitySloChallengeRateCritical: 0.15,
        observabilitySloSelectorFailureRateWarn: 0.1,
        observabilitySloSelectorFailureRateCritical: 0.3,
        greenModeIntervalMultiplier: 1,
        followUpDelayDays: 3,
        followUpNotInterestedDelayDays: 7,
        followUpDelayStddevDays: 1,
    } as unknown as AppConfig;
}

describe('Config Validation — validateConfigFull', () => {
    it('config base produce solo errori noti da campi non mockati', () => {
        const cfg = buildValidConfig();
        const result = validateConfigFull(cfg, 'test');
        // Il mock è parziale — errori possibili solo da campi non inclusi.
        // Verifichiamo che la funzione non crashi e ritorni un risultato valido.
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('SSI_INVITE_MAX < SSI_INVITE_MIN produce errore', () => {
        const cfg = buildValidConfig();
        cfg.ssiInviteMin = 20;
        cfg.ssiInviteMax = 5;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('SSI_INVITE_MAX'))).toBe(true);
    });

    it('DAILY_REPORT_HOUR fuori range produce errore', () => {
        const cfg = buildValidConfig();
        cfg.dailyReportHour = 25;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('DAILY_REPORT_HOUR'))).toBe(true);
    });

    it('INTER_JOB_MAX < INTER_JOB_MIN produce errore', () => {
        const cfg = buildValidConfig();
        cfg.interJobMinDelaySec = 30;
        cfg.interJobMaxDelaySec = 10;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('INTER_JOB_MAX'))).toBe(true);
    });

    it('MOBILE_PROBABILITY > 1 produce errore', () => {
        const cfg = buildValidConfig();
        cfg.mobileProbability = 1.5;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('MOBILE_PROBABILITY'))).toBe(true);
    });

    it('RAMPUP_MODEL_WARMUP_DAYS < 7 produce errore', () => {
        const cfg = buildValidConfig();
        cfg.rampUpModelWarmupDays = 3;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('RAMPUP_MODEL_WARMUP_DAYS'))).toBe(true);
    });

    it('SUPABASE_SYNC_ENABLED senza URL produce errore', () => {
        const cfg = buildValidConfig();
        cfg.supabaseSyncEnabled = true;
        cfg.supabaseUrl = '';
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('SUPABASE_URL'))).toBe(true);
    });

    it('FOLLOW_UP_NOT_INTERESTED_DELAY_DAYS < FOLLOW_UP_DELAY_DAYS produce errore', () => {
        const cfg = buildValidConfig();
        cfg.followUpDelayDays = 7;
        cfg.followUpNotInterestedDelayDays = 3;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.some((e) => e.includes('FOLLOW_UP_NOT_INTERESTED_DELAY_DAYS'))).toBe(true);
    });

    it('multiple errori rilevati simultaneamente', () => {
        const cfg = buildValidConfig();
        cfg.ssiInviteMin = 20;
        cfg.ssiInviteMax = 5;
        cfg.dailyReportHour = -1;
        cfg.mobileProbability = -0.5;
        const result = validateConfigFull(cfg, 'production');
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
});
