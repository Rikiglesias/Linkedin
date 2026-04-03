import { beforeEach, describe, expect, test, vi } from 'vitest';

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

describe('preflight riskAssessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLocalDateString.mockReturnValue('2026-04-01');
        mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'acc-1' }]);
        mocks.setRuntimeFlag.mockResolvedValue(undefined);
    });

    test('calcola livello GO e persiste la history quando il rischio è basso', async () => {
        const db = {
            get: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ pending: 0, total: 0 }),
        };
        mocks.getDatabase.mockResolvedValue(db);
        mocks.getDailyStat.mockResolvedValue(0);
        mocks.getRuntimeFlag.mockResolvedValue(null);
        mocks.checkDiskSpace.mockReturnValue({ level: 'ok', freeMb: 2048, message: 'ok' });

        const result = await computeSessionRiskLevel({
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
        });

        expect(result).toEqual({
            level: 'GO',
            score: 0,
            factors: {
                challenges: 0,
                pendingRatio: 0,
                errorRate: 0,
                proxyReputation: 0,
                runFrequency: 0,
                diskSpace: 0,
            },
            recommendation: 'Rischio basso — procedere normalmente',
        });
        expect(mocks.setRuntimeFlag).toHaveBeenCalledWith(
            'risk_score_history',
            JSON.stringify([{ date: '2026-04-01', score: 0 }]),
        );
    });

    test('calcola livello STOP con fattori alti e aggiorna la history esistente', async () => {
        const db = {
            get: vi.fn().mockResolvedValueOnce({ total: 3 }).mockResolvedValueOnce({ pending: 10, total: 10 }),
        };
        mocks.getDatabase.mockResolvedValue(db);
        mocks.getDailyStat.mockResolvedValue(4);
        mocks.getRuntimeFlag.mockResolvedValueOnce(new Date(Date.now() - 30 * 60 * 1000).toISOString()).mockResolvedValueOnce(
            JSON.stringify([{ date: '2026-03-31', score: 22 }]),
        );
        mocks.checkDiskSpace.mockReturnValue({ level: 'critical', freeMb: 80, message: 'disk critical' });

        const result = await computeSessionRiskLevel({
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
            invitesSentToday: 2,
            messagesSentToday: 2,
            weeklyInvitesSent: 0,
            weeklyInviteLimit: 100,
            proxyIpReputation: {
                ip: '1.2.3.4',
                abuseScore: 77,
                isSafe: false,
                isp: 'Example ISP',
                country: 'IT',
            },
            staleAccounts: [],
            noLoginAccounts: [],
        });

        expect(result.level).toBe('STOP');
        expect(result.score).toBe(100);
        expect(result.factors).toEqual({
            challenges: 30,
            pendingRatio: 25,
            errorRate: 20,
            proxyReputation: 11,
            runFrequency: 10,
            diskSpace: 15,
        });
        expect(result.recommendation).toContain('NON procedere');
        expect(mocks.setRuntimeFlag).toHaveBeenCalledWith(
            'risk_score_history',
            JSON.stringify([
                { date: '2026-03-31', score: 22 },
                { date: '2026-04-01', score: 100 },
            ]),
        );
    });
});
