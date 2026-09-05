/**
 * Sentinella (review pre-push blocco 4b, goal `bot-operativo`): la sonda di `browser/inviteStateProbe.ts` NON inghiotte
 * gli errori Playwright in silenzio. Un errore DOM → valore neutro (false) come prima, MA con log `invite_probe.dom_error`
 * che dice quale passo è fallito (regola anti-ban 9 «mai silent», L5-LI.4). Senza errore → nessun log (zero rumore).
 * Se il logger stesso fallisce, la sonda resta intatta (il log è fire-and-forget con il proprio catch).
 */
import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../telemetry/logger', () => ({
    logWarn: vi.fn().mockResolvedValue(undefined),
    logInfo: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
}));

import { hasPendingInviteIndicator, hasWeeklyInviteLimitNotice } from '../browser/inviteStateProbe';
import { logWarn } from '../telemetry/logger';

const logWarnMock = vi.mocked(logWarn);
const PAGE_CLOSED = 'Target page, context or browser has been closed';

/** Pagina finta: il locator di primo livello fallisce (o no) sul `count()`. */
function pageWhoseCountFails(): Page {
    return {
        locator: () => ({ count: () => Promise.reject(new Error(PAGE_CLOSED)), nth: () => ({}) }),
    } as unknown as Page;
}

/** Pagina finta: UN contenitore risolto, senza segnali per selettore, con `innerText()` che fallisce. */
function pageWhoseInnerTextFails(): Page {
    const container = {
        locator: () => ({ count: () => Promise.resolve(0) }),
        innerText: () => Promise.reject(new Error(PAGE_CLOSED)),
    };
    return { locator: () => ({ count: () => Promise.resolve(1), nth: () => container }) } as unknown as Page;
}

/** Pagina finta sana: nessun contenitore, nessun errore. */
function pageWithoutContainers(): Page {
    return { locator: () => ({ count: () => Promise.resolve(0), nth: () => ({}) }) } as unknown as Page;
}

describe('inviteStateProbe — errore Playwright loggato, mai silenzioso', () => {
    beforeEach(() => {
        logWarnMock.mockReset();
        logWarnMock.mockResolvedValue(undefined);
    });

    it('count() che fallisce → false E log invite_probe.dom_error con il passo di risoluzione', async () => {
        await expect(hasPendingInviteIndicator(pageWhoseCountFails())).resolves.toBe(false);
        expect(logWarnMock).toHaveBeenCalledTimes(1);
        expect(logWarnMock).toHaveBeenCalledWith('invite_probe.dom_error', {
            step: 'resolve:profileActionsContainer',
            error: PAGE_CLOSED,
        });
    });

    it('innerText() che fallisce → false E log con il passo innerText del contenitore di sistema', async () => {
        await expect(hasWeeklyInviteLimitNotice(pageWhoseInnerTextFails())).resolves.toBe(false);
        expect(logWarnMock).toHaveBeenCalledTimes(1);
        expect(logWarnMock).toHaveBeenCalledWith('invite_probe.dom_error', {
            step: 'innerText:systemNoticeContainer',
            error: PAGE_CLOSED,
        });
    });

    it('nessun errore → nessun log (il contenitore assente non è un errore)', async () => {
        await expect(hasPendingInviteIndicator(pageWithoutContainers())).resolves.toBe(false);
        expect(logWarnMock).not.toHaveBeenCalled();
    });

    it('logger che fallisce → la sonda risponde comunque false senza propagare', async () => {
        logWarnMock.mockRejectedValue(new Error('db down'));
        await expect(hasPendingInviteIndicator(pageWhoseCountFails())).resolves.toBe(false);
        expect(logWarnMock).toHaveBeenCalledTimes(1);
    });
});
