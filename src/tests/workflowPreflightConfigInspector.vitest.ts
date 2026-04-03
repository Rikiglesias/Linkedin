import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        ipReputationApiKey: '',
        proxyUrl: '',
        apolloApiKey: 'apollo',
        hunterApiKey: 'hunter',
        clearbitApiKey: '',
        openaiApiKey: 'openai',
        ollamaEndpoint: '',
        supabaseUrl: 'https://supabase.local',
        supabaseServiceRoleKey: 'service-role',
        growthModelEnabled: true,
        weeklyStrategyEnabled: true,
        warmupEnabled: false,
        hardInviteCap: 20,
        hardMsgCap: 15,
        weeklyInviteLimit: 100,
        sessionCookieMaxAgeDays: 14,
    },
    getLocalDateString: vi.fn(),
    getWeekStartDate: vi.fn(),
    countWeeklyInvites: vi.fn(),
    getDailyStat: vi.fn(),
    getRuntimeAccountProfiles: vi.fn(),
    checkSessionFreshness: vi.fn(),
    checkIpReputation: vi.fn(),
}));

vi.mock('../config', () => ({
    config: mocks.config,
    getLocalDateString: mocks.getLocalDateString,
    getWeekStartDate: mocks.getWeekStartDate,
}));

vi.mock('../core/repositories', () => ({
    countWeeklyInvites: mocks.countWeeklyInvites,
    getDailyStat: mocks.getDailyStat,
}));

vi.mock('../accountManager', () => ({
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../browser/sessionCookieMonitor', () => ({
    checkSessionFreshness: mocks.checkSessionFreshness,
}));

vi.mock('../proxy/ipReputationChecker', () => ({
    checkIpReputation: mocks.checkIpReputation,
}));

import { appendProxyReputationWarning, collectConfigStatus } from '../workflows/preflight/configInspector';
import type { PreflightWarning } from '../workflows/types';

describe('preflight configInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config.ipReputationApiKey = '';
        mocks.config.proxyUrl = '';
        mocks.getLocalDateString.mockReturnValue('2026-04-01');
        mocks.getWeekStartDate.mockReturnValue('2026-03-31');
        mocks.getDailyStat.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
        mocks.countWeeklyInvites.mockResolvedValue(11);
        mocks.getRuntimeAccountProfiles.mockReturnValue([
            { id: 'acc-a', sessionDir: 'session-a' },
            { id: 'acc-b', sessionDir: 'session-b' },
        ]);
        mocks.checkSessionFreshness
            .mockReturnValueOnce({ lastVerifiedAt: null, needsRotation: false, sessionAgeDays: 0 })
            .mockReturnValueOnce({ lastVerifiedAt: '2026-03-20T09:00:00Z', needsRotation: true, sessionAgeDays: 12 });
        mocks.checkIpReputation.mockResolvedValue(null);
    });

    test('raccoglie stato config, budget e freshness account', async () => {
        const result = await collectConfigStatus();

        expect(result).toEqual({
            proxyConfigured: false,
            apolloConfigured: true,
            hunterConfigured: true,
            clearbitConfigured: false,
            aiConfigured: true,
            supabaseConfigured: true,
            growthModelEnabled: true,
            weeklyStrategyEnabled: true,
            warmupEnabled: false,
            budgetInvites: 20,
            budgetMessages: 15,
            invitesSentToday: 3,
            messagesSentToday: 4,
            weeklyInvitesSent: 11,
            weeklyInviteLimit: 100,
            proxyIpReputation: null,
            staleAccounts: ['acc-b (12d)'],
            noLoginAccounts: ['acc-a'],
        });
    });

    test('include la reputazione proxy quando il check è configurato', async () => {
        mocks.config.ipReputationApiKey = 'rep-key';
        mocks.config.proxyUrl = 'http://proxy.local';
        mocks.checkIpReputation.mockResolvedValue({
            ip: '1.2.3.4',
            abuseConfidenceScore: 77,
            isSafe: false,
            isp: 'Example ISP',
            countryCode: 'IT',
        });

        const result = await collectConfigStatus();

        expect(result.proxyConfigured).toBe(true);
        expect(result.proxyIpReputation).toEqual({
            ip: '1.2.3.4',
            abuseScore: 77,
            isSafe: false,
            isp: 'Example ISP',
            country: 'IT',
        });
    });

    test('appendProxyReputationWarning produce warning critici e warn coerenti', () => {
        const warnings: PreflightWarning[] = [];

        appendProxyReputationWarning(warnings, {
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
            proxyIpReputation: {
                ip: '1.2.3.4',
                abuseScore: 80,
                isSafe: false,
                isp: 'Example ISP',
                country: 'IT',
            },
            staleAccounts: ['acc-b (12d)'],
            noLoginAccounts: ['acc-a'],
        });

        expect(warnings).toHaveLength(3);
        expect(warnings[0]?.level).toBe('critical');
        expect(warnings[1]?.level).toBe('warn');
        expect(warnings[2]?.level).toBe('critical');
    });
});
