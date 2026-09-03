/**
 * riskSampleGate.vitest.ts — C1 del contratto `bot-operativo`: il pending ratio conta solo sopra un
 * campione minimo di invitati (`pendingRatioMinInvited`, default 20).
 *
 * Perché esiste: il bot non ha mai inviato un invito perché il PRIMO invito produceva 1 pending / 1 invitato
 * = ratio 1.0 ≥ pendingRatioStop → STOP → quarantena dell'account (stats.ts + riskEngine.ts + orchestrator.ts).
 * Tabella di confine obbligatoria: invitedTotal ∈ {0, 1, N-1, N, N+1}.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk } from '../risk/riskEngine';
import { pendingRatioSample } from '../risk/sampleGate';
import type { RiskInputs } from '../types/domain';

const N = 20;

function allPending(invitedTotal: number): RiskInputs {
    return {
        pendingRatio: invitedTotal > 0 ? 1 : 0,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal,
        attemptsTotal24h: 100,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = N;
    config.riskMinAttemptsSample = 5;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.lowActivityEnabled = false;
});

describe('C1 — pendingRatioSample (funzione condivisa)', () => {
    it('sotto campione: non sufficiente, ratio effettivo 0, motivo esplicito', () => {
        const gate = pendingRatioSample({ pendingRatio: 1, invitedTotal: 1 });
        expect(gate.sufficient).toBe(false);
        expect(gate.effectiveRatio).toBe(0);
        expect(gate.reason).toBe('sample_below_min');
        expect(gate.minSample).toBe(N);
    });

    it('sopra campione: sufficiente e ratio intatto', () => {
        const gate = pendingRatioSample({ pendingRatio: 0.9, invitedTotal: N });
        expect(gate.sufficient).toBe(true);
        expect(gate.effectiveRatio).toBe(0.9);
        expect(gate.reason).toBe('sample_ok');
    });

    it('nessun dato (0 invitati, ratio 0): neutro', () => {
        const gate = pendingRatioSample({ pendingRatio: 0, invitedTotal: 0 });
        expect(gate.sufficient).toBe(false);
        expect(gate.reason).toBe('no_data');
    });

    it('il campione minimo si legge dalla config, non da un literal', async () => {
        const { config } = await import('../config');
        const prev = config.pendingRatioMinInvited;
        config.pendingRatioMinInvited = 3;
        try {
            expect(pendingRatioSample({ pendingRatio: 1, invitedTotal: 3 }).sufficient).toBe(true);
            expect(pendingRatioSample({ pendingRatio: 1, invitedTotal: 2 }).sufficient).toBe(false);
        } finally {
            config.pendingRatioMinInvited = prev;
        }
    });
});

describe('C1 — tabella di confine {0, 1, N-1, N, N+1} tutti pending', () => {
    const attesi: Array<[number, RiskInputs['pendingRatio'] extends number ? 'NORMAL' | 'STOP' : never]> = [
        [0, 'NORMAL'],
        [1, 'NORMAL'],
        [N - 1, 'NORMAL'],
        [N, 'STOP'],
        [N + 1, 'STOP'],
    ];

    for (const [invitedTotal, action] of attesi) {
        it(`${invitedTotal} invitati tutti pending → ${action}`, () => {
            const snapshot = evaluateRisk(allPending(invitedTotal));
            expect(snapshot.action).toBe(action);
        });
    }

    it('1 invitato / 1 pending → NORMAL, contribution 0, 0 trigger (il deadlock del primo invito)', () => {
        const explanation = explainRisk(allPending(1));
        expect(explanation.action).toBe('NORMAL');
        const pending = explanation.factors.find((f) => f.name === 'pendingRatio');
        expect(pending?.contribution).toBe(0);
        expect(pending?.threshold).toMatch(/campione insufficiente/);
        expect(pending?.threshold).toMatch(new RegExp(`<${N} invitati`));
        expect(explanation.triggers).toHaveLength(0);
    });

    it('19 invitati / 19 pending → contribution 0, 0 trigger', () => {
        const explanation = explainRisk(allPending(N - 1));
        expect(explanation.factors.find((f) => f.name === 'pendingRatio')?.contribution).toBe(0);
        expect(explanation.triggers).toHaveLength(0);
    });

    it('sopra campione (N, N+1) lo snapshot è identico al comportamento odierno', () => {
        // Oggi: pendingRatio 1 → score 25 (1×25) e STOP per pendingRatio ≥ pendingRatioStop.
        for (const invitedTotal of [N, N + 1]) {
            const snapshot = evaluateRisk(allPending(invitedTotal));
            expect(snapshot.score).toBe(25);
            expect(snapshot.pendingRatio).toBe(1);
            expect(snapshot.action).toBe('STOP');
            const explanation = explainRisk(allPending(invitedTotal));
            expect(explanation.factors.find((f) => f.name === 'pendingRatio')?.contribution).toBe(25);
            expect(explanation.triggers.some((t) => t.includes('pendingRatio=100.0%'))).toBe(true);
        }
    });

    it('lo snapshot espone il ratio GREZZO anche sotto campione (verità per i report), ma non lo usa per lo score', () => {
        const snapshot = evaluateRisk(allPending(1));
        expect(snapshot.pendingRatio).toBe(1);
        expect(snapshot.score).toBe(0);
    });
});
