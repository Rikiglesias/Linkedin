/**
 * guardianHeuristicsSample.vitest.ts — C21 del contratto `bot-operativo`: il guardian euristico (`ai/guardian.ts`,
 * attivo anche con `AI_GUARDIAN_ENABLED=false` perché `evaluateAiGuardian` ritorna `heuristic_critical_block` prima
 * del check del flag) decide sul CAMPIONE, non sul solo ratio: `pendingRatio >= 0.78` conta solo se
 * `pendingSampleSufficient` (C4, gate di C1); `blockedRatio >= 0.35` conta solo se `blockedSampleSufficient`.
 * Le soglie 0.78/0.35 NON cambiano.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { heuristics } from '../ai/guardian';
import type { ListScheduleBreakdown, ScheduleResult } from '../core/scheduler';
import type { RiskSnapshot } from '../types/domain';

function makeList(overrides: Partial<ListScheduleBreakdown>): ListScheduleBreakdown {
    return {
        listName: 'lista',
        inviteBudget: 5,
        messageBudget: 3,
        queuedInviteJobs: 0,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        adaptiveFactor: 1,
        adaptiveReasons: [],
        pendingRatio: 0,
        blockedRatio: 0,
        pendingInvitedTotal: 0,
        pendingSampleSufficient: false,
        blockedSampleSufficient: false,
        maxScheduledDelaySec: 0,
        ...overrides,
    };
}

function makeSchedule(
    args: { riskAction?: RiskSnapshot['action']; lists?: ListScheduleBreakdown[] } = {},
): ScheduleResult {
    return {
        localDate: '2026-09-05',
        riskSnapshot: {
            score: 0,
            action: args.riskAction ?? 'NORMAL',
            pendingRatio: 0,
            errorRate: 0,
            selectorFailureRate: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        },
        inviteBudget: 10,
        messageBudget: 5,
        weeklyInvitesSent: 0,
        weeklyInviteLimitEffective: 50,
        weeklyInvitesRemaining: 50,
        queuedInviteJobs: 0,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        listBreakdown: args.lists ?? [],
        dryRun: true,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioWarn = 0.55;
    config.aiGuardianPauseMinutes = 180;
});

describe('C21 — pending ratio per-lista col campione', () => {
    it('1 INVITED / 0 esiti (ratio 1, campione 1) → severity ≠ critical: il primo invito non pausa il bot', () => {
        const decision = heuristics(
            makeSchedule({
                lists: [makeList({ pendingRatio: 1, pendingInvitedTotal: 1, pendingSampleSufficient: false })],
            }),
        );
        expect(decision.severity).not.toBe('critical');
        expect(decision.pauseMinutes).toBe(0);
    });

    it('20 INVITED / 0 esiti (ratio 1, campione 20) → critical con pausa ≥ 30 min', () => {
        const decision = heuristics(
            makeSchedule({
                lists: [makeList({ pendingRatio: 1, pendingInvitedTotal: 20, pendingSampleSufficient: true })],
            }),
        );
        expect(decision.severity).toBe('critical');
        expect(decision.pauseMinutes).toBeGreaterThanOrEqual(30);
    });

    it('soglia 0.78 invariata: 0.77 sufficiente → non critical, 0.78 sufficiente → critical', () => {
        const sotto = heuristics(
            makeSchedule({ lists: [makeList({ pendingRatio: 0.77, pendingSampleSufficient: true })] }),
        );
        const sopra = heuristics(
            makeSchedule({ lists: [makeList({ pendingRatio: 0.78, pendingSampleSufficient: true })] }),
        );
        expect(sotto.severity).not.toBe('critical');
        expect(sopra.severity).toBe('critical');
    });
});

describe('C21 — blocked ratio per-lista col campione', () => {
    it('1 SKIPPED / 0 inviti (blockedRatio 1, denominatore 1) → ≠ critical', () => {
        const decision = heuristics(
            makeSchedule({ lists: [makeList({ blockedRatio: 1, blockedSampleSufficient: false })] }),
        );
        expect(decision.severity).not.toBe('critical');
    });

    it('blockedRatio 0.4 con campione sufficiente → critical come oggi', () => {
        const decision = heuristics(
            makeSchedule({ lists: [makeList({ blockedRatio: 0.4, blockedSampleSufficient: true })] }),
        );
        expect(decision.severity).toBe('critical');
    });
});

describe('C21 — il resto del guardian non cambia', () => {
    it('riskSnapshot.action STOP → critical anche senza liste', () => {
        expect(heuristics(makeSchedule({ riskAction: 'STOP' })).severity).toBe('critical');
    });

    it('nessun segnale → normal', () => {
        expect(heuristics(makeSchedule({ lists: [makeList({})] })).severity).toBe('normal');
    });
});
