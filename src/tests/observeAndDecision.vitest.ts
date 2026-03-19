import { describe, it, expect } from 'vitest';
import { hasBlockingIssue, type PageObservation } from '../browser/observePageContext';
import type { AIDecisionResponse } from '../ai/aiDecisionEngine';

describe('observePageContext — hasBlockingIssue (R01)', () => {
    const baseObs: PageObservation = {
        profileName: 'Marco Rossi',
        profileHeadline: 'CEO at Acme',
        connectionDegree: '2nd',
        isProfileDeleted: false,
        hasModalOpen: false,
        hasChallenge: false,
        currentUrl: 'https://www.linkedin.com/in/marco-rossi/',
        hasConnectButton: true,
        hasMessageButton: false,
        hasPendingIndicator: false,
    };

    it('profilo normale → non bloccato', () => {
        const result = hasBlockingIssue(baseObs);
        expect(result.blocked).toBe(false);
        expect(result.reason).toBeNull();
    });

    it('profilo eliminato → bloccato', () => {
        const result = hasBlockingIssue({ ...baseObs, isProfileDeleted: true });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('profile_deleted_or_404');
    });

    it('challenge rilevata → bloccato', () => {
        const result = hasBlockingIssue({ ...baseObs, hasChallenge: true });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('challenge_or_restriction_detected');
    });

    it('profilo eliminato + challenge → profilo eliminato ha priorità', () => {
        const result = hasBlockingIssue({ ...baseObs, isProfileDeleted: true, hasChallenge: true });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('profile_deleted_or_404');
    });

    it('modale aperto → NON bloccante (non è un errore critico)', () => {
        const result = hasBlockingIssue({ ...baseObs, hasModalOpen: true });
        expect(result.blocked).toBe(false);
    });
});

describe('AIDecisionResponse types (R02)', () => {
    it('risposta PROCEED valida', () => {
        const response: AIDecisionResponse = {
            action: 'PROCEED',
            confidence: 0.85,
            reason: 'Good lead fit',
        };
        expect(response.action).toBe('PROCEED');
        expect(response.confidence).toBeGreaterThanOrEqual(0);
        expect(response.confidence).toBeLessThanOrEqual(1);
    });

    it('risposta SKIP valida', () => {
        const response: AIDecisionResponse = {
            action: 'SKIP',
            confidence: 0.7,
            reason: 'Profile too sparse',
        };
        expect(response.action).toBe('SKIP');
    });

    it('risposta con messageContext', () => {
        const response: AIDecisionResponse = {
            action: 'PROCEED',
            confidence: 0.9,
            reason: 'Lead asked about pricing',
            messageContext: 'Respond with pricing details',
        };
        expect(response.messageContext).toBe('Respond with pricing details');
    });

    it('risposta con navigationStrategy', () => {
        const response: AIDecisionResponse = {
            action: 'PROCEED',
            confidence: 0.6,
            reason: 'First invite of session',
            navigationStrategy: 'search_organic',
        };
        expect(response.navigationStrategy).toBe('search_organic');
    });

    it('risposta NOTIFY_HUMAN per situazioni complesse', () => {
        const response: AIDecisionResponse = {
            action: 'NOTIFY_HUMAN',
            confidence: 0.4,
            reason: 'Complex conversation requiring human judgment',
        };
        expect(response.action).toBe('NOTIFY_HUMAN');
        expect(response.confidence).toBeLessThan(0.5);
    });

    it('suggestedDelaySec opzionale e bounded', () => {
        const response: AIDecisionResponse = {
            action: 'DEFER',
            confidence: 0.65,
            reason: 'Lead is active but timing is wrong',
            suggestedDelaySec: 30,
        };
        expect(response.suggestedDelaySec).toBe(30);
        expect(response.suggestedDelaySec).toBeLessThanOrEqual(60);
    });
});
