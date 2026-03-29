import { describe, it, expect } from 'vitest';
import { isValidLeadTransition } from '../core/leadStateService';
import type { LeadStatus } from '../types/domain';

const ALL: LeadStatus[] = [
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

describe('leadState — complete transition matrix', () => {
    it('REVIEW_REQUIRED → WITHDRAWN è valida', () =>
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'WITHDRAWN')).toBe(true));
    it('REVIEW_REQUIRED → INVITED è valida', () =>
        expect(isValidLeadTransition('REVIEW_REQUIRED', 'INVITED')).toBe(true));
    it('REVIEW_REQUIRED → DEAD è valida', () => expect(isValidLeadTransition('REVIEW_REQUIRED', 'DEAD')).toBe(true));
    it('INVITED → WITHDRAWN è valida', () => expect(isValidLeadTransition('INVITED', 'WITHDRAWN')).toBe(true));
    it('INVITED → CONNECTED è valida', () => expect(isValidLeadTransition('INVITED', 'CONNECTED')).toBe(true));
    it('WITHDRAWN → DEAD è valida', () => expect(isValidLeadTransition('WITHDRAWN', 'DEAD')).toBe(true));
    it('REPLIED → DEAD è valida', () => expect(isValidLeadTransition('REPLIED', 'DEAD')).toBe(true));
    it('REPLIED → BLOCKED è valida', () => expect(isValidLeadTransition('REPLIED', 'BLOCKED')).toBe(true));
    it('NEW → DEAD è valida', () => expect(isValidLeadTransition('NEW', 'DEAD')).toBe(true));
    it('NEW → BLOCKED è valida', () => expect(isValidLeadTransition('NEW', 'BLOCKED')).toBe(true));
    it('READY_INVITE → DEAD è valida', () => expect(isValidLeadTransition('READY_INVITE', 'DEAD')).toBe(true));
    it('ACCEPTED → DEAD è valida', () => expect(isValidLeadTransition('ACCEPTED', 'DEAD')).toBe(true));
    it('CONNECTED → DEAD è valida', () => expect(isValidLeadTransition('CONNECTED', 'DEAD')).toBe(true));
    it('READY_MESSAGE → DEAD è valida', () => expect(isValidLeadTransition('READY_MESSAGE', 'DEAD')).toBe(true));
    it('SKIPPED → REVIEW_REQUIRED è valida', () =>
        expect(isValidLeadTransition('SKIPPED', 'REVIEW_REQUIRED')).toBe(true));

    it('conteggio transizioni totali nel sistema', () => {
        let valid = 0;
        for (const from of ALL) for (const to of ALL) if (isValidLeadTransition(from, to)) valid++;
        expect(valid).toBeGreaterThan(30);
        expect(valid).toBeLessThan(80);
    });
});
