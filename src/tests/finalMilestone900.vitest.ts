import { describe, it, expect } from 'vitest';
import { evaluateRisk } from '../risk/riskEngine';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';
import { validateMessageContent } from '../validation/messageValidator';
import { isValidLeadTransition } from '../core/leadStateService';

describe('Milestone 900 — cross-module integration sanity', () => {
    it('risk score 0 + trust score alto → bot può operare', () => {
        const risk = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        const trust = calculateAccountTrustScore({
            ssiScore: 90,
            ageDays: 500,
            acceptanceRatePct: 45,
            challengesLast7d: 0,
            pendingRatio: 0.2,
        });
        expect(risk.action).toBe('NORMAL');
        expect(trust.budgetMultiplier).toBeGreaterThan(1.0);
    });

    it('messaggio valido + transizione valida = flusso completo', () => {
        const msg = validateMessageContent('Ciao Marco, grazie per aver accettato!', { duplicateCountLast24h: 0 });
        expect(msg.valid).toBe(true);
        expect(isValidLeadTransition('ACCEPTED', 'READY_MESSAGE')).toBe(true);
        expect(isValidLeadTransition('READY_MESSAGE', 'MESSAGED')).toBe(true);
    });
});
