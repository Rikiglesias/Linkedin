/**
 * sessioneThrottledNonAvviaLavoro.vitest.ts — il comportamento dei chiamanti spostati sulla
 * politica unica (seconda metà di C27, insieme a `checkLoginBooleanoNonGovernaIlLavoro`).
 *
 * La sentinella AST prova che nessuno usa più il booleano per decidere; questi test provano che
 * la decisione presa al suo posto è quella giusta: sotto `throttled` il lavoro NON parte, e il
 * contesto passato alla politica contiene la cartella di sessione e il proxy — senza quei due
 * campi la pausa non saprebbe quale sticky proxy rilasciare e il 429 resterebbe senza reazione.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAccountProfileById: vi.fn(),
    valutaSessionePrimaDelLavoro: vi.fn(),
    launchBrowser: vi.fn(),
    closeBrowser: vi.fn(),
    clickLocatorHumanLike: vi.fn(),
    humanDelay: vi.fn(),
    dismissKnownOverlays: vi.fn(),
    randomMouseMove: vi.fn(),
    simulateHumanReading: vi.fn(),
    blockUserInput: vi.fn(),
    pauseInputBlock: vi.fn(),
    resumeInputBlock: vi.fn(),
    enableWindowClickThrough: vi.fn(),
    disableWindowClickThrough: vi.fn(),
    navigateToSavedLists: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
}));

vi.mock('../accountManager', () => ({ getAccountProfileById: mocks.getAccountProfileById }));

vi.mock('../risk/loginFailureHandler', () => ({
    valutaSessionePrimaDelLavoro: mocks.valutaSessionePrimaDelLavoro,
}));

vi.mock('../browser', () => ({
    launchBrowser: mocks.launchBrowser,
    closeBrowser: mocks.closeBrowser,
    clickLocatorHumanLike: mocks.clickLocatorHumanLike,
    humanDelay: mocks.humanDelay,
    dismissKnownOverlays: mocks.dismissKnownOverlays,
    randomMouseMove: mocks.randomMouseMove,
    simulateHumanReading: mocks.simulateHumanReading,
}));

vi.mock('../browser/humanBehavior', () => ({
    blockUserInput: mocks.blockUserInput,
    pauseInputBlock: mocks.pauseInputBlock,
    resumeInputBlock: mocks.resumeInputBlock,
}));

vi.mock('../browser/windowInputBlock', () => ({
    enableWindowClickThrough: mocks.enableWindowClickThrough,
    disableWindowClickThrough: mocks.disableWindowClickThrough,
}));

vi.mock('../salesnav/listScraper', () => ({ navigateToSavedLists: mocks.navigateToSavedLists }));

vi.mock('../telemetry/logger', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn }));

import { createSalesNavList } from '../salesnav/listActions';
import { runRandomLinkedinActivity } from '../workers/randomActivityWorker';

const PROXY = { server: 'http://proxy.esempio:8000', username: 'u', password: 'p' };

/** Pagina finta: ogni uso segna una traccia, così «il lavoro non è partito» è verificabile. */
function paginaFinta(tracce: string[]) {
    return {
        goto: vi.fn(async (url: string) => {
            tracce.push(`goto:${url}`);
            return null;
        }),
        url: () => 'https://www.linkedin.com/feed/',
        context: () => ({}),
        locator: vi.fn(() => {
            tracce.push('locator');
            return { first: () => ({ count: async () => 1, fill: async () => undefined }) };
        }),
        waitForTimeout: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccountProfileById.mockReturnValue({
        id: 'acc-1',
        sessionDir: 'data/session',
        proxy: PROXY,
    });
});

describe('C27 — sotto throttling il lavoro non parte', () => {
    it('createSalesNavList: 429 → nessuna navigazione, nessun click, messaggio che dice di NON rifare il login', async () => {
        const tracce: string[] = [];
        const page = paginaFinta(tracce);
        mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'throttled', status: 429 });

        const esito = await createSalesNavList('Lista X', 'acc-1', page as never);

        expect(esito.ok).toBe(false);
        expect(tracce).toEqual([]);
        expect(mocks.clickLocatorHumanLike).not.toHaveBeenCalled();
        expect(mocks.enableWindowClickThrough).not.toHaveBeenCalled();
        expect(esito.message).toContain('429');
        expect(esito.message.toLowerCase()).toContain('non rifare il login');
    });

    it('createSalesNavList: il contesto passato alla politica porta sessionDir e proxy (senza, il 429 resta senza reazione)', async () => {
        mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'throttled', status: 429 });
        await createSalesNavList('Lista X', 'acc-1', paginaFinta([]) as never);

        expect(mocks.valutaSessionePrimaDelLavoro).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                accountId: 'acc-1',
                sessionDir: 'data/session',
                proxy: PROXY,
                source: 'salesnav.create_list',
            }),
        );
    });

    it('createSalesNavList: sessione attiva → il lavoro parte davvero (il test sopra non passa a vuoto)', async () => {
        const tracce: string[] = [];
        const page = paginaFinta(tracce);
        mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'logged-in' });
        mocks.navigateToSavedLists.mockResolvedValue([]);

        await createSalesNavList('Lista X', 'acc-1', page as never);

        expect(tracce.some((t) => t.startsWith('goto:https://www.linkedin.com/sales/lists'))).toBe(true);
        expect(mocks.enableWindowClickThrough).toHaveBeenCalled();
    });

    it('randomActivityWorker: 429 → zero attività eseguite e warn con lo stato reale, non «not_logged_in»', async () => {
        const tracce: string[] = [];
        const page = paginaFinta(tracce);
        mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'throttled', status: 429 });
        mocks.launchBrowser.mockResolvedValue({ page, browser: {}, context: {} });

        const report = await runRandomLinkedinActivity({ accountId: 'acc-1', maxActions: 3, dryRun: false });

        expect(report.actionsExecuted).toBe(0);
        expect(tracce).toEqual([]);
        const eventi = mocks.logWarn.mock.calls.map((c) => c[0]);
        expect(eventi).toContain('random_activity.sessione_non_utilizzabile');
        expect(eventi).not.toContain('random_activity.not_logged_in');
        expect(mocks.logWarn.mock.calls[0][1]).toMatchObject({ stato: 'throttled' });
    });

    it('randomActivityWorker: logout esplicito → si ferma comunque, ma con lo stato giusto', async () => {
        const page = paginaFinta([]);
        mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'logged-out' });
        mocks.launchBrowser.mockResolvedValue({ page, browser: {}, context: {} });

        const report = await runRandomLinkedinActivity({ accountId: 'acc-1', maxActions: 2, dryRun: false });

        expect(report.actionsExecuted).toBe(0);
        expect(mocks.logWarn.mock.calls[0][1]).toMatchObject({ stato: 'logged-out' });
    });
});
