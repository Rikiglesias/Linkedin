import type { Locator, Page } from 'playwright';
import {
    contextualReadingPause,
    detectChallenge,
    humanDelay,
    performDecoyAction,
    performDecoyBurst,
    randomMouseMove,
    simulateHumanReading,
} from '../browser';
import { simulateTabSwitch } from '../browser/humanBehavior';
import {
    addSyncItem,
    completeSyncRun,
    createSyncRun,
    failSyncRun,
    getResumableSyncRun,
    getSyncRunSummary,
    pauseSyncRun,
    updateSyncRunProgress,
} from '../core/repositories';
import type { SalesNavSyncRunRecord, SalesNavSyncRunSummary } from '../core/repositories.types';
import {
    visionClick,
    visionPageAllAlreadySaved,
    visionReadTotalResults,
    visionVerify,
    visionWaitFor,
    type VisionRegionClip,
} from './visionNavigator';
import { checkDuplicates, extractProfileUrlsFromPage, saveExtractedProfiles } from './salesnavDedup';
import {
    SALESNAV_NEXT_PAGE_SELECTOR as NEXT_PAGE_SELECTOR,
    SALESNAV_SELECT_ALL_SELECTOR as SELECT_ALL_SELECTOR,
    SALESNAV_SAVE_TO_LIST_SELECTOR as SAVE_TO_LIST_SELECTOR,
    SALESNAV_DIALOG_SELECTOR as DIALOG_SELECTOR,
} from './selectors';

export const SEARCHES_URL = 'https://www.linkedin.com/sales/search/saved-searches';

const VIEW_SAVED_SEARCH_SELECTOR = [
    'button:has-text("Visualizza")',
    'button:has-text("View results")',
    'button:has-text("View")',
    'a:has-text("Visualizza")',
    'a:has-text("View results")',
].join(', ');

const SEARCH_RESULTS_READY_QUESTION =
    'the page shows Sales Navigator lead results and a control labeled "Select all" or "Seleziona tutto" or "Save to list" or "Salva nell\'elenco"';

export interface SalesNavBulkSaveOptions {
    accountId: string;
    targetListName: string;
    maxPages: number;
    maxSearches?: number | null;
    searchName?: string | null;
    resume?: boolean;
    dryRun?: boolean;
    sessionLimit?: number | null;
}

export interface SalesNavBulkSavePageReport {
    pageNumber: number;
    leadsOnPage: number;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'SKIPPED_ALL_SAVED';
    errorMessage: string | null;
    allAlreadySaved?: boolean;
}

export interface SalesNavBulkSaveSearchReport {
    searchIndex: number;
    searchName: string;
    startedPage: number;
    finalPage: number;
    processedPages: number;
    pagesSkippedAllSaved: number;
    leadsSaved: number;
    totalResultsDetected: number | null;
    status: 'SUCCESS' | 'SKIPPED_AFTER_FAILURES' | 'FAILED_TO_OPEN' | 'DRY_RUN';
    errors: string[];
    pages: SalesNavBulkSavePageReport[];
}

export interface SalesNavBulkSaveReport {
    runId: number | null;
    accountId: string;
    targetListName: string;
    dryRun: boolean;
    resumeRequested: boolean;
    resumedFromRunId: number | null;
    status: 'SUCCESS' | 'FAILED' | 'PAUSED' | 'DRY_RUN';
    challengeDetected: boolean;
    sessionLimitHit: boolean;
    searchesDiscovered: number;
    searchesPlanned: number;
    searchesProcessed: number;
    pagesProcessed: number;
    pagesSkippedAllSaved: number;
    totalLeadsSaved: number;
    lastError: string | null;
    startedAt: string;
    finishedAt: string | null;
    searches: SalesNavBulkSaveSearchReport[];
    dbSummary: SalesNavSyncRunSummary | null;
}

export interface SavedSearchDescriptor {
    index: number;
    name: string;
    buttonText: string;
}

