import { describe, it, expect } from 'vitest';
import { isValidLeadTransition } from '../core/leadStateService';
import type { LeadStatus } from '../types/domain';

const ALL_STATUSES: LeadStatus[] = [
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

describe('leadStateService — exhaustive transition matrix', () => {
    it('ogni stato ha almeno una transizione valida (tranne BLOCKED e DEAD)', () => {
        for (const from of ALL_STATUSES) {
            if (from === 'BLOCKED' || from === 'DEAD') continue;
            const hasValidTransition = ALL_STATUSES.some((to) => isValidLeadTransition(from, to));
            expect(hasValidTransition, `${from} non ha transizioni valide`).toBe(true);
        }
    });

    it('BLOCKED e DEAD non hanno transizioni', () => {
        for (const to of ALL_STATUSES) {
            expect(isValidLeadTransition('BLOCKED', to)).toBe(false);
            expect(isValidLeadTransition('DEAD', to)).toBe(false);
        }
    });

    it('nessuno stato può transitare a NEW', () => {
        for (const from of ALL_STATUSES) {
            if (from === 'NEW') continue;
            expect(isValidLeadTransition(from, 'NEW'), `${from} → NEW dovrebbe essere invalido`).toBe(false);
        }
    });

    it('REVIEW_REQUIRED può transitare a molti stati (recovery)', () => {
        const validTargets = ALL_STATUSES.filter((to) => isValidLeadTransition('REVIEW_REQUIRED', to));
        expect(validTargets.length).toBeGreaterThanOrEqual(4);
    });

    it('SKIPPED può tornare a READY_INVITE', () => {
        expect(isValidLeadTransition('SKIPPED', 'READY_INVITE')).toBe(true);
    });

    it('CONNECTED può andare a READY_MESSAGE', () => {
        expect(isValidLeadTransition('CONNECTED', 'READY_MESSAGE')).toBe(true);
    });

    it('conteggio totale transizioni valide', () => {
        let count = 0;
        for (const from of ALL_STATUSES) {
            for (const to of ALL_STATUSES) {
                if (isValidLeadTransition(from, to)) count++;
            }
        }
        // Verifica che il numero sia ragionevole (non troppo pochi, non troppo)
        expect(count).toBeGreaterThan(20);
        expect(count).toBeLessThan(100);
    });
});
