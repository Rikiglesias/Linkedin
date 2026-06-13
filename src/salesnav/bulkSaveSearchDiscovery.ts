/**
 * salesnav/bulkSaveSearchDiscovery.ts
 * ─────────────────────────────────────────────────────────────────
 * Discovery delle ricerche salvate SalesNav: waitForSearchResultsReady (DOM-ready check),
 * normalizeSearchName, extractSavedSearches (parse DOM), ensureNoChallenge (challenge guard),
 * verifyVisionSurface (DOM-first + vision fallback), clickSavedSearchView (apri una ricerca).
 * Estratto da bulkSaveOrchestrator.ts (A13, split SRP). Copia VERBATIM — clickSavedSearchView/
 * verifyVisionSurface hanno timing (humanDelay) e navigazione: zero cambio logica.
 */

import type { Page } from 'playwright';
import { clickLocatorHumanLike, detectChallenge, humanDelay } from '../browser';
import { cleanText } from '../utils/text';
import {
    isPageClosedError,
    hasLocator,
    locatorBoundingBox,
    smartClick,
    findVisibleClickTarget,
    getViewButtonLocator,
} from './bulkSaveHelpers';
import { visionVerify } from './visionNavigator';
import {
    SALESNAV_SELECT_ALL_SELECTOR as SELECT_ALL_SELECTOR,
    SALESNAV_SAVE_TO_LIST_SELECTOR as SAVE_TO_LIST_SELECTOR,
} from './selectors';
import type { SavedSearchDescriptor } from './bulkSaveTypes';
import { BulkSaveChallengeDetectedError } from './bulkSaveTypes';
import { VIEW_SAVED_SEARCH_SELECTOR } from './bulkSaveNavigation';

const ChallengeDetectedError = BulkSaveChallengeDetectedError;

/**
 * Verifica DOM-based: controlla se la pagina dei risultati è caricata
 * cercando i selettori "Select All" o "Save to list" nel DOM.
 * Molto più veloce e affidabile della Vision AI per questa verifica.
 */
export async function waitForSearchResultsReady(page: Page, timeoutMs: number = 18_000): Promise<boolean> {
    // Cerca sia label visibili che controlli standard
    const combinedSelector = [SELECT_ALL_SELECTOR, SAVE_TO_LIST_SELECTOR].join(', ');
    try {
        await page.waitForSelector(combinedSelector, { timeout: timeoutMs, state: 'visible' });
        return true;
    } catch {
        // Fallback 1: l'elemento esiste nel DOM ma potrebbe essere hidden (checkbox input)
        try {
            await page.waitForSelector(combinedSelector, { timeout: 3_000, state: 'attached' });
            return true;
        } catch {
            // Fallback 2: ci sono link a profili SalesNav (pagina caricata, UI diversa)
            const leadLinks = await page
                .locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]')
                .count()
                .catch(() => 0);
            if (leadLinks > 0) return true;
            // Fallback 3: cerca testo "Select all" o "Seleziona tutto" nel DOM
            const hasText = await findVisibleClickTarget(page, ['select all', 'seleziona tutto']);
            return hasText !== null;
        }
    }
}

export function normalizeSearchName(value: string | null | undefined): string {
    return cleanText(value).toLowerCase();
}

