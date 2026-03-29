import { describe, it, expect } from 'vitest';
import { evaluateRisk } from '../risk/riskEngine';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';
import { validateMessageContent } from '../validation/messageValidator';
import { isValidLeadTransition } from '../core/leadStateService';
import { normalizeLinkedInUrl } from '../linkedinUrl';

describe('Milestone 1100 — final integration', () => {
    it('sistema produce risultati coerenti per account maturo sano', () => {
        const risk = evaluateRisk({
            errorRate: 0.05,
            selectorFailureRate: 0.02,
            pendingRatio: 0.25,
            challengeCount: 0,
            inviteVelocityRatio: 0.15,
        });
        const trust = calculateAccountTrustScore({
            ssiScore: 75,
            ageDays: 400,
            acceptanceRatePct: 35,
            challengesLast7d: 0,
            pendingRatio: 0.25,
        });
        expect(risk.action).toBe('NORMAL');
        expect(trust.budgetMultiplier).toBeGreaterThanOrEqual(0.8);
    });

    it('messaggio personalizzato valido per lead reale', () => {
        const msg = validateMessageContent(
            'Ciao Anna, ho visto il tuo profilo e mi ha colpito la tua esperienza nel settore nonprofit. Mi piacerebbe connetterci per scambiare idee su come possiamo collaborare.',
            { duplicateCountLast24h: 0 },
        );
        expect(msg.valid).toBe(true);
    });

    it('URL LinkedIn normalizzato per profilo reale', () => {
        const url = normalizeLinkedInUrl('https://www.linkedin.com/in/anna-rossi-123/?trk=search-result');
        expect(url).toContain('/in/anna-rossi-123/');
        expect(url).not.toContain('trk');
    });

    it('transizione completa funnel: NEW → REPLIED', () => {
        const funnel = ['NEW', 'READY_INVITE', 'INVITED', 'ACCEPTED', 'READY_MESSAGE', 'MESSAGED', 'REPLIED'] as const;
        for (let i = 0; i < funnel.length - 1; i++) {
            expect(isValidLeadTransition(funnel[i], funnel[i + 1])).toBe(true);
        }
    });

    it('transizione recovery: REVIEW_REQUIRED → READY_INVITE → INVITED', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'READY_INVITE')).toBe(true);
        expect(isValidLeadTransition('READY_INVITE', 'INVITED')).toBe(true);
    });
});
