import { describe, it, expect } from 'vitest';
import { evaluateRisk } from '../risk/riskEngine';
import { isValidLeadTransition } from '../core/leadStateService';

describe('MILESTONE 1000 — final 2 tests', () => {
    it('test 999: risk engine con tutti zero → NORMAL score 0', () => {
        const r = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        });
        expect(r.score).toBe(0);
        expect(r.action).toBe('NORMAL');
    });

    it('test 1000: flusso lead completo NEW → REPLIED è valido step by step', () => {
        const steps: Array<[string, string]> = [
            ['NEW', 'READY_INVITE'],
            ['READY_INVITE', 'INVITED'],
            ['INVITED', 'ACCEPTED'],
            ['ACCEPTED', 'READY_MESSAGE'],
            ['READY_MESSAGE', 'MESSAGED'],
            ['MESSAGED', 'REPLIED'],
        ];
        for (const [from, to] of steps) {
            expect(isValidLeadTransition(from as never, to as never), `${from} → ${to}`).toBe(true);
        }
    });
});
