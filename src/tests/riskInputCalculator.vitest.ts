import { describe, test, expect } from 'vitest';
import { calculateRiskInputs } from '../core/services/riskInputCalculator';

describe('calculateRiskInputs — funzione pura', () => {
    test('tutti zero → tutti ratio zero', () => {
        const result = calculateRiskInputs({
            pendingInvites: 0, invitedTotal: 0,
            totalAttempts24h: 0, failedAttempts24h: 0,
            selectorFailuresToday: 0, challengeCountToday: 0,
            invitesSentToday: 0, hardInviteCap: 20,
        });
        expect(result.pendingRatio).toBe(0);
        expect(result.errorRate).toBe(0);
        expect(result.selectorFailureRate).toBe(0);
        expect(result.challengeCount).toBe(0);
        expect(result.inviteVelocityRatio).toBe(0);
    });

    test('pending ratio calcolato correttamente', () => {
        const result = calculateRiskInputs({
            pendingInvites: 30, invitedTotal: 100,
            totalAttempts24h: 50, failedAttempts24h: 5,
            selectorFailuresToday: 2, challengeCountToday: 0,
            invitesSentToday: 10, hardInviteCap: 20,
        });
        expect(result.pendingRatio).toBeCloseTo(0.3, 4);
        expect(result.errorRate).toBeCloseTo(0.1, 4);
        expect(result.inviteVelocityRatio).toBeCloseTo(0.5, 4);
    });

    test('hardInviteCap zero → velocityRatio zero (no division by zero)', () => {
        const result = calculateRiskInputs({
            pendingInvites: 10, invitedTotal: 50,
            totalAttempts24h: 20, failedAttempts24h: 3,
            selectorFailuresToday: 1, challengeCountToday: 1,
            invitesSentToday: 15, hardInviteCap: 0,
        });
        expect(result.inviteVelocityRatio).toBe(0);
        expect(result.challengeCount).toBe(1);
    });

    test('invitedTotal zero → pendingRatio zero', () => {
        const result = calculateRiskInputs({
            pendingInvites: 5, invitedTotal: 0,
            totalAttempts24h: 10, failedAttempts24h: 10,
            selectorFailuresToday: 0, challengeCountToday: 0,
            invitesSentToday: 0, hardInviteCap: 20,
        });
        expect(result.pendingRatio).toBe(0);
        expect(result.errorRate).toBe(1);
    });

    test('selectorFailureRate usa max(1, totalAttempts) come denominatore', () => {
        const result = calculateRiskInputs({
            pendingInvites: 0, invitedTotal: 0,
            totalAttempts24h: 0, failedAttempts24h: 0,
            selectorFailuresToday: 5, challengeCountToday: 0,
            invitesSentToday: 0, hardInviteCap: 20,
        });
        expect(result.selectorFailureRate).toBe(5);
    });
});
