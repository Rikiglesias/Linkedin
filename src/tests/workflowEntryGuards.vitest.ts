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
    getAccountQuarantine: vi.fn(),
    getRuntimeFlag: vi.fn(),
    setRuntimeFlag: vi.fn(),
    acquireRuntimeLock: vi.fn(),
    releaseRuntimeLock: vi.fn(),
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
        proxyMobilePriorityEnabled: true,
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
    getAccountQuarantine: mocks.getAccountQuarantine,
    getRuntimeFlag: mocks.getRuntimeFlag,
    setRuntimeFlag: mocks.setRuntimeFlag,
    acquireRuntimeLock: mocks.acquireRuntimeLock,
    releaseRuntimeLock: mocks.releaseRuntimeLock,
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
        mocks.getAccountQuarantine.mockResolvedValue(false);
        mocks.getRuntimeFlag.mockResolvedValue(null);
        mocks.setRuntimeFlag.mockResolvedValue(undefined);
        mocks.acquireRuntimeLock.mockResolvedValue({ acquired: true, lock: { owner_id: 'self' } });
        mocks.releaseRuntimeLock.mockResolvedValue(true);
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
        mocks.getAccountQuarantine.mockResolvedValue(true);

        const result = await evaluateWorkflowEntryGuards({ workflow: 'message', dryRun: false });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('ACCOUNT_QUARANTINED');
        expect(result.blocked?.details).toEqual({ workflow: 'message', accountId: 'acc-1' });
        // G5-F2: il guard interroga la quarantena dell'account OPERATIVO, non un flag globale.
        expect(mocks.getAccountQuarantine).toHaveBeenCalledWith('acc-1');
        expect(mocks.launchBrowser).not.toHaveBeenCalled();
    });

    test('G5-F2: quarantena su un ALTRO account non blocca il workflow di questo', async () => {
        mocks.getRuntimeAccountProfiles.mockReturnValue([
            { id: 'acc-1', sessionDir: 'session-1', proxy: null },
            { id: 'acc-2', sessionDir: 'session-2', proxy: null },
        ]);
        // Solo acc-1 è quarantinato; il workflow gira su acc-2.
        mocks.getAccountQuarantine.mockImplementation(async (accountId: string) => accountId === 'acc-1');

        const result = await evaluateWorkflowEntryGuards({ workflow: 'sync-list', dryRun: false, accountId: 'acc-2' });

        expect(mocks.getAccountQuarantine).toHaveBeenCalledWith('acc-2');
        // Non deve essere bloccato per quarantena (procede oltre quel guard).
        expect(result.blocked?.reason).not.toBe('ACCOUNT_QUARANTINED');
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

    test('blocca con LOGIN_REQUIRED (non SELECTOR_CANARY_FAILED) quando la sessione è sloggata', async () => {
        // Regressione: una sessione sloggata (li_at assente → checkLogin=false) veniva quarantinata
        // ed etichettata SELECTOR_CANARY_FAILED, mandando la diagnosi a caccia di selettori inesistenti.
        mocks.checkLogin.mockResolvedValue(false);

        const result = await evaluateWorkflowEntryGuards({ workflow: 'sync-list', dryRun: false });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('LOGIN_REQUIRED');
        // G5-F2: LOGIN_REQUIRED è account-specific → la quarantena è attribuita all'account del canary.
        expect(mocks.quarantineAccount).toHaveBeenCalledWith('LOGIN_REQUIRED', {
            workflow: 'sync-list',
            accountId: 'acc-1',
        });
        // Il selector canary non deve nemmeno essere valutato se non siamo loggati.
        expect(mocks.runSelectorCanaryDetailed).not.toHaveBeenCalled();
    });

    test('salta la sessione quando la varianza giornaliera è zero', async () => {
        mocks.getSessionVarianceFactor.mockReturnValue(0);

        const result = await evaluateWorkflowEntryGuards({ workflow: 'invite', dryRun: false, accountId: 'acc-1' });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('SESSION_VARIANCE_SKIP_DAY');
        expect(mocks.getAutomationPauseState).not.toHaveBeenCalled();
    });

    test('handoff (G1): reuseSession ritorna la sessione del canary e NON la chiude', async () => {
        // Regressione G1 (doppio-lancio): con reuseSession il canary passa la sua sessione al workflow
        // invece di chiuderla → il workflow riusa quel browser e NON ne apre un 2° sullo stesso profilo
        // persistente (era il lock conflict → timeout 180s al 1° run di ogni finestra 4h).
        const session = createSession();
        mocks.launchBrowser.mockResolvedValue(session);

        const result = await evaluateWorkflowEntryGuards({
            workflow: 'sync-list',
            dryRun: false,
            accountId: 'acc-1',
            reuseSession: true,
        });

        expect(result.allowed).toBe(true);
        expect(result.session).toBe(session); // sessione passata al caller per il riuso
        expect(mocks.closeBrowser).not.toHaveBeenCalled(); // NON chiusa: la chiude il caller (syncListService)
    });

    test('senza reuseSession il canary chiude la sessione e non la ritorna (comportamento invariato)', async () => {
        // Anti-regressione per gli altri 4 workflow: default reuseSession=false → comportamento di prima.
        const result = await evaluateWorkflowEntryGuards({
            workflow: 'sync-list',
            dryRun: false,
            accountId: 'acc-1',
        });

        expect(result.allowed).toBe(true);
        expect(result.session).toBeUndefined();
        expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
    });

    test('reuseSession ma login fallito: blocca e chiude la sessione (nessun handoff di sessione sloggata)', async () => {
        mocks.checkLogin.mockResolvedValue(false);

        const result = await evaluateWorkflowEntryGuards({
            workflow: 'sync-list',
            dryRun: false,
            accountId: 'acc-1',
            reuseSession: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('LOGIN_REQUIRED');
        expect(result.session).toBeUndefined();
        expect(mocks.closeBrowser).toHaveBeenCalledTimes(1); // chiusa, non passata
    });

    test('AB11: handoff jobRunner-bound (invite) single-account ritorna session + sessionAccountId e lancia con proxy mobile', async () => {
        // AB11: estende l'handoff a invite/message/check/all. Con un solo account e senza accountId
        // esplicito, il canary riusa la sessione dell'unico account e la passa al jobRunner (initialSession).
        const session = createSession();
        mocks.launchBrowser.mockResolvedValue(session);

        const result = await evaluateWorkflowEntryGuards({
            workflow: 'invite',
            dryRun: false,
            reuseSession: true,
        });

        expect(result.allowed).toBe(true);
        expect(result.session).toBe(session);
        expect(result.sessionAccountId).toBe('acc-1');
        expect(mocks.closeBrowser).not.toHaveBeenCalled();
        // La sessione riusata nasce con le STESSE opzioni proxy del jobRunner (mobile-priority):
        // niente mismatch silenzioso del tipo di proxy tra canary e outreach.
        expect(mocks.launchBrowser).toHaveBeenCalledWith(
            expect.objectContaining({ preferredProxyType: 'mobile' }),
        );
    });

    test('AB11: multi-account NON fa handoff (canary verifica tutti gli account, nessuna sessione ritornata)', async () => {
        // Con >1 account il loop canary farebbe `return` al primo handoff e salterebbe le verifiche
        // degli account successivi: per sicurezza l'handoff è disattivato → comportamento invariato.
        mocks.getRuntimeAccountProfiles.mockReturnValue([
            { id: 'acc-1', sessionDir: 'session-1', proxy: null },
            { id: 'acc-2', sessionDir: 'session-2', proxy: null },
        ]);

        const result = await evaluateWorkflowEntryGuards({
            workflow: 'invite',
            dryRun: false,
            reuseSession: true,
        });

        expect(result.allowed).toBe(true);
        expect(result.session).toBeUndefined();
        expect(result.sessionAccountId).toBeUndefined();
        // Entrambi gli account verificati e chiusi (nessun handoff).
        expect(mocks.launchBrowser).toHaveBeenCalledTimes(2);
        expect(mocks.closeBrowser).toHaveBeenCalledTimes(2);
        const firstLaunchArgs = mocks.launchBrowser.mock.calls[0][0];
        expect(firstLaunchArgs).not.toHaveProperty('preferredProxyType');
    });

    test('AB11: sync-list con reuseSession NON usa preferredProxyType (coerenza con salesNavigatorSync)', async () => {
        // sync-list riusa la sessione via salesNavigatorSync, che lancia SENZA preferredProxyType:
        // la sessione handoff deve ereditare le opzioni del suo consumer, non quelle del jobRunner.
        const session = createSession();
        mocks.launchBrowser.mockResolvedValue(session);

        const result = await evaluateWorkflowEntryGuards({
            workflow: 'sync-list',
            dryRun: false,
            accountId: 'acc-1',
            reuseSession: true,
        });

        expect(result.allowed).toBe(true);
        expect(result.session).toBe(session);
        const launchArgs = mocks.launchBrowser.mock.calls[0][0];
        expect(launchArgs).not.toHaveProperty('preferredProxyType');
    });

    test('blocca un sync concorrente sullo stesso account quando il lock per-account non è acquisibile (F1)', async () => {
        mocks.acquireRuntimeLock.mockResolvedValue({ acquired: false, lock: { owner_id: 'other-run' } });

        const result = await evaluateWorkflowEntryGuards({ workflow: 'sync-list', dryRun: false, accountId: 'acc-1' });

        expect(result.allowed).toBe(false);
        expect(result.blocked?.reason).toBe('SYNC_CONCURRENT_ON_ACCOUNT');
        expect(mocks.launchBrowser).not.toHaveBeenCalled(); // il canary non parte → niente 2° browser
    });

    test('acquisisce il lock per-account e lo espone per il release del caller (F1)', async () => {
        const result = await evaluateWorkflowEntryGuards({ workflow: 'sync-list', dryRun: false, accountId: 'acc-1' });

        expect(result.allowed).toBe(true);
        expect(mocks.acquireRuntimeLock).toHaveBeenCalledWith(
            'sync.account:acc-1',
            expect.any(String),
            expect.any(Number),
            expect.objectContaining({ workflow: 'sync-list', accountId: 'acc-1' }),
        );
        expect(result.accountLock).toMatchObject({ lockKey: 'sync.account:acc-1' });
    });
});
