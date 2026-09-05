/**
 * riskSnapshotSampleFlag.vitest.ts — review blocco 2 (2026-09-05): lo snapshot porta il campione del pending ratio
 * (`pendingSampleSufficient`) così i consumer che leggono il ratio GREZZO — cooldown (`evaluateCooldownDecision`) e
 * ramo `watch` del guardian — non agiscono su 1/1 = 1.0 al primo invito. Flag ASSENTE (letterali legacy) = come oggi.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateCooldownDecision, evaluateRisk } from '../risk/riskEngine';
import { heuristics } from '../ai/guardian';
import type { RiskInputs, RiskSnapshot } from '../types/domain';
import type { ScheduleResult } from '../core/scheduler';

function inputs(pendingRatio: number, invitedTotal: number): RiskInputs {
    return {
        pendingRatio,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal,
        attemptsTotal24h: 10,
    };
}

function snapshot(overrides: Partial<RiskSnapshot>): RiskSnapshot {
    return {
        score: 0,
        pendingRatio: 0,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        action: 'NORMAL',
        ...overrides,
    };
}

function schedule(riskSnapshot: RiskSnapshot): ScheduleResult {
    return {
        localDate: '2026-09-05',
        riskSnapshot,
        inviteBudget: 10,
        messageBudget: 5,
        weeklyInvitesSent: 0,
        weeklyInviteLimitEffective: 50,
        weeklyInvitesRemaining: 50,
        queuedInviteJobs: 0,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        listBreakdown: [],
        dryRun: true,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = 20;
    config.riskMinAttemptsSample = 5;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.lowActivityEnabled = false;
    config.cooldownEnabled = true;
    config.cooldownHighScore = 50;
    config.cooldownWarnScore = 30;
    config.cooldownPendingHighThreshold = 0.6;
    config.cooldownPendingThreshold = 0.45;
    config.cooldownHighMinutes = 60;
    config.cooldownWarnMinutes = 30;
    config.aiGuardianPauseMinutes = 180;
});

describe('evaluateRisk espone il campione nello snapshot', () => {
    it('1 pending / 1 invitato → pendingSampleSufficient false; 20/20 → true', () => {
        expect(evaluateRisk(inputs(1, 1)).pendingSampleSufficient).toBe(false);
        expect(evaluateRisk(inputs(1, 20)).pendingSampleSufficient).toBe(true);
    });
});

describe('cooldown: il pending pesa nel tier solo sopra campione', () => {
    it('WARN da score con pending 1.0 SOTTO campione → tier warn, non high', () => {
        const decision = evaluateCooldownDecision(
            snapshot({ score: 35, action: 'WARN', pendingRatio: 1, pendingSampleSufficient: false }),
        );
        expect(decision.tier).toBe('warn');
    });

    it('WARN da score con pending 1.0 SOPRA campione → high (come oggi)', () => {
        const decision = evaluateCooldownDecision(
            snapshot({ score: 35, action: 'WARN', pendingRatio: 1, pendingSampleSufficient: true }),
        );
        expect(decision.tier).toBe('high');
    });

    it('flag assente (letterale legacy) → come oggi: high', () => {
        const decision = evaluateCooldownDecision(snapshot({ score: 35, action: 'WARN', pendingRatio: 1 }));
        expect(decision.tier).toBe('high');
    });

    it('sotto campione con score basso e action WARN → nessun tier dal pending', () => {
        const decision = evaluateCooldownDecision(
            snapshot({ score: 10, action: 'WARN', pendingRatio: 1, pendingSampleSufficient: false }),
        );
        expect(decision.activate).toBe(false);
    });
});

describe('guardian `watch`: il pending globale pesa solo sopra campione', () => {
    it('action NORMAL, pending 1.0 sotto campione → normal', () => {
        const decision = heuristics(
            schedule(snapshot({ action: 'NORMAL', pendingRatio: 1, pendingSampleSufficient: false })),
        );
        expect(decision.severity).toBe('normal');
    });

    it('action NORMAL, pending 1.0 sopra campione → watch (come oggi)', () => {
        const decision = heuristics(
            schedule(snapshot({ action: 'NORMAL', pendingRatio: 1, pendingSampleSufficient: true })),
        );
        expect(decision.severity).toBe('watch');
    });

    it('flag assente → come oggi: watch', () => {
        expect(heuristics(schedule(snapshot({ action: 'NORMAL', pendingRatio: 1 }))).severity).toBe('watch');
    });
});
