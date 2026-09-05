/**
 * riskInputsConsumersExposeSample.vitest.ts — C3 del contratto `bot-operativo`: i consumer espongono il pending ratio
 * GREZZO insieme al campione E lo usano — la compliance del doctor (`core/doctor.ts`: la violazione PENDING_RATIO passa
 * dal gate di C1; è un GATE reale perché `compliance.enforced && !compliance.ok` blocca il preflight obbligatorio),
 * `GET /api/kpis` e `GET /api/risk/explain` (router reale, via supertest) e il daily report Telegram.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import type { RiskInputs } from '../types/domain';
import { bindExpressTestServer, closeExpressTestServer } from './helpers/bindExpressTestServer';

const mocks = vi.hoisted(() => ({
    getRiskInputs: vi.fn(),
    sendTelegramAlert: vi.fn(),
}));

vi.mock('../core/repositories', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core/repositories')>();
    return { ...actual, getRiskInputs: mocks.getRiskInputs };
});

vi.mock('../telemetry/alerts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../telemetry/alerts')>();
    return { ...actual, sendTelegramAlert: mocks.sendTelegramAlert };
});

import { evaluateCompliance } from '../core/doctor';
import { statsRouter } from '../api/routes/stats';
import { generateAndSendDailyReport } from '../telemetry/dailyReporter';

const N = 20;

function inputs(pendingRatio: number, invitedTotal: number): RiskInputs {
    return {
        pendingRatio,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal,
        attemptsTotal24h: 10,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = N;
    config.riskMinAttemptsSample = 5;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.lowActivityEnabled = false;
    // Compliance: cap e limiti fissati sotto i massimi; `weeklyInvitesSent` viene dal DB di test (copia con 0 inviti
    // storici, + al più le poche righe che i test paralleli inseriscono) → resta sotto il limite 50.
    config.complianceEnforced = true;
    config.complianceHealthPendingWarnThreshold = 0.55;
    config.complianceHealthScoreEnabled = false;
    config.complianceDynamicWeeklyLimitEnabled = false;
    config.softInviteCap = 5;
    config.hardInviteCap = 10;
    config.softMsgCap = 5;
    config.hardMsgCap = 10;
    config.weeklyInviteLimit = 50;
    config.complianceMaxHardInviteCap = 100;
    config.complianceMaxWeeklyInviteLimit = 500;
    config.complianceMaxHardMsgCap = 100;
});

describe('C3 — doctor: PENDING_RATIO passa dal gate di C1 ed espone il campione', () => {
    test('1 invitato / 1 pending → compliance.ok true, nessuna violazione PENDING_RATIO, entrambe le chiavi esposte', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, 1));

        const compliance = await evaluateCompliance();

        expect(compliance.violations.filter((violation) => violation.startsWith('PENDING_RATIO'))).toHaveLength(0);
        expect(compliance.ok).toBe(true);
        expect(compliance.dynamic.pendingRatio).toBe(1);
        expect(compliance.dynamic.invitedTotal).toBe(1);
        expect(compliance.dynamic.pendingSampleSufficient).toBe(false);
    });

    test('N-1 invitati tutti pending → ancora nessuna violazione PENDING_RATIO', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, N - 1));

        const compliance = await evaluateCompliance();

        expect(compliance.violations.filter((violation) => violation.startsWith('PENDING_RATIO'))).toHaveLength(0);
        expect(compliance.ok).toBe(true);
    });

    test('20 invitati / 20 pending → compliance.ok false con PENDING_RATIO (comportamento odierno)', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, N));

        const compliance = await evaluateCompliance();

        expect(compliance.violations.some((violation) => violation.startsWith('PENDING_RATIO'))).toBe(true);
        expect(compliance.ok).toBe(false);
        expect(compliance.dynamic.invitedTotal).toBe(N);
        expect(compliance.dynamic.pendingSampleSufficient).toBe(true);
    });
});

describe('C3 — GET /api/kpis e GET /api/risk/explain via il router reale', () => {
    let server: Server | null = null;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.use('/api', statsRouter);
        server = await bindExpressTestServer(app);
    });

    afterAll(async () => {
        await closeExpressTestServer(server);
    });

    test('/api/kpis espone riskInputs.pendingRatio, invitedTotal e pendingSampleSufficient accanto a risk', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, 1));

        const res = await request(server as Server).get('/api/kpis');

        expect(res.status).toBe(200);
        expect(res.body.riskInputs).toMatchObject({ pendingRatio: 1, invitedTotal: 1, pendingSampleSufficient: false });
        expect(res.body.risk.pendingRatio).toBe(1);
        expect(res.body.risk.action).toBe('NORMAL');
    });

    test('/api/kpis sopra campione: pendingSampleSufficient true e risk STOP come oggi', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, N));

        const res = await request(server as Server).get('/api/kpis');

        expect(res.status).toBe(200);
        expect(res.body.riskInputs).toMatchObject({ pendingRatio: 1, invitedTotal: N, pendingSampleSufficient: true });
        expect(res.body.risk.action).toBe('STOP');
    });

    test('/api/risk/explain sotto campione: fattore pendingRatio con contribution 0 e sample.pending.sufficient false', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, 1));

        const res = await request(server as Server).get('/api/risk/explain');

        expect(res.status).toBe(200);
        const pending = res.body.factors.find((factor: { name: string }) => factor.name === 'pendingRatio');
        expect(pending.contribution).toBe(0);
        expect(pending.rawValue).toBe(1);
        expect(res.body.sample.pending).toMatchObject({ sufficient: false, sampleSize: 1, minSample: N });
    });

    test('/api/risk/explain sopra campione: il fattore pendingRatio contribuisce come oggi', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, N));

        const res = await request(server as Server).get('/api/risk/explain');

        expect(res.status).toBe(200);
        const pending = res.body.factors.find((factor: { name: string }) => factor.name === 'pendingRatio');
        expect(pending.contribution).toBeGreaterThan(0);
        expect(res.body.sample.pending.sufficient).toBe(true);
    });
});

describe('C3 — daily report Telegram stampa ratio grezzo e invitati totali', () => {
    test('il testo contiene «invitati totali», il campione e il pending grezzo', async () => {
        mocks.getRiskInputs.mockResolvedValue(inputs(1, 1));
        mocks.sendTelegramAlert.mockResolvedValue(true);

        const ok = await generateAndSendDailyReport('2026-09-04');

        expect(ok).toBe(true);
        expect(mocks.sendTelegramAlert).toHaveBeenCalledTimes(1);
        const text = String(mocks.sendTelegramAlert.mock.calls[0]?.[0] ?? '');
        expect(text).toMatch(/Pending Ratio: \*100\.0%\* \(1 invitato totale, campione < 20: non pesa\)/);
    });

    test('sopra campione: plurale e NESSUNA nota sul campione', async () => {
        mocks.sendTelegramAlert.mockClear();
        mocks.getRiskInputs.mockResolvedValue(inputs(1, N));
        mocks.sendTelegramAlert.mockResolvedValue(true);

        const ok = await generateAndSendDailyReport('2026-09-04');

        expect(ok).toBe(true);
        const text = String(mocks.sendTelegramAlert.mock.calls[0]?.[0] ?? '');
        expect(text).toMatch(/Pending Ratio: \*100\.0%\* \(20 invitati totali\)/);
        expect(text).not.toContain('non pesa');
    });
});
