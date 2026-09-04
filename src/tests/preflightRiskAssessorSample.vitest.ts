/**
 * preflightRiskAssessorSample.vitest.ts — C5 ③ e C6 del contratto `bot-operativo`: il riskAssessor del preflight
 * (`workflows/preflight/riskAssessor.ts`) usa il campione condiviso di C1 sul pending ratio (sotto
 * `pendingRatioMinInvited` → `pendingFactor = 0`; 20/20 → 25 come oggi) e il campione dei tentativi di C6 sugli
 * errori (1 errore su 1 processato → `errorFactor = 0`; 5/5 → 20 come oggi).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PreflightConfigStatus } from '../workflows/types';

const mocks = vi.hoisted(() => ({
    checkDiskSpace: vi.fn(),
    getDatabase: vi.fn(),
    getLocalDateString: vi.fn(),
    getRuntimeAccountProfiles: vi.fn(),
    getDailyStat: vi.fn(),
    getRuntimeFlag: vi.fn(),
    setRuntimeFlag: vi.fn(),
}));

vi.mock('../db', () => ({
    checkDiskSpace: mocks.checkDiskSpace,
    getDatabase: mocks.getDatabase,
}));

vi.mock('../config', () => ({
    getLocalDateString: mocks.getLocalDateString,
    // Campioni minimi del gate (contratto bot-operativo C1/C6): il riskAssessor li legge via risk/sampleGate.
    config: { riskMinAttemptsSample: 5, pendingRatioMinInvited: 20 },
}));

vi.mock('../accountManager', () => ({
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../core/repositories', () => ({
    getDailyStat: mocks.getDailyStat,
    getRuntimeFlag: mocks.getRuntimeFlag,
    setRuntimeFlag: mocks.setRuntimeFlag,
}));

import { computeSessionRiskLevel } from '../workflows/preflight/riskAssessor';

const N_PENDING = 20;
const N_ATTEMPTS = 5;

function cfgStatus(overrides: Partial<PreflightConfigStatus> = {}): PreflightConfigStatus {
    return {
        proxyConfigured: true,
        apolloConfigured: true,
        hunterConfigured: true,
        clearbitConfigured: false,
        aiConfigured: true,
        supabaseConfigured: true,
        growthModelEnabled: true,
        weeklyStrategyEnabled: true,
        warmupEnabled: false,
        budgetInvites: 10,
        budgetMessages: 10,
        invitesSentToday: 0,
        messagesSentToday: 0,
        weeklyInvitesSent: 0,
        weeklyInviteLimit: 100,
        proxyIpReputation: null,
        staleAccounts: [],
        noLoginAccounts: [],
        ...overrides,
    };
}

async function assess(args: { pending: number; total: number; errorsToday?: number; processedToday?: number }) {
    const db = {
        get: vi
            .fn()
            .mockResolvedValueOnce({ total: 0 })
            .mockResolvedValueOnce({ pending: args.pending, total: args.total }),
    };
    mocks.getDatabase.mockResolvedValue(db);
    mocks.getDailyStat.mockResolvedValue(args.errorsToday ?? 0);
    return computeSessionRiskLevel(cfgStatus({ invitesSentToday: args.processedToday ?? 0 }));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalDateString.mockReturnValue('2026-09-05');
    mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'default' }]);
    mocks.getRuntimeFlag.mockResolvedValue(null);
    mocks.setRuntimeFlag.mockResolvedValue(undefined);
    mocks.checkDiskSpace.mockReturnValue({ level: 'ok', freeMb: 2048, message: 'ok' });
});

describe('C5 ③ — pendingFactor col campione condiviso di C1', () => {
    test('1 pending su 1 invitato → pendingFactor 0, livello GO', async () => {
        const result = await assess({ pending: 1, total: 1 });
        expect(result.factors.pendingRatio).toBe(0);
        expect(result.level).toBe('GO');
    });

    test('N-1 pending su N-1 → pendingFactor 0', async () => {
        const result = await assess({ pending: N_PENDING - 1, total: N_PENDING - 1 });
        expect(result.factors.pendingRatio).toBe(0);
    });

    test('N pending su N → pendingFactor 25 (comportamento odierno)', async () => {
        const result = await assess({ pending: N_PENDING, total: N_PENDING });
        expect(result.factors.pendingRatio).toBe(25);
    });

    test('0 pending su 0 invitati → pendingFactor 0 (nessun dato)', async () => {
        const result = await assess({ pending: 0, total: 0 });
        expect(result.factors.pendingRatio).toBe(0);
    });
});

describe('C6 — errorFactor col campione dei tentativi (gemello preflight)', () => {
    test('1 errore su 1 processato → errorFactor 0', async () => {
        const result = await assess({ pending: 0, total: 0, errorsToday: 1, processedToday: 1 });
        expect(result.factors.errorRate).toBe(0);
    });

    test('N errori su N processati → errorFactor 20 (comportamento odierno)', async () => {
        const result = await assess({ pending: 0, total: 0, errorsToday: N_ATTEMPTS, processedToday: N_ATTEMPTS });
        expect(result.factors.errorRate).toBe(20);
    });
});
