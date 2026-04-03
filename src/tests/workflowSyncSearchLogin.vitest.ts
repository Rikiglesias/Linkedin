import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAccountProfileById: vi.fn(),
    awaitManualLogin: vi.fn(),
    blockUserInput: vi.fn(),
    closeBrowser: vi.fn(),
    launchBrowser: vi.fn(),
    checkLogin: vi.fn(),
    cleanupWindowClickThrough: vi.fn(),
    disableWindowClickThrough: vi.fn(),
    enableWindowClickThrough: vi.fn(),
    runSalesNavBulkSave: vi.fn(),
    runSalesNavigatorListSync: vi.fn(),
    evaluateWorkflowEntryGuards: vi.fn(),
    runPreflight: vi.fn(),
}));

vi.mock('../config', () => ({
    config: {
        salesNavSyncListName: 'Default',
        salesNavSyncMaxPages: 5,
        salesNavSyncLimit: 100,
        salesNavSyncAccountId: 'acc-1',
        headless: true,
    },
    isWorkingHour: vi.fn(),
}));

vi.mock('../accountManager', () => ({
    getAccountProfileById: mocks.getAccountProfileById,
}));

vi.mock('../browser/humanBehavior', () => ({
    awaitManualLogin: mocks.awaitManualLogin,
    blockUserInput: mocks.blockUserInput,
}));

vi.mock('../browser', () => ({
    closeBrowser: mocks.closeBrowser,
    launchBrowser: mocks.launchBrowser,
    checkLogin: mocks.checkLogin,
}));

vi.mock('../browser/windowInputBlock', () => ({
    cleanupWindowClickThrough: mocks.cleanupWindowClickThrough,
    disableWindowClickThrough: mocks.disableWindowClickThrough,
    enableWindowClickThrough: mocks.enableWindowClickThrough,
}));

vi.mock('../salesnav/bulkSaveOrchestrator', () => ({
    runSalesNavBulkSave: mocks.runSalesNavBulkSave,
}));

vi.mock('../core/salesNavigatorSync', () => ({
    runSalesNavigatorListSync: mocks.runSalesNavigatorListSync,
}));

vi.mock('../core/workflowEntryGuards', () => ({
    evaluateWorkflowEntryGuards: mocks.evaluateWorkflowEntryGuards,
}));

vi.mock('../workflows/preflight', () => ({
    runPreflight: mocks.runPreflight,
}));

import { executeSyncSearchWorkflow } from '../workflows/services/syncSearchService';

function buildPreflight() {
    return {
        answers: {
            searchName: 'search-a',
            listName: 'lista-a',
            maxPages: 3,
            limit: 50,
            enrichment: true,
            _accountId: 'acc-1',
        },
        rawAnswers: {},
        dbStats: {
            totalLeads: 0,
            byStatus: {},
            byList: {},
            withEmail: 0,
            withoutEmail: 0,
            withScore: 0,
            withJobTitle: 0,
            withPhone: 0,
            withLocation: 0,
            lastSyncAt: null,
            trend: null,
        },
        configStatus: {
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
        },
        warnings: [],
        confirmed: true,
        riskAssessment: {
            level: 'GO',
            score: 5,
            factors: {},
            recommendation: 'ok',
        },
        selectedAccountId: 'acc-1',
    };
}

describe('sync-search service login path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runPreflight.mockResolvedValue(buildPreflight());
        mocks.getAccountProfileById.mockReturnValue({
            id: 'acc-1',
            sessionDir: 'session-1',
            proxy: null,
        });
        mocks.evaluateWorkflowEntryGuards.mockResolvedValue({ allowed: true, blocked: null });
        mocks.launchBrowser.mockResolvedValue({
            page: {},
            browser: {},
        });
        mocks.closeBrowser.mockResolvedValue(undefined);
        mocks.checkLogin.mockResolvedValue(false);
        mocks.awaitManualLogin.mockResolvedValue(false);
    });

    test('ritorna LOGIN_REQUIRED se il login non viene completato', async () => {
        const result = await executeSyncSearchWorkflow({
            listName: 'lista-a',
            skipPreflight: true,
            dryRun: false,
        });

        expect(result).toEqual({
            workflow: 'sync-search',
            success: false,
            blocked: {
                reason: 'LOGIN_REQUIRED',
                message: 'Login LinkedIn non completato',
            },
            summary: {},
            errors: [],
            nextAction: 'Login LinkedIn non completato',
            riskAssessment: {
                level: 'GO',
                score: 5,
                factors: {},
                recommendation: 'ok',
            },
            artifacts: {
                preflight: buildPreflight(),
                estimatedMinutes: 3,
            },
        });
        expect(mocks.launchBrowser).toHaveBeenCalledTimes(1);
        expect(mocks.awaitManualLogin).toHaveBeenCalledTimes(1);
        expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
        expect(mocks.runSalesNavBulkSave).not.toHaveBeenCalled();
    });
});
