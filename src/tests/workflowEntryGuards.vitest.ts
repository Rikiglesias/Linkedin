import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    launchBrowser: vi.fn(),
    closeBrowser: vi.fn(),
    checkLogin: vi.fn(),
    runSelectorCanaryDetailed: vi.fn(),
    getRuntimeAccountProfiles: vi.fn(),
    getLocalDateString: vi.fn(),
    isWorkingHour: vi.fn(),
    checkDiskSpace: vi.fn(),
    quarantineAccount: vi.fn(),
    pauseAutomation: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    pushOutboxEvent: vi.fn(),
    getAutomationPauseState: vi.fn(),
    getDailyStat: vi.fn(),
    getRuntimeFlag: vi.fn(),
    setRuntimeFlag: vi.fn(),
    getSessionVarianceFactor: vi.fn(),
    runPreventiveGuards: vi.fn(),
}));

vi.mock('../browser', () => ({
    launchBrowser: mocks.launchBrowser,
    closeBrowser: mocks.closeBrowser,
    checkLogin: mocks.checkLogin,
    runSelectorCanaryDetailed: mocks.runSelectorCanaryDetailed,
}));

vi.mock('../accountManager', () => ({
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../config', () => ({
    config: {
        selectorCanaryEnabled: true,
        maxSelectorFailuresPerDay: 5,
        maxRunErrorsPerDay: 5,
        autoPauseMinutesOnFailureBurst: 60,
        workingHoursStart: 8,
        workingHoursEnd: 20,
    },
    getLocalDateString: mocks.getLocalDateString,
    isWorkingHour: mocks.isWorkingHour,
}));

vi.mock('../db', () => ({
    checkDiskSpace: mocks.checkDiskSpace,
}));

vi.mock('../risk/incidentManager', () => ({
    quarantineAccount: mocks.quarantineAccount,
    pauseAutomation: mocks.pauseAutomation,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: mocks.logInfo,
    logWarn: mocks.logWarn,
}));

vi.mock('../core/repositories', () => ({
    pushOutboxEvent: mocks.pushOutboxEvent,
    getAutomationPauseState: mocks.getAutomationPauseState,
    getDailyStat: mocks.getDailyStat,
    getRuntimeFlag: mocks.getRuntimeFlag,
    setRuntimeFlag: mocks.setRuntimeFlag,
}));

vi.mock('../core/preventiveGuards', () => ({
    getSessionVarianceFactor: mocks.getSessionVarianceFactor,
    runPreventiveGuards: mocks.runPreventiveGuards,
}));

import { evaluateWorkflowEntryGuards } from '../core/workflowEntryGuards';

function createSession() {
    return {
        page: {
            textContent: vi.fn().mockResolvedValue(''),
            url: vi.fn().mockReturnValue('https://www.linkedin.com/feed'),
        },
    };
}

describe('workflowEntryGuards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.launchBrowser.mockResolvedValue(createSession());
        mocks.closeBrowser.mockResolvedValue(undefined);
        mocks.checkLogin.mockResolvedValue(true);
        mocks.runSelectorCanaryDetailed.mockResolvedValue({
            ok: true,
            optionalFailed: 0,
            criticalFailed: 0,
            steps: [],
        });
        mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'acc-1', sessionDir: 'session-1', proxy: null }]);
        mocks.getLocalDateString.mockReturnValue('2026-04-01');
        mocks.isWorkingHour.mockReturnValue(true);
        mocks.checkDiskSpace.mockReturnValue({ level: 'ok', freeMb: 1024, message: 'ok' });
        mocks.pushOutboxEvent.mockResolvedValue(undefined);
        mocks.getAutomationPauseState.mockResolvedValue({
            paused: false,
            reason: null,
            pausedUntil: null,
            remainingSeconds: 0,
        });
        mocks.getDailyStat.mockResolvedValue(0);
        mocks.getRuntimeFlag.mockResolvedValue(null);
        mocks.setRuntimeFlag.mockResolvedValue(undefined);
        mocks.getSessionVarianceFactor.mockReturnValue(1);
        mocks.runPreventiveGuards.mockResolvedValue(undefined);
    });

    test('blocca il workflow quando l automazione è in pausa', async () => {
        mocks.getAutomationPauseState.mockResolvedValue({
            paused: true,
            reason: 'manual pause',
            pausedUntil: '2026-04-01T12:00:00Z',
            remainingSeconds: 300,
        });

        const result = await evaluateWorkflowEntryGuards({ workflow: 'invite', dryRun: false });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('AUTOMATION_PAUSED');
        expect(result.blocked?.details).toEqual({
            workflow: 'invite',
            pausedUntil: '2026-04-01T12:00:00Z',
            remainingSeconds: 300,
        });
    });

    test('blocca il workflow quando l account è in quarantena', async () => {
        mocks.getRuntimeFlag.mockImplementation(async (key: string) => (key === 'account_quarantine' ? 'true' : null));

        const result = await evaluateWorkflowEntryGuards({ workflow: 'message', dryRun: false });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('ACCOUNT_QUARANTINED');
        expect(mocks.launchBrowser).not.toHaveBeenCalled();
    });

    test('blocca il workflow quando il selector canary fallisce', async () => {
        mocks.runSelectorCanaryDetailed.mockResolvedValue({
            ok: false,
            optionalFailed: 0,
            criticalFailed: 2,
            steps: [{ required: true, ok: false }],
        });

        const result = await evaluateWorkflowEntryGuards({ workflow: 'sync-search', dryRun: false });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('SELECTOR_CANARY_FAILED');
        expect(mocks.quarantineAccount).toHaveBeenCalledWith('SELECTOR_CANARY_FAILED', {
            workflow: 'sync-search',
        });
    });

    test('salta la sessione quando la varianza giornaliera è zero', async () => {
        mocks.getSessionVarianceFactor.mockReturnValue(0);

        const result = await evaluateWorkflowEntryGuards({ workflow: 'invite', dryRun: false, accountId: 'acc-1' });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('SESSION_VARIANCE_SKIP_DAY');
        expect(mocks.getAutomationPauseState).not.toHaveBeenCalled();
    });
});
