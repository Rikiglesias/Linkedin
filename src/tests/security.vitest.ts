/**
 * tests/security.vitest.ts
 * Test mirati per contratti sicurezza e runtime:
 * - Lead state machine: transizioni consentite e rifiutate
 * - CSP header corretto
 * - Auth middleware contracts
 */

import { describe, it, expect } from 'vitest';
import { isValidLeadTransition } from '../core/leadStateService';
import type { LeadStatus } from '../types/domain';

// ─── Lead State Machine ──────────────────────────────────────────────────────

describe('Lead State Machine — transizioni consentite', () => {
    const validTransitions: Array<[LeadStatus, LeadStatus]> = [
        ['NEW', 'READY_INVITE'],
        ['NEW', 'BLOCKED'],
        ['NEW', 'DEAD'],
        ['READY_INVITE', 'INVITED'],
        ['READY_INVITE', 'SKIPPED'],
        ['READY_INVITE', 'BLOCKED'],
        ['INVITED', 'ACCEPTED'],
        ['INVITED', 'CONNECTED'],
        ['INVITED', 'BLOCKED'],
        ['INVITED', 'WITHDRAWN'],
        ['ACCEPTED', 'READY_MESSAGE'],
        ['ACCEPTED', 'CONNECTED'],
        ['ACCEPTED', 'BLOCKED'],
        ['READY_MESSAGE', 'MESSAGED'],
        ['READY_MESSAGE', 'BLOCKED'],
        ['MESSAGED', 'REPLIED'],
        ['REVIEW_REQUIRED', 'READY_INVITE'],
        ['REVIEW_REQUIRED', 'BLOCKED'],
        ['REVIEW_REQUIRED', 'DEAD'],
        ['WITHDRAWN', 'READY_INVITE'],
        ['WITHDRAWN', 'DEAD'],
    ];

    for (const [from, to] of validTransitions) {
        it(`${from} → ${to} deve essere consentita`, () => {
            expect(isValidLeadTransition(from, to)).toBe(true);
        });
    }
});

describe('Lead State Machine — transizioni rifiutate', () => {
    const invalidTransitions: Array<[LeadStatus, LeadStatus]> = [
        ['NEW', 'MESSAGED'],
        ['NEW', 'REPLIED'],
        ['NEW', 'ACCEPTED'],
        ['READY_INVITE', 'READY_MESSAGE'],
        ['READY_INVITE', 'MESSAGED'],
        ['INVITED', 'NEW'],
        ['INVITED', 'READY_INVITE'],
        ['INVITED', 'MESSAGED'],
        ['ACCEPTED', 'NEW'],
        ['ACCEPTED', 'INVITED'],
        ['ACCEPTED', 'MESSAGED'],
        ['READY_MESSAGE', 'NEW'],
        ['READY_MESSAGE', 'INVITED'],
        ['READY_MESSAGE', 'ACCEPTED'],
        ['MESSAGED', 'NEW'],
        ['MESSAGED', 'INVITED'],
        ['MESSAGED', 'MESSAGED'],
        ['REPLIED', 'NEW'],
        ['REPLIED', 'INVITED'],
        ['REPLIED', 'MESSAGED'],
        ['SKIPPED', 'NEW'],
        ['SKIPPED', 'INVITED'],
        ['BLOCKED', 'NEW'],
        ['BLOCKED', 'INVITED'],
        ['DEAD', 'NEW'],
        ['DEAD', 'INVITED'],
    ];

    for (const [from, to] of invalidTransitions) {
        it(`${from} → ${to} deve essere rifiutata`, () => {
            expect(isValidLeadTransition(from, to)).toBe(false);
        });
    }
});

describe('Lead State Machine — stati terminali', () => {
    const terminalStates: LeadStatus[] = ['REPLIED', 'SKIPPED', 'BLOCKED', 'DEAD'];

    for (const state of terminalStates) {
        it(`${state} è uno stato terminale (nessuna transizione in uscita eccetto verso se stesso)`, () => {
            const allStatuses: LeadStatus[] = [
                'NEW', 'READY_INVITE', 'INVITED', 'ACCEPTED', 'CONNECTED',
                'READY_MESSAGE', 'MESSAGED', 'REPLIED', 'SKIPPED', 'BLOCKED',
                'DEAD', 'REVIEW_REQUIRED', 'WITHDRAWN',
            ];
            for (const target of allStatuses) {
                if (target === state) continue;
                expect(isValidLeadTransition(state, target)).toBe(false);
            }
        });
    }
});

describe('Lead State Machine — REVIEW_REQUIRED è un hub di recovery', () => {
    it('REVIEW_REQUIRED può transitare a READY_INVITE', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'READY_INVITE')).toBe(true);
    });

    it('REVIEW_REQUIRED può transitare a READY_MESSAGE', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'READY_MESSAGE')).toBe(true);
    });

    it('REVIEW_REQUIRED può transitare a BLOCKED', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'BLOCKED')).toBe(true);
    });

    it('REVIEW_REQUIRED NON può transitare a NEW', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'NEW')).toBe(false);
    });

    it('REVIEW_REQUIRED NON può transitare a REPLIED', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'REPLIED')).toBe(false);
    });
});