class ChallengeDetectedError extends Error {
    constructor(message: string = 'Challenge rilevato durante Sales Navigator bulk save') {
        super(message);
        this.name = 'ChallengeDetectedError';
    }
}

function isPageClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Target page, context or browser has been closed|page\.goto:.*closed/i.test(message);
}

function cleanText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchName(value: string | null | undefined): string {
    return cleanText(value).toLowerCase();
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getSafeMaxSearches(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return Number.MAX_SAFE_INTEGER;
    }
    return Math.max(1, Math.floor(value));
}

function getSafeSessionLimit(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return null;
    }
    return Math.max(1, Math.floor(value));
}

function getViewButtonLocator(page: Page, index: number): Locator {
    return page.locator(VIEW_SAVED_SEARCH_SELECTOR).nth(index);
}

async function hasLocator(locator: Locator): Promise<boolean> {
    try {
        return (await locator.count()) > 0;
    } catch {
        return false;
    }
}

async function locatorBoundingBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
        const box = await locator.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) {
            return null;
        }
        return box;
    } catch {
        return null;
    }
}

function buildClipFromBox(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
    padding: { top: number; right: number; bottom: number; left: number },
): VisionRegionClip {
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const x = clampNumber(Math.floor(box.x - padding.left), 0, viewport.width);
    const y = clampNumber(Math.floor(box.y - padding.top), 0, viewport.height);
    const maxWidth = viewport.width - x;
    const maxHeight = viewport.height - y;
    const width = clampNumber(Math.floor(box.width + padding.left + padding.right), 1, Math.max(1, maxWidth));
    const height = clampNumber(Math.floor(box.height + padding.top + padding.bottom), 1, Math.max(1, maxHeight));
    return { x, y, width, height };
}

async function buildClipAroundLocator(
    page: Page,
    locator: Locator,
    padding: { top: number; right: number; bottom: number; left: number },
): Promise<VisionRegionClip | undefined> {
    const box = await locatorBoundingBox(locator);
    if (!box) {
        return undefined;
    }
    return buildClipFromBox(page, box, padding);
}

async function navigateToSavedSearches(page: Page): Promise<void> {
    await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1800, 3200);
    await simulateHumanReading(page);
}

