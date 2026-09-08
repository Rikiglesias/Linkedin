/**
 * listActionsClickThrough.vitest.ts — finding M7 della review di C29.
 *
 * `createSalesNavList` e `addLeadToSalesNavList` accendono sempre il click-through della finestra
 * (`WS_EX_TRANSPARENT`: il mouse fisico dell'utente passa SOTTO la finestra del bot), ma lo
 * ripristinavano solo dentro `if (ownSession)`. Con una pagina esterna qualsiasi throw usciva
 * lasciando la finestra bot-only: l'utente si ritrovava un browser su cui non poteva piu' cliccare.
 *
 * Il fail-closed di C29 ha aggiunto una via di throw proprio li' (`pauseInputBlock` prima della
 * `fill`), dove prima non se ne poteva alzare nessuna: un difetto latente reso raggiungibile.
 *
 * Lo stato non si SPEGNE, si RIPRISTINA: se il chiamante l'aveva gia' acceso, spegnerlo qui
 * lascerebbe il mouse dell'utente libero di interferire con il bot (anti-ban).
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
    isWindowClickThroughActive: vi.fn(),
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
    isWindowClickThroughActive: mocks.isWindowClickThroughActive,
}));
vi.mock('../salesnav/listScraper', () => ({ navigateToSavedLists: mocks.navigateToSavedLists }));
vi.mock('../telemetry/logger', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn }));

import { createSalesNavList } from '../salesnav/listActions';

const CONTESTO = { id: 'contesto-della-pagina-esterna' };

function paginaEsterna() {
    return {
        goto: vi.fn(async () => null),
        url: () => 'https://www.linkedin.com/sales/lists/people/',
        context: () => CONTESTO,
        locator: vi.fn(() => ({
            first: () => ({ count: async () => 1, fill: async () => undefined }),
        })),
        waitForTimeout: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccountProfileById.mockReturnValue({ id: 'acc-1', sessionDir: 'data/session', proxy: null });
    mocks.valutaSessionePrimaDelLavoro.mockResolvedValue({ state: 'logged-in' });
});

describe('M7 — con pagina esterna il click-through torna sempre allo stato precedente', () => {
    it('non era attivo prima e il gesto lancia: la finestra viene restituita all utente', async () => {
        mocks.isWindowClickThroughActive.mockReturnValue(false);
        // Il fail-closed di C29: l'acquisizione dell'input fallisce e il gesto non parte.
        mocks.pauseInputBlock.mockRejectedValue(new Error('input_block_acquire_failed:page_closed'));

        await expect(createSalesNavList('Lista X', 'acc-1', paginaEsterna() as never)).rejects.toThrow(
            'input_block_acquire_failed',
        );

        expect(mocks.enableWindowClickThrough).toHaveBeenCalledWith(CONTESTO);
        expect(mocks.disableWindowClickThrough).toHaveBeenCalledWith(CONTESTO);
        // La sessione non e' nostra: non si chiude il browser di qualcun altro.
        expect(mocks.closeBrowser).not.toHaveBeenCalled();
    });

    it('era gia attivo (acceso dal chiamante) e il gesto lancia: NON si spegne', async () => {
        mocks.isWindowClickThroughActive.mockReturnValue(true);
        mocks.pauseInputBlock.mockRejectedValue(new Error('input_block_acquire_failed:page_closed'));

        await expect(createSalesNavList('Lista X', 'acc-1', paginaEsterna() as never)).rejects.toThrow(
            'input_block_acquire_failed',
        );

        // Spegnerlo lascerebbe il mouse dell'utente libero di interferire col bot del chiamante.
        expect(mocks.disableWindowClickThrough).not.toHaveBeenCalled();
    });

    it('controllo positivo: anche sul percorso senza errori lo stato viene ripristinato', async () => {
        mocks.isWindowClickThroughActive.mockReturnValue(false);
        mocks.pauseInputBlock.mockResolvedValue(undefined);
        mocks.navigateToSavedLists.mockResolvedValue([]);

        const esito = await createSalesNavList('Lista X', 'acc-1', paginaEsterna() as never);

        expect(esito.ok).toBe(true);
        expect(mocks.disableWindowClickThrough).toHaveBeenCalledWith(CONTESTO);
    });
});
