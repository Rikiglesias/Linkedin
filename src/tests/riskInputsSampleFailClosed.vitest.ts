/**
 * riskInputsSampleFailClosed.vitest.ts — C2 del contratto `bot-operativo`: il campione è OBBLIGATORIO e il gate
 * fallisce CHIUSO su dati invalidi o incoerenti.
 *
 * (a) campione NaN/negativo/non finito, oppure coppia incoerente `invitedTotal <= 0 && pendingRatio > 0`
 *     → il ratio conta come SOPRA-campione (comportamento odierno: STOP a 0.9).
 * (b) ratio invalido (NaN/±Infinity/negativo/>1) → STOP con trigger `invalid_risk_inputs`
 *     (oggi `clampRatio` lo trasformava in 0 e APRIVA il gate).
 * (c) 0/0 = nessun dato → NORMAL. Il fallback di `sessionDataHelper` (DB irraggiungibile) → STOP, non NORMAL.
 * (d) `getRiskInputs` popola `invitedTotal` e `attemptsTotal24h` con i conteggi REALI del DB di test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk } from '../risk/riskEngine';
import { INVALID_RISK_INPUTS_FALLBACK } from '../risk/sampleGate';
import type { RiskInputs } from '../types/domain';

function inputs(partial: Partial<RiskInputs>): RiskInputs {
    return {
        pendingRatio: 0,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal: 100,
        attemptsTotal24h: 100,
        ...partial,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = 20;
    config.riskMinAttemptsSample = 5;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.lowActivityEnabled = false;
});

describe('C2(a) — campione invalido o incoerente → fail-closed (sopra-campione)', () => {
    for (const invitedTotal of [Number.NaN, -1, Number.POSITIVE_INFINITY, 0]) {
        it(`invitedTotal=${invitedTotal} con pendingRatio 0.9 → STOP`, () => {
            const snapshot = evaluateRisk(inputs({ pendingRatio: 0.9, invitedTotal }));
            expect(snapshot.action).toBe('STOP');
        });
    }

    it('la spiegazione dice PERCHÉ il campione è stato trattato come sufficiente', () => {
        const explanation = explainRisk(inputs({ pendingRatio: 0.9, invitedTotal: 0 }));
        const pending = explanation.factors.find((f) => f.name === 'pendingRatio');
        expect(pending?.contribution).toBeCloseTo(22.5, 5);
        expect(pending?.threshold).toMatch(/fail-closed/);
    });
});

describe('C2(b) — ratio invalido → STOP con trigger invalid_risk_inputs', () => {
    for (const pendingRatio of [Number.NaN, -0.1, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        it(`pendingRatio=${pendingRatio} con invitedTotal 100 → STOP + trigger`, () => {
            const snapshot = evaluateRisk(inputs({ pendingRatio }));
            expect(snapshot.action).toBe('STOP');
            const explanation = explainRisk(inputs({ pendingRatio }));
            expect(explanation.action).toBe('STOP');
            expect(explanation.triggers.some((t) => t.includes('invalid_risk_inputs'))).toBe(true);
        });
    }
});

describe('C2(c) — nessun dato e fallback', () => {
    it('0 invitati / ratio 0 → NORMAL (nessun dato, gate neutro)', () => {
        const snapshot = evaluateRisk(inputs({ pendingRatio: 0, invitedTotal: 0, attemptsTotal24h: 0 }));
        expect(snapshot.action).toBe('NORMAL');
        expect(snapshot.score).toBe(0);
    });

    it('il fallback di sessionDataHelper (DB irraggiungibile) → STOP, non NORMAL', () => {
        const snapshot = evaluateRisk(INVALID_RISK_INPUTS_FALLBACK);
        expect(snapshot.action).toBe('STOP');
        expect(explainRisk(INVALID_RISK_INPUTS_FALLBACK).triggers.some((t) => t.includes('invalid_risk_inputs'))).toBe(
            true,
        );
    });
});

describe('C2(d) — getRiskInputs propaga i conteggi REALI', () => {
    it('invitedTotal = COUNT(invited_at IS NOT NULL) e attemptsTotal24h = COUNT(job_attempts 24h)', async () => {
        const { getDatabase } = await import('../db');
        const { getRiskInputs } = await import('../core/repositories');
        const { getLocalDateString, config } = await import('../config');
        const db = await getDatabase();
        const invitedRow = await db.get<{ total: number }>(
            `SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`,
        );
        const attemptsRow = await db.get<{ total: number }>(
            `SELECT COUNT(*) as total FROM job_attempts WHERE started_at >= DATETIME('now', '-24 hours')`,
        );
        const riskInputs = await getRiskInputs(getLocalDateString(), config.hardInviteCap);
        expect(riskInputs.invitedTotal).toBe(invitedRow?.total ?? 0);
        expect(riskInputs.attemptsTotal24h).toBe(attemptsRow?.total ?? 0);
        expect(Number.isFinite(riskInputs.invitedTotal)).toBe(true);
        expect(riskInputs.invitedTotal).toBeGreaterThanOrEqual(0);
    });
});