export async function extractSavedSearches(page: Page): Promise<SavedSearchDescriptor[]> {
    const rows = await page.evaluate(() => {
        const isViewControl = (raw: string) => /^(view|view results|visualizza)$/i.test(raw.trim());
        const controls = Array.from(document.querySelectorAll('button, a')) as Array<HTMLButtonElement | HTMLAnchorElement>;
        return controls
            .filter((control) => isViewControl(control.innerText || control.textContent || ''))
            .map((control, index) => {
                const rawText = (control.innerText || control.textContent || '').replace(/\s+/g, ' ').trim();
                const container =
                    (control.closest('li, article, tr, [role="row"], section') as HTMLElement | null) ??
                    control.parentElement;
                const lines = (container?.innerText || '')
                    .split('\n')
                    .map((line) => line.replace(/\s+/g, ' ').trim())
                    .filter((line) => line.length > 0)
                    .filter((line) => !isViewControl(line));
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

async function estimateCurrentPageLeadCount(page: Page): Promise<number> {
    try {
        const count = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
            const urls = new Set<string>();
            for (const anchor of anchors) {
                const href = anchor.href || anchor.getAttribute('href') || '';
                if (!/linkedin\.com\/(sales\/lead|in\/)/i.test(href)) continue;
                urls.add(href.split('#')[0]);
            }
            return urls.size;
        });
        return Math.max(0, Math.floor(count));
    } catch {
        return 0;
    }
}

async function ensureNoChallenge(page: Page): Promise<void> {
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

async function verifyVisionSurface(page: Page): Promise<void> {
    const currentUrl = page.url().toLowerCase();
    const bodyText = ((await page.locator('body').textContent().catch(() => '')) ?? '').toLowerCase();
    const viewButtons = await page.locator(VIEW_SAVED_SEARCH_SELECTOR).count().catch(() => 0);
    const selectAllControls = await page.locator(SELECT_ALL_SELECTOR).count().catch(() => 0);
    const saveToListControls = await page.locator(SAVE_TO_LIST_SELECTOR).count().catch(() => 0);

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

async function clickSavedSearchView(page: Page, search: SavedSearchDescriptor, dryRun: boolean): Promise<void> {
    const button = getViewButtonLocator(page, search.index);
    if (!(await hasLocator(button))) {
        throw new Error(`Bottone View non trovato per ricerca ${search.index + 1}`);
    }

    await button.scrollIntoViewIfNeeded();
    await humanDelay(page, 200, 450);

    const clip =
        (await buildClipAroundLocator(page, button, { top: 70, right: 120, bottom: 70, left: 520 })) ?? undefined;

    if (dryRun) {
        const targetVisible = await visionVerify(
            page,
            `a saved search row named "${search.name}" with a button labeled "${search.buttonText}"`,
            clip ? { clip } : undefined,
        );
        if (!targetVisible) {
            throw new Error(`Dry run: impossibile validare il bottone View per "${search.name}"`);
        }
        return;
    }

    await visionClick(page, `button labeled "${search.buttonText}" for saved search "${search.name}"`, {
        clip,
        retries: 3,
        postClickDelayMs: 1_200,
    });
    await page.waitForLoadState('domcontentloaded').catch(() => null);

    const ready = await visionWaitFor(page, SEARCH_RESULTS_READY_QUESTION, 18_000);
    if (!ready) {
        throw new Error(`Risultati non caricati per la ricerca "${search.name}"`);
    }
}

async function clickSelectAll(page: Page, dryRun: boolean): Promise<void> {
    const locator = page.locator(SELECT_ALL_SELECTOR).first();
    const clip =
        (await buildClipAroundLocator(page, locator, { top: 50, right: 320, bottom: 50, left: 120 })) ?? undefined;

    if (dryRun) {
        const visible = await visionVerify(
            page,
            'a control labeled "Select all" or "Seleziona tutto" for the current page results',
            clip ? { clip } : undefined,
        );
        if (!visible) {
            throw new Error('Dry run: controllo Select all non visibile');
        }
        return;
    }

    await visionClick(page, 'checkbox or button labeled "Select all" or "Seleziona tutto"', {
        clip,
        locator: (await hasLocator(locator)) ? locator : undefined,
        retries: 3,
        postClickDelayMs: 850,
    });
    await humanDelay(page, 650, 1_250);
}

async function openSaveToListDialog(page: Page, dryRun: boolean): Promise<void> {
    const locator = page.locator(SAVE_TO_LIST_SELECTOR).first();
    const clip =
        (await buildClipAroundLocator(page, locator, { top: 60, right: 260, bottom: 60, left: 200 })) ?? undefined;

    if (dryRun) {
        const visible = await visionVerify(
            page,
            'a button labeled "Save to list" or "Salva nell\'elenco"',
            clip ? { clip } : undefined,
        );
        if (!visible) {
            throw new Error('Dry run: bottone Save to list non visibile');
        }
        return;
    }

    await visionClick(page, 'button labeled "Save to list" or "Salva nell\'elenco"', {
        clip,
        locator: (await hasLocator(locator)) ? locator : undefined,
        retries: 3,
        postClickDelayMs: 900,
    });

    const dialogLocator = page.locator(DIALOG_SELECTOR).first();
    const dialogVisible = await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).then(
        () => true,
        () => false,
    );
    if (!dialogVisible) {
        const ready = await visionWaitFor(page, 'the save to list dialog is open and list options are visible', 10_000);
        if (!ready) {
            throw new Error('Dialog Save to list non aperto');
        }
    }
}

async function chooseTargetList(page: Page, targetListName: string, dryRun: boolean): Promise<void> {
    const dialogLocator = page.locator(DIALOG_SELECTOR).first();
    const clip =
        (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
        undefined;

    if (dryRun) {
        const visible = await visionVerify(
            page,
            `the dialog contains an option labeled "${targetListName}"`,
            clip ? { clip } : undefined,
        );
        if (!visible) {
            throw new Error(`Dry run: lista target "${targetListName}" non trovata nella dialog`);
        }
        return;
    }

    await visionClick(page, `option labeled "${targetListName}" inside the dialog`, {
        clip,
        locator: (await hasLocator(dialogLocator)) ? dialogLocator : undefined,
        retries: 3,
        postClickDelayMs: 1_100,
    });

    const dialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 12_000 }).then(
        () => true,
        () => false,
    );
    if (!dialogClosed) {
        const ready = await visionWaitFor(
            page,
            'the save to list dialog is closed and the search results page is visible again',
            12_000,
        );
        if (!ready) {
            throw new Error(`Dialog Save to list non chiusa dopo la selezione di "${targetListName}"`);
        }
    }
}

async function hasNextPage(page: Page): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if (!(await hasLocator(nextButton))) {
        return false;
    }
    const ariaDisabled = (await nextButton.getAttribute('aria-disabled').catch(() => null))?.toLowerCase() === 'true';
    const disabled = ariaDisabled || (await nextButton.isDisabled().catch(() => false));
    return !disabled;
}

async function clickNextPage(page: Page, dryRun: boolean): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if (!(await hasNextPage(page))) {
        return false;
    }

    const clip =
        (await buildClipAroundLocator(page, nextButton, { top: 40, right: 160, bottom: 40, left: 220 })) ?? undefined;

    if (dryRun) {
        return true;
    }

    await visionClick(page, 'pagination button labeled "Next" or "Avanti"', {
        clip,
        locator: (await hasLocator(nextButton)) ? nextButton : undefined,
        retries: 3,
        postClickDelayMs: 1_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 1_200, 2_100);
    return true;
}

async function prepareResultsPage(page: Page): Promise<void> {
    await contextualReadingPause(page);
    await simulateHumanReading(page);
    await humanDelay(page, 800, 2_000);
}

async function restoreSearchPagePosition(page: Page, targetPageNumber: number): Promise<void> {
    if (targetPageNumber <= 1) {
        return;
    }

    for (let currentPage = 1; currentPage < targetPageNumber; currentPage++) {
        const moved = await clickNextPage(page, false);
        if (!moved) {
            throw new Error(
                `Impossibile ripristinare la pagina ${targetPageNumber}: Next non disponibile alla pagina ${currentPage}`,
            );
        }
    }
}

async function dismissTransientUi(page: Page): Promise<void> {
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(250).catch(() => null);
}

async function runAntiDetectionNoise(page: Page, totalProcessedPages: number): Promise<void> {
    await randomMouseMove(page);
    if (Math.random() < 0.1) {
        await simulateTabSwitch(page, 7_500);
    }
    if (Math.random() < 0.2) {
        await humanDelay(page, 4_000, 9_000);
    }

    if (totalProcessedPages > 0 && totalProcessedPages % 5 === 0) {
        const returnUrl = page.url();
        if (Math.random() < 0.5) {
            await performDecoyAction(page);
        } else {
            await performDecoyBurst(page);
        }
        await page.goto(returnUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await humanDelay(page, 1_200, 2_400);
        await visionWaitFor(page, SEARCH_RESULTS_READY_QUESTION, 12_000).catch(() => false);
    }
}

async function processSearchPage(page: Page, targetListName: string, dryRun: boolean): Promise<void> {
    await ensureNoChallenge(page);
    await prepareResultsPage(page);
    await clickSelectAll(page, dryRun);
    await ensureNoChallenge(page);
    await openSaveToListDialog(page, dryRun);
    await chooseTargetList(page, targetListName, dryRun);
    await ensureNoChallenge(page);
}

function buildInitialReport(options: SalesNavBulkSaveOptions): SalesNavBulkSaveReport {
    return {
        runId: null,
        accountId: options.accountId,
        targetListName: options.targetListName,
        dryRun: options.dryRun === true,
        resumeRequested: options.resume === true,
        resumedFromRunId: null,
        status: options.dryRun === true ? 'DRY_RUN' : 'SUCCESS',
        challengeDetected: false,
        sessionLimitHit: false,
        searchesDiscovered: 0,
        searchesPlanned: 0,
        searchesProcessed: 0,
        pagesProcessed: 0,
        pagesSkippedAllSaved: 0,
        totalLeadsSaved: 0,
        lastError: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        searches: [],
        dbSummary: null,
    };
}

export async function runSalesNavBulkSave(page: Page, options: SalesNavBulkSaveOptions): Promise<SalesNavBulkSaveReport> {
    const report = buildInitialReport(options);
    const dryRun = options.dryRun === true;
    const safeMaxPages = Math.max(1, Math.floor(options.maxPages));
    const safeMaxSearches = getSafeMaxSearches(options.maxSearches);
    const safeSessionLimit = getSafeSessionLimit(options.sessionLimit);
    const normalizedRequestedSearchName = normalizeSearchName(options.searchName);
    let run: SalesNavSyncRunRecord | null = null;
    let currentAbsoluteSearchIndex = 0;
    let currentPageNumber = 1;

    try {
        await navigateToSavedSearches(page);
        await ensureNoChallenge(page);

        const discoveredSearches = await extractSavedSearches(page);
        report.searchesDiscovered = discoveredSearches.length;
        if (discoveredSearches.length === 0) {
            const currentUrl = page.url().toLowerCase();
            const bodyText = ((await page.locator('body').textContent().catch(() => '')) ?? '').toLowerCase();
            const isSavedSearchesPage =
                currentUrl.includes('/sales/search/saved-searches') &&
                /saved searches|ricerche salvate/.test(bodyText);

            if (isSavedSearchesPage) {
                throw new Error(
                    'Pagina "Ricerche salvate" aperta ma nessun bottone View/Visualizza rilevato. Probabile variazione UI di Sales Navigator.',
                );
            }

            await verifyVisionSurface(page);
            throw new Error('Nessuna ricerca salvata trovata in Sales Navigator');
        }

        const filteredSearches =
            normalizedRequestedSearchName.length > 0
                ? discoveredSearches.filter((search) => normalizeSearchName(search.name) === normalizedRequestedSearchName)
                : discoveredSearches;

        if (normalizedRequestedSearchName.length > 0 && filteredSearches.length === 0) {
            throw new Error(`Ricerca salvata non trovata: "${options.searchName}"`);
        }

        const resumableRun =
            options.resume && !dryRun
                ? await getResumableSyncRun(options.accountId, options.targetListName, options.searchName ?? null)
                : null;
        const totalTrackedSearches =
            normalizedRequestedSearchName.length > 0 ? filteredSearches.length : discoveredSearches.length;
        const startIndex = resumableRun ? Math.max(0, resumableRun.current_search_index) : 0;
        currentAbsoluteSearchIndex = startIndex;
        currentPageNumber = resumableRun ? Math.max(1, resumableRun.current_page_number) : 1;

        const plannedSearches =
            normalizedRequestedSearchName.length > 0
                ? filteredSearches.slice(0, safeMaxSearches)
                : discoveredSearches.slice(startIndex, startIndex + safeMaxSearches);
        report.searchesPlanned = plannedSearches.length;
        report.resumedFromRunId = resumableRun?.id ?? null;
        if (plannedSearches.length === 0) {
            report.finishedAt = new Date().toISOString();
            return report;
        }

        if (!resumableRun) {
            currentAbsoluteSearchIndex = plannedSearches[0]?.index ?? 0;
            currentPageNumber = 1;
        }

        if (!dryRun) {
            if (resumableRun) {
                run = await updateSyncRunProgress({
                    runId: resumableRun.id,
                    totalSearches: totalTrackedSearches,
                    totalPages: totalTrackedSearches * safeMaxPages,
                    currentSearchIndex: startIndex,
                    currentPageNumber,
                    lastError: resumableRun.last_error ?? null,
                });
            } else {
                run = await createSyncRun({
                    accountId: options.accountId,
                    targetListName: options.targetListName,
                    totalSearches: totalTrackedSearches,
                    totalPages: totalTrackedSearches * safeMaxPages,
                    currentSearchIndex: currentAbsoluteSearchIndex,
                    currentPageNumber: 1,
                    searchName: plannedSearches[0]?.name ?? null,
                });
            }
            report.runId = run.id;
        }

        for (let offset = 0; offset < plannedSearches.length; offset++) {
            const search = plannedSearches[offset];
            const absoluteIndex = search.index;
            const isResumedCurrentSearch = resumableRun !== null && absoluteIndex === startIndex;
            const initialPageNumber = isResumedCurrentSearch ? currentPageNumber : 1;
            currentAbsoluteSearchIndex = absoluteIndex;
            currentPageNumber = initialPageNumber;

            const searchReport: SalesNavBulkSaveSearchReport = {
                searchIndex: absoluteIndex,
                searchName: search.name,
                startedPage: initialPageNumber,
                finalPage: initialPageNumber,
                processedPages: 0,
                pagesSkippedAllSaved: 0,
                leadsSaved: 0,
                totalResultsDetected: null,
                status: dryRun ? 'DRY_RUN' : 'SUCCESS',
                errors: [],
                pages: [],
            };
            report.searches.push(searchReport);

            if (!dryRun && run) {
                run = await updateSyncRunProgress({
                    runId: run.id,
                    searchName: search.name,
                    currentSearchIndex: absoluteIndex,
                    currentPageNumber,
                    lastError: null,
                });
            }

            await navigateToSavedSearches(page);
            await ensureNoChallenge(page);

            try {
                await clickSavedSearchView(page, search, dryRun);
                await ensureNoChallenge(page);

                // Read total results count once per search to cap maxPages accurately.
                // Avoids navigating to empty pages beyond the real last page (bot pattern).
                if (!dryRun) {
                    const totalResults = await visionReadTotalResults(page);
                    if (totalResults !== null) {
                        searchReport.totalResultsDetected = totalResults;
                    }
                }

                if (!dryRun && initialPageNumber > 1) {
                    await restoreSearchPagePosition(page, initialPageNumber);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                searchReport.status = 'FAILED_TO_OPEN';
                searchReport.errors.push(message);
                report.lastError = message;

                if (error instanceof ChallengeDetectedError) {
                    report.challengeDetected = true;
                    report.status = 'PAUSED';
                    if (run) {
                        await pauseSyncRun(run.id, message, {
                            searchName: search.name,
                            currentSearchIndex: absoluteIndex,
                            currentPageNumber,
                            processedSearches: report.searchesProcessed,
                            processedPages: report.pagesProcessed,
                            totalLeadsSaved: report.totalLeadsSaved,
                        });
                    }
                    break;
                }

                if (run) {
                    await updateSyncRunProgress({
                        runId: run.id,
                        searchName: search.name,
                        currentSearchIndex: absoluteIndex + 1,
                        currentPageNumber: 1,
                        processedSearches: report.searchesProcessed + 1,
                        processedPages: report.pagesProcessed,
                        totalLeadsSaved: report.totalLeadsSaved,
                        lastError: message,
                    });
                }
                report.searchesProcessed += 1;
                continue;
            }

            if (dryRun) {
                report.searchesProcessed += 1;
                searchReport.pages.push({
                    pageNumber: currentPageNumber,
                    leadsOnPage: 0,
                    status: 'SKIPPED',
                    errorMessage: null,
                });
                searchReport.finalPage = currentPageNumber;
                continue;
            }

            // Cap the loop at the real number of pages detected by vision (if available).
            // This prevents navigating past the last page, which looks bot-like.
            const searchMaxPages =
                searchReport.totalResultsDetected !== null
                    ? Math.min(safeMaxPages, Math.ceil(searchReport.totalResultsDetected / 25))
                    : safeMaxPages;

            let consecutiveFailedPages = 0;
            for (let pageNumber = initialPageNumber; pageNumber <= searchMaxPages; pageNumber++) {
                currentPageNumber = pageNumber;
                searchReport.finalPage = pageNumber;

                if (safeSessionLimit !== null && report.pagesProcessed >= safeSessionLimit) {
                    report.sessionLimitHit = true;
                    report.status = 'PAUSED';
                    report.lastError = 'Session limit raggiunto';
                    if (run) {
                        await pauseSyncRun(run.id, report.lastError, {
                            searchName: search.name,
                            currentSearchIndex: absoluteIndex,
                            currentPageNumber: pageNumber,
                            processedSearches: report.searchesProcessed,
                            processedPages: report.pagesProcessed,
                            totalLeadsSaved: report.totalLeadsSaved,
                        });
                    }
                    break;
                }

                const leadsOnPage = await estimateCurrentPageLeadCount(page);

                // Anti-detection: check if ALL leads on this page are already saved.
                // If yes, skip the "Select All + Save to list" bulk actions entirely.
                // This is the biggest reduction in LinkedIn-visible bot activity on subsequent runs.
                const allSaved = await visionPageAllAlreadySaved(page);
                if (allSaved) {
                    if (run) {
                        await addSyncItem({
                            runId: run.id,
                            searchIndex: absoluteIndex,
                            pageNumber,
                            leadsOnPage,
                            status: 'SKIPPED',
                        });
                    }
                    report.pagesSkippedAllSaved += 1;
                    searchReport.pagesSkippedAllSaved += 1;
                    searchReport.pages.push({
                        pageNumber,
                        leadsOnPage,
                        status: 'SKIPPED_ALL_SAVED',
                        errorMessage: null,
                        allAlreadySaved: true,
                    });

                    if (pageNumber >= searchMaxPages) {
                        break;
                    }
                    const movedSkip = await clickNextPage(page, false);
                    if (!movedSkip) {
                        break;
                    }
                    continue;
                }

                try {
                    // Extract profile URLs BEFORE save (for dedup tracking)
                    const extractedProfiles = await extractProfileUrlsFromPage(page);
                    const dedupResult = await checkDuplicates(options.targetListName, extractedProfiles);

                    await processSearchPage(page, options.targetListName, false);

                    // Write profiles to salesnav_list_members AFTER save confirmed
                    if (run && extractedProfiles.length > 0) {
                        await saveExtractedProfiles(
                            options.targetListName,
                            extractedProfiles,
                            run.id,
                            absoluteIndex,
                            pageNumber,
                        );
                    }

                    if (run) {
                        await addSyncItem({
                            runId: run.id,
                            searchIndex: absoluteIndex,
                            pageNumber,
                            leadsOnPage,
                            status: 'SUCCESS',
                        });
                    }

                    const effectiveLeadsSaved = dedupResult.newProfiles > 0 ? dedupResult.newProfiles : leadsOnPage;
                    report.pagesProcessed += 1;
                    report.totalLeadsSaved += effectiveLeadsSaved;
                    searchReport.processedPages += 1;
                    searchReport.leadsSaved += leadsOnPage;
                    searchReport.pages.push({
                        pageNumber,
                        leadsOnPage,
                        status: 'SUCCESS',
                        errorMessage: null,
                    });
                    consecutiveFailedPages = 0;

                    if (run) {
                        run = await updateSyncRunProgress({
                            runId: run.id,
                            searchName: search.name,
                            processedPages: report.pagesProcessed,
                            totalLeadsSaved: report.totalLeadsSaved,
                            currentSearchIndex: absoluteIndex,
                            currentPageNumber: Math.min(pageNumber + 1, searchMaxPages + 1),
                            lastError: null,
                        });
                    }

                    await ensureNoChallenge(page);
                    await runAntiDetectionNoise(page, report.pagesProcessed);

                    if (pageNumber >= searchMaxPages) {
                        break;
                    }
                    const moved = await clickNextPage(page, false);
                    if (!moved) {
                        break;
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (run) {
                        await addSyncItem({
                            runId: run.id,
                            searchIndex: absoluteIndex,
                            pageNumber,
                            leadsOnPage,
                            status: 'FAILED',
                            errorMessage: message,
                        });
                    }
                    searchReport.pages.push({
                        pageNumber,
                        leadsOnPage,
                        status: 'FAILED',
                        errorMessage: message,
                    });
                    searchReport.errors.push(message);
                    report.lastError = message;
                    consecutiveFailedPages += 1;

                    if (run) {
                        await updateSyncRunProgress({
                            runId: run.id,
                            searchName: search.name,
                            currentSearchIndex: absoluteIndex,
                            currentPageNumber: pageNumber,
                            processedPages: report.pagesProcessed,
                            totalLeadsSaved: report.totalLeadsSaved,
                            lastError: message,
                        });
                    }

                    if (error instanceof ChallengeDetectedError || (await detectChallenge(page))) {
                        report.challengeDetected = true;
                        report.status = 'PAUSED';
                        if (run) {
                            await pauseSyncRun(run.id, message, {
                                searchName: search.name,
                                currentSearchIndex: absoluteIndex,
                                currentPageNumber: pageNumber,
                                processedSearches: report.searchesProcessed,
                                processedPages: report.pagesProcessed,
                                totalLeadsSaved: report.totalLeadsSaved,
                            });
                        }
                        break;
                    }

                    await dismissTransientUi(page);

                    if (consecutiveFailedPages >= 3) {
                        searchReport.status = 'SKIPPED_AFTER_FAILURES';
                        break;
                    }

                    if (pageNumber >= searchMaxPages) {
                        break;
                    }

                    const moved = await clickNextPage(page, false);
                    if (!moved) {
                        break;
                    }
                }
            }

            if (report.status === 'PAUSED') {
                break;
            }

            report.searchesProcessed += 1;
            if (run) {
                run = await updateSyncRunProgress({
                    runId: run.id,
                    searchName: null,
                    processedSearches: report.searchesProcessed,
                    processedPages: report.pagesProcessed,
                    totalLeadsSaved: report.totalLeadsSaved,
                    currentSearchIndex: absoluteIndex + 1,
                    currentPageNumber: 1,
                    lastError: searchReport.errors.at(-1) ?? null,
                });
            }
        }

        if (!dryRun && run) {
            if (report.status !== 'PAUSED') {
                run = await completeSyncRun(run.id, {
                    searchName: null,
                    processedSearches: report.searchesProcessed,
                    processedPages: report.pagesProcessed,
                    totalLeadsSaved: report.totalLeadsSaved,
                    currentSearchIndex: currentAbsoluteSearchIndex + (report.status === 'SUCCESS' ? 1 : 0),
                    currentPageNumber: 1,
                    lastError: null,
                });
                report.runId = run.id;
                report.status = 'SUCCESS';
            } else {
                report.runId = run.id;
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.lastError = message;
        report.status = 'FAILED';

        if (error instanceof ChallengeDetectedError) {
            report.challengeDetected = true;
            report.status = 'PAUSED';
            if (run) {
                await pauseSyncRun(run.id, message, {
                    currentSearchIndex: currentAbsoluteSearchIndex,
                    currentPageNumber,
                    processedSearches: report.searchesProcessed,
                    processedPages: report.pagesProcessed,
                    totalLeadsSaved: report.totalLeadsSaved,
                });
            }
        } else if (!dryRun && run) {
            run = await failSyncRun(run.id, message, {
                currentSearchIndex: currentAbsoluteSearchIndex,
                currentPageNumber,
                processedSearches: report.searchesProcessed,
                processedPages: report.pagesProcessed,
                totalLeadsSaved: report.totalLeadsSaved,
            });
            report.runId = run.id;
        }
    } finally {
        report.finishedAt = new Date().toISOString();
        if (!dryRun && report.runId) {
            report.dbSummary = await getSyncRunSummary(report.runId);
        }
    }

    return report;
}
