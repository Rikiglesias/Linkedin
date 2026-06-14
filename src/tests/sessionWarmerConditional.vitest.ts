import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Page } from 'playwright';

// Blinda la logica condizionale opt-in di warmupSession (T2b): offHours/highRisk → warmup
// RIDOTTO a feed-only; newAccount → feed garantito; SENZA options → comportamento invariato
// (i call-site jobRunner/salesNavigatorSync non le passano → nessuna regressione).

const { logInfoMock, logWarnMock, isWorkingHourMock } = vi.hoisted(() => ({
    logInfoMock: vi.fn(async () => undefined),
    logWarnMock: vi.fn(async () => undefined),
    isWorkingHourMock: vi.fn(() => true),
}));

vi.mock('../browser', () => ({
    simulateHumanReading: vi.fn(async () => undefined),
    humanType: vi.fn(async () => undefined),
    humanDelay: vi.fn(async () => undefined),
    dismissKnownOverlays: vi.fn(async () => undefined),
}));
vi.mock('../browser/humanBehavior', () => ({ ensureInputBlock: vi.fn(async () => undefined) }));
vi.mock('../telemetry/logger', () => ({ logInfo: logInfoMock, logWarn: logWarnMock }));
vi.mock('../config', () => ({
    config: {
        warmupTwoSessionsPerDay: false,
        timezone: 'Europe/Rome',
        workingHoursStart: 9,
        workingHoursEnd: 18,
        weekendPolicyEnabled: false,
    },
    isWorkingHour: isWorkingHourMock,
}));

import { warmupSession } from '../core/sessionWarmer';

function makePage(): Page {
    return {
        goto: vi.fn(async () => undefined),
        $: vi.fn(async () => null),
        keyboard: { press: vi.fn(async () => undefined) },
        isClosed: () => false,
        waitForTimeout: vi.fn(async () => undefined),
        url: () => 'https://www.linkedin.com/feed/',
    } as unknown as Page;
}

const FEED_URL = 'https://www.linkedin.com/feed/';

describe('warmupSession — gating condizionale opt-in (T2b)', () => {
    beforeEach(() => {
        logInfoMock.mockClear();
        logWarnMock.mockClear();
        isWorkingHourMock.mockReset();
        isWorkingHourMock.mockReturnValue(true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('offHours (respectWorkingHours + fuori orario) → warmup ridotto feed-only', async () => {
        isWorkingHourMock.mockReturnValue(false);
        const page = makePage();
        await warmupSession(page, null, { respectWorkingHours: true });
        expect(logInfoMock).toHaveBeenCalledWith(
            'session_warmer.reduced_conditional',
            expect.objectContaining({ reason: 'off_working_hours' }),
        );
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith(FEED_URL, expect.anything());
        expect(logInfoMock).not.toHaveBeenCalledWith('session_warmer.notifications_check');
    });

    test('riskLevel STOP (in orario) → warmup ridotto (reason elevated_risk)', async () => {
        isWorkingHourMock.mockReturnValue(true);
        const page = makePage();
        await warmupSession(page, null, { riskLevel: 'STOP', respectWorkingHours: true });
        expect(logInfoMock).toHaveBeenCalledWith(
            'session_warmer.reduced_conditional',
            expect.objectContaining({ reason: 'elevated_risk' }),
        );
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    test('riskLevel GO in orario → NON ramo ridotto (warmup completo parte)', async () => {
        isWorkingHourMock.mockReturnValue(true);
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // minimizza gli step random (no flakiness)
        const page = makePage();
        await warmupSession(page, null, { riskLevel: 'GO', respectWorkingHours: true });
        expect(logInfoMock).toHaveBeenCalledWith('session_warmer.start', expect.anything());
        expect(logInfoMock).not.toHaveBeenCalledWith('session_warmer.reduced_conditional', expect.anything());
    });

    test('senza options → comportamento invariato (nessun ramo ridotto, anche fuori orario)', async () => {
        isWorkingHourMock.mockReturnValue(false); // fuori orario MA respectWorkingHours non passato
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const page = makePage();
        await warmupSession(page, null);
        expect(logInfoMock).toHaveBeenCalledWith('session_warmer.start', expect.anything());
        expect(logInfoMock).not.toHaveBeenCalledWith('session_warmer.reduced_conditional', expect.anything());
    });

    test('newAccount (<7gg) in orario → feed step garantito anche con Math.random alto', async () => {
        isWorkingHourMock.mockReturnValue(true);
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // senza newAccount il feed (0.9) verrebbe skippato
        const page = makePage();
        await warmupSession(page, null, { accountAgeDays: 3, respectWorkingHours: true });
        expect(page.goto).toHaveBeenCalledWith(FEED_URL, expect.anything());
    });
});
