/**
 * riskEngineSmallSample.vitest.ts — C6 del contratto `bot-operativo`: i rapporti sui TENTATIVI (`errorRate`,
 * `selectorFailureRate`) contano solo sopra `riskMinAttemptsSample` (default 5). Gemello di C2 per il campione
 * dei tentativi: `attemptsTotal24h` è obbligatorio e il gate fallisce chiuso sulla coppia incoerente.
 * `challengeCount` NON cambia: un challenge resta STOP.
 * Tabella di confine: attemptsTotal24h ∈ {0, 1, N-1, N, N+1} tutti falliti.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk } from '../risk/riskEngine';
import { attemptsSample } from '../risk/sampleGate';
import type { RiskInputs } from '../types/domain';

const N = 5;

function allFailed(attemptsTotal24h: number): RiskInputs {
    return {
        pendingRatio: 0,
        errorRate: attemptsTotal24h > 0 ? 1 : 0,
        selectorFailureRate: attemptsTotal24h > 0 ? 1 : 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal: 100,
        attemptsTotal24h,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = 20;
    config.riskMinAttemptsSample = N;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.lowActivityEnabled = false;
});

describe('C6 — attemptsSample (funzione condivisa)', () => {
    it('1 tentativo → non sufficiente', () => {
        const gate = attemptsSample({ attemptsTotal24h: 1, errorRate: 1, selectorFailureRate: 1 });
        expect(gate.sufficient).toBe(false);
        expect(gate.reason).toBe('sample_below_min');
        expect(gate.minSample).toBe(N);
    });

    it('coppia incoerente (0 tentativi ma errorRate > 0) → fail-closed', () => {
        const gate = attemptsSample({ attemptsTotal24h: 0, errorRate: 1, selectorFailureRate: 0 });
        expect(gate.sufficient).toBe(true);
        expect(gate.reason).toBe('inconsistent_sample_fail_closed');
    });

    it('campione invalido (NaN / negativo) → fail-closed', () => {
        expect(attemptsSample({ attemptsTotal24h: Number.NaN, errorRate: 0.5, selectorFailureRate: 0 }).sufficient).toBe(
            true,
        );
        expect(attemptsSample({ attemptsTotal24h: -1, errorRate: 0.5, selectorFailureRate: 0 }).sufficient).toBe(true);
    });
});

describe('C6 — tabella di confine {0, 1, N-1, N, N+1} tutti falliti', () => {
    it('1 tentativo fallito + 1 selector failure → NORMAL (non 60 = WARN come oggi)', () => {
        const snapshot = evaluateRisk(allFailed(1));
        expect(snapshot.action).toBe('NORMAL');
        expect(snapshot.score).toBe(0);
        const explanation = explainRisk(allFailed(1));
        expect(explanation.factors.find((f) => f.name === 'errorRate')?.contribution).toBe(0);
        expect(explanation.factors.find((f) => f.name === 'selectorFailureRate')?.contribution).toBe(0);
        expect(explanation.factors.find((f) => f.name === 'errorRate')?.threshold).toMatch(/campione insufficiente/);
    });

    it(`${N - 1} tentativi tutti falliti → NORMAL`, () => {
        expect(evaluateRisk(allFailed(N - 1)).action).toBe('NORMAL');
    });

    for (const attempts of [N, N + 1]) {
        it(`${attempts} tentativi tutti falliti → come oggi (score 60 → STOP)`, () => {
            const snapshot = evaluateRisk(allFailed(attempts));
            expect(snapshot.score).toBe(60);
            expect(snapshot.action).toBe('STOP');
        });
    }

    it('0 tentativi con errorRate 1 (incoerente) → fail-closed come oggi (STOP)', () => {
        const snapshot = evaluateRisk({ ...allFailed(0), errorRate: 1, selectorFailureRate: 1 });
        expect(snapshot.score).toBe(60);
        expect(snapshot.action).toBe('STOP');
    });

    it('10 tentativi / 10 fallimenti → WARN o STOP come oggi', () => {
        const snapshot = evaluateRisk(allFailed(10));
        expect(['WARN', 'STOP']).toContain(snapshot.action);
    });

    it('un challenge resta STOP anche sotto campione', () => {
        const snapshot = evaluateRisk({ ...allFailed(1), challengeCount: 1 });
        expect(snapshot.action).toBe('STOP');
    });

    it('sotto campione lo snapshot espone i rate GREZZI (verità per i report)', () => {
        const snapshot = evaluateRisk(allFailed(1));
        expect(snapshot.errorRate).toBe(1);
        expect(snapshot.selectorFailureRate).toBe(1);
    });
});

describe('C6 — riskAssessor preflight usa lo stesso campione', () => {
    it('errorFactor sotto campione = 0, 5/5 → 20', async () => {
        const { errorFactorFromSample } = await import('../workflows/preflight/riskAssessor');
        expect(errorFactorFromSample({ errorsToday: 1, processedToday: 1 })).toBe(0);
        expect(errorFactorFromSample({ errorsToday: 5, processedToday: 5 })).toBe(20);
        expect(errorFactorFromSample({ errorsToday: 0, processedToday: 0 })).toBe(0);
    });
});
