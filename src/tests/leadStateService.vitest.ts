import { describe, it, expect } from 'vitest';
import { isValidLeadTransition } from '../core/leadStateService';
import type { LeadStatus } from '../types/domain';

describe('leadStateService — isValidLeadTransition', () => {
    // ── Transizioni valide ──
    it('NEW → READY_INVITE è valida', () => {
        expect(isValidLeadTransition('NEW', 'READY_INVITE')).toBe(true);
    });

    it('READY_INVITE → INVITED è valida', () => {
        expect(isValidLeadTransition('READY_INVITE', 'INVITED')).toBe(true);
    });

    it('INVITED → ACCEPTED è valida', () => {
        expect(isValidLeadTransition('INVITED', 'ACCEPTED')).toBe(true);
    });

    it('ACCEPTED → READY_MESSAGE è valida', () => {
        expect(isValidLeadTransition('ACCEPTED', 'READY_MESSAGE')).toBe(true);
    });

    it('READY_MESSAGE → MESSAGED è valida', () => {
        expect(isValidLeadTransition('READY_MESSAGE', 'MESSAGED')).toBe(true);
    });

    it('MESSAGED → REPLIED è valida', () => {
        expect(isValidLeadTransition('MESSAGED', 'REPLIED')).toBe(true);
    });

    // ── Transizioni sicurezza (REVIEW_REQUIRED, BLOCKED, DEAD) ──
    it('qualsiasi stato → REVIEW_REQUIRED è valida (tranne BLOCKED e DEAD)', () => {
        const statesWithReview: LeadStatus[] = [
            'NEW',
            'READY_INVITE',
            'INVITED',
            'ACCEPTED',
            'CONNECTED',
            'READY_MESSAGE',
            'MESSAGED',
            'REPLIED',
        ];
        for (const from of statesWithReview) {
            expect(isValidLeadTransition(from, 'REVIEW_REQUIRED')).toBe(true);
        }
    });

    it('REVIEW_REQUIRED → READY_INVITE (riabilitazione)', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'READY_INVITE')).toBe(true);
    });

    it('REVIEW_REQUIRED → BLOCKED (conferma blocco)', () => {
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'BLOCKED')).toBe(true);
    });

    it('WITHDRAWN → READY_INVITE (re-invito dopo ritiro)', () => {
        expect(isValidLeadTransition('WITHDRAWN', 'READY_INVITE')).toBe(true);
    });

    // ── Transizioni NON valide ──
    it('BLOCKED → qualsiasi è invalida (dead-end)', () => {
        const allStatuses: LeadStatus[] = [
            'NEW',
            'READY_INVITE',
            'INVITED',
            'ACCEPTED',
            'CONNECTED',
            'READY_MESSAGE',
            'MESSAGED',
            'REPLIED',
            'SKIPPED',
            'BLOCKED',
            'DEAD',
            'REVIEW_REQUIRED',
            'WITHDRAWN',
        ];
        for (const to of allStatuses) {
            expect(isValidLeadTransition('BLOCKED', to)).toBe(false);
        }
    });

    it('DEAD → qualsiasi è invalida (dead-end)', () => {
        const targets: LeadStatus[] = ['NEW', 'READY_INVITE', 'INVITED', 'MESSAGED'];
        for (const to of targets) {
            expect(isValidLeadTransition('DEAD', to)).toBe(false);
        }
    });

    it('NEW → MESSAGED è invalida (skip fasi)', () => {
        expect(isValidLeadTransition('NEW', 'MESSAGED')).toBe(false);
    });

    it('INVITED → MESSAGED è invalida (deve passare per ACCEPTED)', () => {
        expect(isValidLeadTransition('INVITED', 'MESSAGED')).toBe(false);
    });

    it('MESSAGED → NEW è invalida (non si torna indietro)', () => {
        expect(isValidLeadTransition('MESSAGED', 'NEW')).toBe(false);
    });

    it('REPLIED → MESSAGED è invalida', () => {
        expect(isValidLeadTransition('REPLIED', 'MESSAGED')).toBe(false);
    });

    it('READY_INVITE → ACCEPTED è invalida (deve passare per INVITED)', () => {
        expect(isValidLeadTransition('READY_INVITE', 'ACCEPTED')).toBe(false);
    });

    // ── C10: SalesNav URL → REVIEW_REQUIRED (non BLOCKED) ──
    it('NEW → REVIEW_REQUIRED (C10 fix: SalesNav URL)', () => {
        expect(isValidLeadTransition('NEW', 'REVIEW_REQUIRED')).toBe(true);
    });

    it('INVITED → REVIEW_REQUIRED (C04 fix: identity mismatch)', () => {
        expect(isValidLeadTransition('INVITED', 'REVIEW_REQUIRED')).toBe(true);
    });

    // ── Edge case: stesso stato ──
    it('NEW → NEW è invalida', () => {
        expect(isValidLeadTransition('NEW', 'NEW')).toBe(false);
    });

    it('MESSAGED → MESSAGED è invalida', () => {
        expect(isValidLeadTransition('MESSAGED', 'MESSAGED')).toBe(false);
    });
});
