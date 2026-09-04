/**
 * antiBanChecklistPendingSample.vitest.ts — C5 ⑦ del contratto `bot-operativo`: la checklist anti-ban del preflight
 * (`workflows/preflight/antiBanChecklist.ts`) decide sul pending ratio del risk engine (`getRiskInputs`: denominatore
 * `invited_at IS NOT NULL`), NON sulla somma di TUTTI i lead del DB, e il literal `pendingCount > 10` è sostituito dal
 * gate condiviso di C1 (`pendingRatioMinInvited`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PreflightDbStats } from '../workflows/types';
import type { RiskInputs } from '../types/domain';

const mocks = vi.hoisted(() => ({
    getRuntimeAccountProfiles: vi.fn(),
    askConfirmation: vi.fn(),
    getRuntimeFlag: vi.fn(),
    getRiskInputs: vi.fn(),
}));

vi.mock('../accountManager', () => ({
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../cli/stdinHelper', () => ({
    askConfirmation: mocks.askConfirmation,
}));

vi.mock('../core/repositories', () => ({
    getRuntimeFlag: mocks.getRuntimeFlag,
    getRiskInputs: mocks.getRiskInputs,
}));

import { runAntiBanChecklist } from '../workflows/preflight/antiBanChecklist';

const N = 20;
let logSpy: ReturnType<typeof vi.spyOn>;

function riskInputs(pendingRatio: number, invitedTotal: number): RiskInputs {
    return {
        pendingRatio,
        errorRate: 0,
        selectorFailureRate: 0,
        challengeCount: 0,
        inviteVelocityRatio: 0,
        invitedTotal,
        attemptsTotal24h: 0,
    };
}

function dbStats(byStatus: Record<string, number>): PreflightDbStats {
    return {
        totalLeads: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
        byStatus,
        byList: {},
        withEmail: 0,
        withoutEmail: 0,
        withScore: 0,
        withJobTitle: 0,
        withPhone: 0,
        withLocation: 0,
        lastSyncAt: null,
        trend: null,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = N;
    config.pendingRatioStop = 0.65;
    config.pendingRatioWarn = 0.55;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    logSpy.mockRestore();
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'default' }]);
    mocks.getRuntimeFlag.mockResolvedValue(null);
});

describe('C5 ⑦ — gate del pending nella checklist col campione condiviso', () => {
    test('1 pending su 1 invitato (347 NEW) → nessun gate: passa con la sola conferma del browser', async () => {
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(1, 1));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ NEW: 347, INVITED: 1 }));

        expect(ok).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
    });

    test('N-1 pending su N-1 invitati → nessun gate', async () => {
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(1, N - 1));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ INVITED: N - 1 }));

        expect(ok).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
    });

    test('N pending su N invitati → gate di STOP: senza forzatura la sessione si ferma', async () => {
        mocks.askConfirmation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(1, N));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ NEW: 300, INVITED: N }));

        expect(ok).toBe(false);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(2);
    });

    test('literal `pendingCount > 10` rimosso: 11 pending su 11 invitati → nessun gate (campione < N)', async () => {
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(1, 11));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ INVITED: 11 }));

        expect(ok).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
    });

    test('denominatore = invitati reali, non tutti i lead: 15 pending su 20 invitati fra 363 lead → gate di STOP', async () => {
        // Prima: 15 / (348 + 15) = 0.04 → nessun gate. Col denominatore del risk engine: 15 / 20 = 0.75 ≥ 0.65 → STOP.
        mocks.askConfirmation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(0.75, 20));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ NEW: 348, INVITED: 15 }));

        expect(ok).toBe(false);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(2);
    });

    test('warn: 12 pending su 20 invitati (0.6) → solo avviso, nessuna conferma extra', async () => {
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(0.6, 20));

        const ok = await runAntiBanChecklist('send-invites', dbStats({ NEW: 348, INVITED: 12 }));

        expect(ok).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
    });

    test('il gate non riguarda i workflow non-outreach: sync-list con 20/20 pending passa', async () => {
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.getRiskInputs.mockResolvedValue(riskInputs(1, N));

        const ok = await runAntiBanChecklist('sync-list', dbStats({ INVITED: N }));

        expect(ok).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
    });
});