export async function extractSavedSearches(page: Page): Promise<SavedSearchDescriptor[]> {
    // NOTE: No named const/function inside page.evaluate — tsx keepNames adds __name which breaks browser context
    const rows = await page.evaluate(() => {
        const viewControlRe = /^(view|view results|visualizza)$/i;
        const controls = Array.from(document.querySelectorAll('button, a')) as Array<
            HTMLButtonElement | HTMLAnchorElement
        >;
        return controls
            .filter((control) => viewControlRe.test((control.innerText || control.textContent || '').trim()))
            .map((control, index) => {
                const rawText = (control.innerText || control.textContent || '').replace(/\s+/g, ' ').trim();
                const container =
                    (control.closest('li, article, tr, [role="row"], section') as HTMLElement | null) ??
                    control.parentElement;
                const lines = (container?.innerText || '')
                    .split('\n')
                    .map((line: string) => line.replace(/\s+/g, ' ').trim())
                    .filter((line: string) => line.length > 0)
                    .filter((line: string) => !viewControlRe.test(line));
                return {
                    index,
                    buttonText: rawText || 'View',
                    name: lines[0] || `Saved search ${index + 1}`,
                };
            });
    });

    return rows.map((row) => ({
        index: row.index,
        buttonText: cleanText(row.buttonText) || 'View',
        name: cleanText(row.name) || `Saved search ${row.index + 1}`,
    }));
}

export async function ensureNoChallenge(page: Page): Promise<void> {
    if (page.isClosed()) {
        throw new Error('La pagina o il browser si sono chiusi durante Sales Navigator bulk save');
    }

    try {
        if (await detectChallenge(page)) {
            throw new ChallengeDetectedError();
        }
    } catch (error) {
        if (isPageClosedError(error)) {
            throw new Error('La pagina o il browser si sono chiusi durante Sales Navigator bulk save');
        }
        throw error;
    }
}

export async function verifyVisionSurface(page: Page): Promise<void> {
    const currentUrl = page.url().toLowerCase();
    const bodyText = (
        (await page
            .locator('body')
            .textContent()
            .catch(() => '')) ?? ''
    ).toLowerCase();
    const viewButtons = await page
        .locator(VIEW_SAVED_SEARCH_SELECTOR)
        .count()
        .catch(() => 0);
    const selectAllControls = await page
        .locator(SELECT_ALL_SELECTOR)
        .count()
        .catch(() => 0);
    const saveToListControls = await page
        .locator(SAVE_TO_LIST_SELECTOR)
        .count()
        .catch(() => 0);

    const savedSearchesDomReady =
        currentUrl.includes('/sales/search/saved-searches') &&
        (viewButtons > 0 || /saved searches|ricerche salvate/.test(bodyText));
    const resultsDomReady =
        currentUrl.includes('/sales/search') &&
        !currentUrl.includes('/saved-searches') &&
        (selectAllControls > 0 || saveToListControls > 0);

    if (savedSearchesDomReady || resultsDomReady) {
        return;
    }

    const visible = await visionVerify(
        page,
        'the current page is a readable LinkedIn Sales Navigator interface, including saved searches or search results',
    );
    if (!visible) {
        throw new Error('Vision runtime non operativo sulla pagina corrente');
    }
}

export async function clickSavedSearchView(page: Page, search: SavedSearchDescriptor, dryRun: boolean): Promise<void> {
    const button = getViewButtonLocator(page, search.index, VIEW_SAVED_SEARCH_SELECTOR);
    if (!(await hasLocator(button))) {
        throw new Error(`Bottone View non trovato per ricerca ${search.index + 1}`);
    }

    await button.scrollIntoViewIfNeeded();
    await humanDelay(page, 200, 450);

    if (dryRun) {
        return;
    }

    // Click diretto via DOM locator + humanMouseMove (no Vision AI necessaria,
    // il bottone è già identificato dal DOM con selettore esatto)
    const box = await locatorBoundingBox(button);
    if (box) {
        await smartClick(page, box);
    } else {
        await clickLocatorHumanLike(page, button, {
            scrollTimeoutMs: 5_000,
        });
    }

    await humanDelay(page, 800, 1_400);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch((err) => {
        console.warn(
            '[WARN] domcontentloaded timeout dopo click ricerca salvata:',
            err instanceof Error ? err.message : String(err),
        );
    });
    // Overlays auto-injected via 'load' event

    const ready = await waitForSearchResultsReady(page, 18_000);
    if (!ready) {
        throw new Error(`Risultati non caricati per la ricerca "${search.name}"`);
    }
}
