import type { Locator, Page } from 'playwright';
import {
    detectChallenge,
    humanDelay,
    isLoggedIn,
    performDecoyAction,
    randomMouseMove,
} from '../browser';
import { ensureVisualCursorOverlay, ensureInputBlock, pauseInputBlock, resumeInputBlock, humanMouseMoveToCoords, pulseVisualCursorOverlay } from '../browser/humanBehavior';
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
    visionContextualDelay,
    visionRead,
    visionReadTotalResults,
    visionVerify,
    visionWaitFor,
    type VisionRegionClip,
} from './visionNavigator';
import { checkDuplicates, extractProfileUrlsFromPage, saveExtractedProfiles } from './salesnavDedup';
import { computerUseSelectList } from './computerUse';
// listScraper: navigateToSavedLists/scrapeLeadsFromSalesNavList non piu' usati — pre-sync usa vision-guided navigation
import {
    SALESNAV_NEXT_PAGE_SELECTOR as NEXT_PAGE_SELECTOR,
    SALESNAV_SELECT_ALL_SELECTOR as SELECT_ALL_SELECTOR,
    SALESNAV_SAVE_TO_LIST_SELECTOR as SAVE_TO_LIST_SELECTOR,
    SALESNAV_DIALOG_SELECTOR as DIALOG_SELECTOR,
} from './selectors';

export const SEARCHES_URL = 'https://www.linkedin.com/sales/search/saved-searches';

/** When true, reInjectOverlays skips ensureInputBlock — user needs to interact with the browser. */
let _inputBlockSuspended = false;

const VIEW_SAVED_SEARCH_SELECTOR = [
    'button:has-text("Visualizza")',
    'button:has-text("View results")',
    'a:has-text("Visualizza")',
    'a:has-text("View results")',
    'a:has-text("View search")',
].join(', ');

/**
 * Attende che l'utente completi il login manualmente nel browser.
 * Controlla ogni 5 secondi se l'URL non contiene più pattern di login.
 * Timeout massimo: 3 minuti.
 */
async function waitForManualLogin(page: Page, context: string): Promise<void> {
    const MAX_WAIT_MS = 3 * 60 * 1000; // 3 minuti
    const POLL_INTERVAL_MS = 5_000;
    const startTime = Date.now();

    // Sospendi l'input blocker globalmente — impedisce che reInjectOverlays lo riattivi
    _inputBlockSuspended = true;
    await pauseInputBlock(page);

    console.warn(`[${context}] Sessione scaduta — in attesa del login manuale nel browser...`);
    console.warn(`[${context}] URL: ${page.url()}`);
    console.warn(`[${context}] Hai 3 minuti per completare il login.`);

    try {
        while (Date.now() - startTime < MAX_WAIT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            if (await isLoggedIn(page)) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`[${context}] Login completato dopo ${elapsed}s. Riprendo...`);
                await humanDelay(page, 1000, 2000);
                return;
            }
            const remaining = Math.round((MAX_WAIT_MS - (Date.now() - startTime)) / 1000);
            console.log(`[${context}] Ancora in attesa del login... (${remaining}s rimanenti)`);
        }

        throw new Error(
            `Timeout: login manuale non completato entro 3 minuti. URL: ${page.url()}`,
        );
    } finally {
        _inputBlockSuspended = false;
        await resumeInputBlock(page).catch(() => { });
    }
}

/**
 * Verifica DOM-based: controlla se la pagina dei risultati è caricata
 * cercando i selettori "Select All" o "Save to list" nel DOM.
 * Molto più veloce e affidabile della Vision AI per questa verifica.
 */
async function waitForSearchResultsReady(page: Page, timeoutMs: number = 18_000): Promise<boolean> {
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
            const leadLinks = await page.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').count().catch(() => 0);
            if (leadLinks > 0) return true;
            // Fallback 3: cerca testo "Select all" o "Seleziona tutto" nel DOM
            const hasText = await findVisibleClickTarget(page, ['select all', 'seleziona tutto']);
            return hasText !== null;
        }
    }
}

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

async function reInjectOverlays(page: Page): Promise<void> {
    // Inject __name no-op in browser context — tsx keepNames:true adds __name() calls
    // to all named functions/consts, which breaks inside page.evaluate() where the
    // helper doesn't exist. This shim makes them safe.
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        if (typeof w.__name === 'undefined') {
            w.__name = (target: unknown, _value: unknown) => target;
        }
        if (typeof w.__defProp === 'undefined') {
            w.__defProp = Object.defineProperty;
        }
    }).catch(() => null);
    await ensureVisualCursorOverlay(page);
    // Skip input block if suspended (user needs to interact, e.g. manual login)
    if (!_inputBlockSuspended) {
        await ensureInputBlock(page);
    }
}

/**
 * Cerca nel DOM un elemento visibile il cui testo corrisponde a uno dei pattern.
 * Gestisce input nascosti risalendo al <label> padre.
 *
 * @param includeGenericElements — se true, cerca anche div/span/li (per dialog liste).
 *   Default false: cerca solo elementi interattivi (button, label, input, checkbox).
 *   Questo evita di matchare container giganti che contengono il testo nei figli.
 */
async function findVisibleClickTarget(
    page: Page,
    textPatterns: string[],
    containerSelector?: string,
    includeGenericElements: boolean = false,
    strictMatch: boolean = false,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
    // NOTE: No named const/function inside page.evaluate — tsx keepNames adds __name which breaks browser context
    return page.evaluate(
        ({ patterns, container, includeGeneric, strict }) => {
            const root = container
                ? (document.querySelector(container) ?? document)
                : document;
            const interactiveSelector =
                'button, a, label, input, [role="button"], [role="checkbox"], [role="menuitem"], [role="option"]';
            const genericSelector = interactiveSelector + ', span, div, li';
            const candidates = root.querySelectorAll(includeGeneric ? genericSelector : interactiveSelector);

            // Build a flat list of {el, text} to avoid repeated DOM reads
            const entries: Array<{ el: HTMLElement; text: string }> = [];
            for (const el of candidates) {
                const htmlEl = el as HTMLElement;
                const text = (htmlEl.innerText || htmlEl.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                if (text.length > 0) entries.push({ el: htmlEl, text });
            }

            // Inline box extraction (no named function to avoid tsx __name issue)
            for (let pass = 0; pass < (strict ? 2 : 3); pass++) {
                for (const pattern of patterns) {
                    const lower = pattern.toLowerCase().replace(/\s+/g, ' ').trim();
                    for (const { el, text } of entries) {
                        // Pass 0: exact match
                        if (pass === 0 && text !== lower) continue;
                        // Pass 1: starts-with match (allow small suffix like " (25)")
                        if (pass === 1 && (!text.startsWith(lower) || text.length > lower.length + 30)) continue;
                        // Pass 2: partial includes (original behavior)
                        if (pass === 2 && (!text.includes(lower) || text.length > lower.length * 8)) continue;

                        // Inline getBox logic
                        const rect = el.getBoundingClientRect();
                        if (el.tagName === 'INPUT') {
                            const label = el.closest('label');
                            if (label) {
                                const lr = label.getBoundingClientRect();
                                if (lr.width >= 5 && lr.height >= 5) {
                                    return { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
                                }
                            }
                            if (rect.width < 5 || rect.height < 5) continue;
                        }
                        if (rect.width < 5 || rect.height < 5) continue;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        if (parseFloat(style.opacity) < 0.1) continue;
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                }
            }
            return null;
        },
        { patterns: textPatterns, container: containerSelector ?? null, includeGeneric: includeGenericElements, strict: strictMatch },
    );
}

/**
 * Click intelligente: prova DOM text search → Playwright locator → Vision AI.
 * Usa humanMouseMove + page.mouse.click per sembrare un utente reale.
 */
async function smartClick(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
): Promise<void> {
    const targetX = box.x + box.width / 2 + (Math.random() * 4 - 2);
    const targetY = box.y + box.height / 2 + (Math.random() * 3 - 1.5);
    await humanMouseMoveToCoords(page, targetX, targetY);
    await pulseVisualCursorOverlay(page);
    // Disabilita overlay blocco → click → riabilita
    await pauseInputBlock(page);
    await page.mouse.click(targetX, targetY, { delay: 40 + Math.floor(Math.random() * 70) });
    await resumeInputBlock(page);
}

/** Wrapper per visionClick che disabilita l'overlay durante il click. */
async function safeVisionClick(
    page: Page,
    description: string,
    options?: Parameters<typeof visionClick>[2],
): Promise<void> {
    await pauseInputBlock(page);
    try {
        await visionClick(page, description, options);
    } finally {
        await resumeInputBlock(page);
    }
}

/**
 * Navigazione vision-guided verso le ricerche salvate di Sales Navigator.
 *
 * Funziona come un umano: guarda lo schermo, capisce dove cliccare, clicca.
 * Ogni step fa screenshot → AI analizza → click → verifica.
 *
 * Flusso:
 *   1. Vai alla home di Sales Navigator (/sales/home)
 *   2. AI trova e clicca "Search" / "Ricerca" nella barra di navigazione
 *   3. AI trova e clicca "Saved searches" / "Ricerche salvate"
 *   4. Verifica che i bottoni View/Visualizza siano apparsi
 *
 * Se un fast-path DOM riesce, lo usa; altrimenti l'AI prende il controllo.
 */
async function visionNavigationStep(
    page: Page,
    stepName: string,
    prompt: string,
    verifyFn: () => Promise<boolean>,
    domFallbackSelectors?: string[],
): Promise<boolean> {
    // Fast-path: prova selettori DOM prima di usare Vision AI
    if (domFallbackSelectors) {
        for (const sel of domFallbackSelectors) {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) > 0) {
                const box = await locatorBoundingBox(el);
                if (box) {
                    console.log(`[AI-NAV] ${stepName}: trovato via DOM (${sel})`);
                    await smartClick(page, box);
                } else {
                    await pauseInputBlock(page);
                    await el.click({ timeout: 5_000 }).catch(() => null);
                    await resumeInputBlock(page);
                }
                await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
                await humanDelay(page, 800, 1_500);
                if (await verifyFn()) return true;
            }
        }
    }

    // Vision AI: screenshot → analisi → click
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`[AI-NAV] ${stepName}: analizzo screenshot (tentativo ${attempt})...`);
            await visionClick(page, prompt, { retries: 2 });
            await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
            await humanDelay(page, 1_000, 2_000);
            await dismissTransientUi(page);

            if (await verifyFn()) {
                console.log(`[AI-NAV] ${stepName}: completato con successo`);
                return true;
            }
            console.log(`[AI-NAV] ${stepName}: click eseguito ma verifica fallita, riprovo...`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(`[AI-NAV] ${stepName}: tentativo ${attempt} fallito — ${msg}`);
        }
        await humanDelay(page, 500, 1_000);
    }

    return false;
}

async function navigateToSavedSearches(page: Page): Promise<void> {
    // Helper: siamo nell'area Sales Navigator? (URL deve contenere /sales/)
    const isOnSalesNav = (): boolean => page.url().toLowerCase().includes('/sales/');

    // Helper: verifica se siamo sulla pagina delle ricerche salvate
    // MUST be on /sales/ AND see View buttons — altrimenti falsi positivi sulla homepage LinkedIn
    const isOnSavedSearches = async (): Promise<boolean> => {
        const url = page.url().toLowerCase();
        if (!url.includes('/sales/')) return false;
        if (url.includes('/saved-searches') || url.includes('/saved_searches')) return true;
        const viewCount = await page.locator(VIEW_SAVED_SEARCH_SELECTOR).count().catch(() => 0);
        return viewCount > 0;
    };

    // Helper: verifica se siamo nella sezione Search di SalesNav
    const isOnSearchSection = async (): Promise<boolean> => {
        return page.url().toLowerCase().includes('/sales/search');
    };

    // ── Step 0: Vai alla home di Sales Navigator ──
    const salesNavHome = 'https://www.linkedin.com/sales/home';
    console.log('[AI-NAV] Step 1/3: navigazione alla home Sales Navigator...');
    await page.goto(salesNavHome, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissTransientUi(page);
    await humanDelay(page, 800, 1_500);

    // Controlla se LinkedIn ha chiesto il login (SalesNav può richiedere auth separata)
    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
        await waitForManualLogin(page, 'AI-NAV');
    }

    // Verifica che siamo effettivamente su SalesNav (non redirected a linkedin.com homepage)
    if (!isOnSalesNav()) {
        console.log(`[AI-NAV] Redirect fuori da Sales Navigator: ${page.url()}`);
        console.log('[AI-NAV] Possibile sessione scaduta o mancanza licenza Sales Navigator.');
        // Tentativo diretto con URL esplicito
        await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await dismissTransientUi(page);
        await humanDelay(page, 800, 1_500);

        // Ri-controlla login anche dopo il secondo tentativo
        if (!(await isLoggedIn(page))) {
            await waitForManualLogin(page, 'AI-NAV');
        }

        if (!isOnSalesNav()) {
            throw new Error(
                'Impossibile accedere a Sales Navigator. ' +
                'Verifica che la sessione LinkedIn sia attiva e che l\'account abbia una licenza Sales Navigator. ' +
                `URL attuale: ${page.url()}`,
            );
        }
    }

    // Se siamo già sulla pagina giusta, basta
    if (await isOnSavedSearches()) {
        console.log('[AI-NAV] Già sulla pagina delle ricerche salvate.');
        await humanDelay(page, 300, 600);
        return;
    }

    // ── Step 1: Dalla home SalesNav, trova e clicca "Search" / "Ricerca" ──
    const onSearch = await isOnSearchSection();
    if (!onSearch) {
        const searchOk = await visionNavigationStep(
            page,
            'Step 2/3: click su Search/Ricerca',
            'Look at the Sales Navigator interface. Find and click on the "Search" or "Ricerca" navigation link/button in the top navigation bar. It may be a dropdown or a direct link. Click on the main Search navigation item.',
            isOnSearchSection,
            [
                'a[href*="/sales/search"]',
                'a:has-text("Search")',
                'a:has-text("Ricerca")',
                'button:has-text("Search")',
                'nav a[href*="/search"]',
            ],
        );
        if (!searchOk) {
            console.log('[AI-NAV] Fallback: navigazione diretta a /sales/search/saved-searches...');
            await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await dismissTransientUi(page);
            await humanDelay(page, 800, 1_500);
        }
    }

    // Se dopo il click su Search siamo già sulle ricerche salvate, basta
    if (await isOnSavedSearches()) {
        console.log('[AI-NAV] Raggiunta pagina ricerche salvate dopo Search.');
        await humanDelay(page, 300, 600);
        return;
    }

    // ── Step 2: Trova e clicca "Saved searches" / "Ricerche salvate" ──
    const savedOk = await visionNavigationStep(
        page,
        'Step 3/3: click su Saved searches / Ricerche salvate',
        'Look at this LinkedIn Sales Navigator page. Find and click on "Saved searches", "Ricerche salvate", or any tab/link/button that leads to the list of previously saved searches. It might be a tab at the top of the search section, a sidebar link, or a dropdown option.',
        isOnSavedSearches,
        [
            'a:has-text("Saved searches")',
            'a:has-text("Ricerche salvate")',
            'button:has-text("Saved searches")',
            'button:has-text("Ricerche salvate")',
            '[role="tab"]:has-text("Saved searches")',
            '[role="tab"]:has-text("Ricerche salvate")',
            'a[href*="saved-searches"]',
            'a[href*="saved_searches"]',
        ],
    );

    if (!savedOk) {
        console.log('[AI-NAV] Tutti i tentativi falliti — provo URL diretto come ultimo tentativo...');
        await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await dismissTransientUi(page);
        await humanDelay(page, 800, 1_500);
    }

    // ── Step 3: Verifica finale — aspetta i bottoni View/Visualizza ──
    const viewReady = await page.locator(VIEW_SAVED_SEARCH_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true, () => false);

    if (!viewReady) {
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
        await dismissTransientUi(page);
        await humanDelay(page, 500, 1_000);
        console.log('[AI-NAV] Bottoni View non trovati dopo navigazione, URL:', page.url());
    } else {
        console.log('[AI-NAV] Ricerche salvate caricate — bottoni View visibili.');
        await humanDelay(page, 300, 600);
    }
}

export async function extractSavedSearches(page: Page): Promise<SavedSearchDescriptor[]> {
    // NOTE: No named const/function inside page.evaluate — tsx keepNames adds __name which breaks browser context
    const rows = await page.evaluate(() => {
        const viewControlRe = /^(view|view results|visualizza)$/i;
        const controls = Array.from(document.querySelectorAll('button, a')) as Array<HTMLButtonElement | HTMLAnchorElement>;
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

    if (dryRun) {
        return;
    }

    // Click diretto via DOM locator + humanMouseMove (no Vision AI necessaria,
    // il bottone è già identificato dal DOM con selettore esatto)
    const box = await locatorBoundingBox(button);
    if (box) {
        await smartClick(page, box);
    } else {
        // Fallback: click Playwright diretto
        await pauseInputBlock(page);
        await button.click();
        await resumeInputBlock(page);
    }

    await humanDelay(page, 800, 1_400);
    await page.waitForLoadState('domcontentloaded').catch((err) => {
        console.warn('[WARN] domcontentloaded timeout dopo click ricerca salvata:', err instanceof Error ? err.message : String(err));
    });
    // Overlays auto-injected via 'load' event

    const ready = await waitForSearchResultsReady(page, 18_000);
    if (!ready) {
        throw new Error(`Risultati non caricati per la ricerca "${search.name}"`);
    }
}

async function clickSelectAll(page: Page, dryRun: boolean): Promise<void> {
    if (dryRun) return;

    // Scroll in cima — "Select All" è nell'header dei risultati
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await humanDelay(page, 200, 400);

    console.log('[SELECT ALL] URL corrente:', page.url());
    let clicked = false;

    // Strategia 1: Ricerca per testo visibile (solo elementi interattivi: label, button, input)
    const selectAllTexts = ['select all', 'seleziona tutto', 'seleziona tutti'];
    const textBox = await findVisibleClickTarget(page, selectAllTexts);
    if (textBox) {
        console.log(`[SELECT ALL] Strategia 1 OK: testo trovato a (${Math.round(textBox.x)},${Math.round(textBox.y)}) ${Math.round(textBox.width)}x${Math.round(textBox.height)}`);
        await smartClick(page, textBox);
        clicked = true;
    } else {
        console.log('[SELECT ALL] Strategia 1 SKIP: nessun elemento interattivo con testo "select all"');
    }

    // Strategia 2: Playwright locator con selettori espansi (label, checkbox, input)
    if (!clicked) {
        const locator = page.locator(SELECT_ALL_SELECTOR).first();
        const found = await hasLocator(locator);
        const box = found ? await locatorBoundingBox(locator) : null;
        if (box && box.width > 3 && box.height > 3) {
            console.log(`[SELECT ALL] Strategia 2 OK: locator CSS a (${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)}`);
            await smartClick(page, box);
            clicked = true;
        } else {
            console.log(`[SELECT ALL] Strategia 2 SKIP: locator trovato=${found}, box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'null'}`);
        }
    }

    // Strategia 3: Playwright getByRole (gestisce checkbox nascosti nativamente)
    if (!clicked) {
        const checkbox = page.getByRole('checkbox', { name: /select all|seleziona tutt/i }).first();
        const count = await checkbox.count();
        if (count > 0) {
            const box = await locatorBoundingBox(checkbox);
            if (box && box.width > 3) {
                console.log(`[SELECT ALL] Strategia 3 OK: getByRole checkbox a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
            } else {
                console.log('[SELECT ALL] Strategia 3: checkbox hidden, force click');
                await checkbox.check({ force: true });
            }
            clicked = true;
        } else {
            console.log('[SELECT ALL] Strategia 3 SKIP: nessun checkbox trovato via getByRole');
        }
    }

    // Strategia 4: Vision AI — ultimo resort
    if (!clicked) {
        console.log('[SELECT ALL] Strategia 4: invoco Vision AI (GPT-4o)...');
        await safeVisionClick(page, 'the checkbox or control to select all leads on this page. Look for a small checkbox at the top of the results list, usually labeled "Select all" or showing a count like "(25)"', {
            retries: 3,
            postClickDelayMs: 850,
        });
        clicked = true;
        console.log('[SELECT ALL] Strategia 4 OK: Vision AI click eseguito');
    }

    await humanDelay(page, 350, 700);

    // Verifica: il bottone "Save to list" dovrebbe apparire dopo Select All
    const saveVisible = await page.locator(SAVE_TO_LIST_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true, () => false);
    if (!saveVisible) {
        const saveBox = await findVisibleClickTarget(page, ['save to list', "salva nell'elenco"]);
        if (!saveBox) {
            console.log('[SELECT ALL] WARN: "Save to list" non visibile dopo click. Riprovo con force click...');
            const fallback = page.getByRole('checkbox', { name: /select all|seleziona tutt/i }).first();
            if ((await fallback.count()) > 0) {
                await fallback.check({ force: true });
                await humanDelay(page, 400, 700);
            }
        } else {
            console.log('[SELECT ALL] OK: "Save to list" trovato via testo');
        }
    } else {
        console.log('[SELECT ALL] OK: "Save to list" visibile');
    }
}

async function openSaveToListDialog(page: Page, dryRun: boolean): Promise<void> {
    if (dryRun) return;

    // Attendi che il bottone "Save to list" appaia (toolbar batch actions)
    await page.locator(SAVE_TO_LIST_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => null);

    let clicked = false;
    const saveTexts = ['save to list', "salva nell'elenco", 'salva in elenco', "aggiungi all'elenco"];

    // Strategia 1: Ricerca per testo visibile
    const textBox = await findVisibleClickTarget(page, saveTexts);
    if (textBox) {
        console.log(`[SAVE TO LIST] Strategia 1 OK: testo trovato a (${Math.round(textBox.x)},${Math.round(textBox.y)})`);
        await smartClick(page, textBox);
        clicked = true;
    }

    // Strategia 2: Playwright locator
    if (!clicked) {
        const locator = page.locator(SAVE_TO_LIST_SELECTOR).first();
        const box = (await hasLocator(locator)) ? await locatorBoundingBox(locator) : null;
        if (box) {
            console.log(`[SAVE TO LIST] Strategia 2 OK: locator CSS`);
            await smartClick(page, box);
            clicked = true;
        }
    }

    // Strategia 3: getByRole button
    if (!clicked) {
        const btn = page.getByRole('button', { name: /save to list|salva nell.elenco|aggiungi all.elenco/i }).first();
        if ((await btn.count()) > 0) {
            const box = await locatorBoundingBox(btn);
            if (box) {
                console.log('[SAVE TO LIST] Strategia 3 OK: getByRole button');
                await smartClick(page, box);
            } else {
                console.log('[SAVE TO LIST] Strategia 3: button hidden, force click');
                await btn.click({ force: true });
            }
            clicked = true;
        }
    }

    // Strategia 4: Vision AI
    if (!clicked) {
        console.log('[SAVE TO LIST] Strategia 4: Vision AI...');
        await safeVisionClick(page, 'button labeled "Save to list" or "Salva nell\'elenco"', {
            retries: 3,
            postClickDelayMs: 900,
        });
    }

    await humanDelay(page, 300, 600);

    // Verifica: il dialog deve aprirsi
    const dialogLocator = page.locator(DIALOG_SELECTOR).first();
    const dialogVisible = await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).then(
        () => true,
        () => false,
    );
    if (!dialogVisible) {
        console.log('[SAVE TO LIST] Dialog non aperto via DOM — controllo Vision...');
        const ready = await visionWaitFor(page, 'the save to list dialog is open and list options are visible', 10_000);
        if (!ready) {
            throw new Error('Dialog Save to list non aperto');
        }
    } else {
        console.log('[SAVE TO LIST] OK: dialog aperto');
    }
}

/** Verifica il toast LinkedIn post-save: controlla che menzioni la lista target. */
async function verifyToast(page: Page, targetListName: string): Promise<void> {
    await humanDelay(page, 500, 800);
    const toastText = await page.evaluate(() => {
        const toast = document.querySelector(
            '.artdeco-toast-item, [class*="toast"], [role="alert"], [class*="notification"]',
        );
        return toast ? (toast as HTMLElement).innerText.trim() : '';
    }).catch(() => '');

    if (toastText) {
        const toastLower = toastText.toLowerCase();
        const targetLower = targetListName.toLowerCase();
        if (toastLower.includes('saved') || toastLower.includes('salvat') || toastLower.includes('elenco') || toastLower.includes('list')) {
            const targetWords = targetLower.split(/[\s,]+/).filter(w => w.length > 2);
            const matchedWords = targetWords.filter(w => toastLower.includes(w));
            if (matchedWords.length >= Math.min(2, targetWords.length)) {
                console.log(`[CHOOSE LIST] ✓ Toast conferma: "${toastText}"`);
            } else {
                console.error(`[CHOOSE LIST] ⚠️ TOAST MISMATCH: "${toastText}" — target era "${targetListName}"`);
                console.error(`[CHOOSE LIST] ⚠️ Parole matchate: [${matchedWords.join(', ')}] su [${targetWords.join(', ')}]`);
            }
        }
    }
}

async function chooseTargetList(page: Page, targetListName: string, dryRun: boolean): Promise<void> {
    const dialogLocator = page.locator(DIALOG_SELECTOR).first();

    if (dryRun) {
        const clip =
            (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
            undefined;
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

    const dialogContainerSelector = DIALOG_SELECTOR.split(', ')[0];
    console.log(`[CHOOSE LIST] Cerco "${targetListName}" nel dialog...`);

    // ── Strategia 0 (PRIMARIA): GPT-5.4 Computer Use ──
    // Il modello vede lo screenshot del dialog e decide autonomamente dove cliccare.
    const apiKey = (() => {
        try {
            const { config: cfg } = require('../config') as typeof import('../config');
            return cfg.openaiApiKey;
        } catch { return ''; }
    })();
    if (apiKey) {
        console.log('[CHOOSE LIST] Strategia 0: GPT-5.4 Computer Use...');
        const cuResult = await computerUseSelectList(page, targetListName);
        if (cuResult.success) {
            console.log(`[CHOOSE LIST] ✓ Computer Use OK: ${cuResult.turns} turns, ${cuResult.totalActions} azioni`);
            if (cuResult.lastResponseText) {
                console.log(`[CHOOSE LIST] Modello: "${cuResult.lastResponseText.substring(0, 120)}"`);
            }
            // Verifica post-CU: il dialog si è chiuso? (la lista è stata selezionata e confermata)
            const cuDialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 4_000 }).then(
                () => true,
                () => false,
            );
            if (cuDialogClosed) {
                console.log('[CHOOSE LIST] ✓ Dialog chiusa — Computer Use ha completato tutto');
                // Toast verification
                await verifyToast(page, targetListName);
                return;
            }
            // Dialog ancora aperta — il modello potrebbe aver selezionato ma non confermato
            // Proviamo a confermare con click su Save/Salva
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                console.log('[CHOOSE LIST] ✓ Computer Use + confirm button');
                await verifyToast(page, targetListName);
                return;
            }
        } else {
            console.warn(`[CHOOSE LIST] Computer Use fallito: ${cuResult.error ?? 'sconosciuto'} — fallback a DOM strategies`);
        }
    }

    // ── Helper: legge il testo dell'elemento evidenziato/selezionato nel dialog ──
    async function readSelectedListText(): Promise<string> {
        return page.evaluate((containerSel: string) => {
            const root = document.querySelector(containerSel) ?? document;
            // Look for highlighted/selected/active list items
            const selectors = [
                '[aria-selected="true"]',
                '[aria-checked="true"]',
                '.artdeco-entity-lockup--active',
                '.active',
                '.selected',
                '[class*="highlight"]',
                '[class*="selected"]',
                'li[class*="active"]',
            ];
            for (const sel of selectors) {
                const el = root.querySelector(sel);
                if (el) {
                    return (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
                }
            }
            return '';
        }, dialogContainerSelector).catch(() => '');
    }

    // ── Helper: verifica con Vision AI che la lista clickata sia quella giusta ──
    async function visionVerifySelectedList(): Promise<boolean> {
        const clip =
            (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
            undefined;
        const prompt = `Look at this dialog. Is the list "${targetListName}" currently selected or highlighted? Answer only YES or NO.`;
        const result = await visionVerify(page, prompt, clip ? { clip } : undefined);
        return result;
    }

    // ── Attempt loop: up to 2 attempts ──
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            console.warn(`[CHOOSE LIST] Tentativo ${attempt}/${MAX_ATTEMPTS}...`);
        }

        let clicked = false;

        // Strategia 1 (PRIORITARIA): digita il nome COMPLETO nel campo ricerca per filtrare
        const searchInput = dialogLocator.locator('input[type="text"], input[type="search"], input[placeholder*="Search"], input[placeholder*="Cerca"]').first();
        if ((await searchInput.count()) > 0) {
            console.log('[CHOOSE LIST] Strategia 1: filtro via campo ricerca (STRICT match)...');
            await searchInput.fill('');
            await humanDelay(page, 100, 200);
            await searchInput.type(targetListName, { delay: 25 + Math.floor(Math.random() * 20) });
            await humanDelay(page, 800, 1_200);

            // Strict match: exact or starts-with only
            let box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
            if (box) {
                console.log(`[CHOOSE LIST] Strategia 1 STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
                clicked = true;
            } else {
                // Fallback: partial name search but still strict match
                console.log('[CHOOSE LIST] Strategia 1: strict fallita, provo ricerca parziale...');
                await searchInput.fill('');
                await humanDelay(page, 100, 200);
                const partialName = targetListName.substring(0, Math.min(25, targetListName.length));
                await searchInput.type(partialName, { delay: 30 + Math.floor(Math.random() * 20) });
                await humanDelay(page, 800, 1_200);
                box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
                if (box) {
                    console.log(`[CHOOSE LIST] Strategia 1b STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                    await smartClick(page, box);
                    clicked = true;
                }
            }
        }

        // Strategia 2: Cerca con strict match diretto (senza campo ricerca)
        if (!clicked) {
            const box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
            if (box) {
                console.log(`[CHOOSE LIST] Strategia 2 STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
                clicked = true;
            }
        }

        // Strategia 3: Scrolla dentro il dialog con strict match
        if (!clicked) {
            await page.evaluate((selector: string) => {
                const dialog = document.querySelector(selector);
                if (!dialog) return;
                const scrollable = dialog.querySelector('.artdeco-modal__content, [style*="overflow"], [class*="scroll"]') ?? dialog;
                (scrollable as HTMLElement).scrollTop = 0;
            }, dialogContainerSelector);
            await humanDelay(page, 150, 300);

            for (let scroll = 0; scroll < 15 && !clicked; scroll++) {
                const box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
                if (box) {
                    console.log(`[CHOOSE LIST] Strategia 3 STRICT OK (scroll ${scroll}) a (${Math.round(box.x)},${Math.round(box.y)})`);
                    await smartClick(page, box);
                    clicked = true;
                    break;
                }
                await page.evaluate((selector: string) => {
                    const dialog = document.querySelector(selector);
                    if (!dialog) return;
                    const scrollable = dialog.querySelector('.artdeco-modal__content, [style*="overflow"], [class*="scroll"]') ?? dialog;
                    (scrollable as HTMLElement).scrollTop += 250;
                }, dialogContainerSelector);
                await humanDelay(page, 150, 250);
            }
        }

        // Strategia 4: Vision AI — click mirato con nome esatto
        if (!clicked) {
            console.log('[CHOOSE LIST] Strategia 4: Vision AI click...');
            const clip =
                (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
                undefined;
            await safeVisionClick(
                page,
                `click EXACTLY on the list named "${targetListName}" inside the save dialog. Do NOT click any other list.`,
                {
                    clip,
                    locator: (await hasLocator(dialogLocator)) ? dialogLocator : undefined,
                    retries: 2,
                    postClickDelayMs: 1_100,
                },
            );
        }

        await humanDelay(page, 300, 600);

        // ── POST-CLICK VERIFICATION ──
        // Step 1: Read DOM to see what was selected
        const selectedText = await readSelectedListText();
        if (selectedText) {
            const selLower = selectedText.toLowerCase().replace(/\s+/g, ' ').trim();
            const tgtLower = targetListName.toLowerCase().replace(/\s+/g, ' ').trim();
            if (selLower.includes(tgtLower) || tgtLower.includes(selLower.substring(0, 20))) {
                console.log(`[CHOOSE LIST] ✓ Verifica DOM OK: selezionato "${selectedText}"`);
            } else {
                console.error(`[CHOOSE LIST] ✗ Verifica DOM FALLITA: selezionato "${selectedText}" ma target era "${targetListName}"`);
                if (attempt < MAX_ATTEMPTS) {
                    console.warn('[CHOOSE LIST] ABORT — chiudo dialog e riprovo...');
                    await page.keyboard.press('Escape');
                    await humanDelay(page, 500, 800);
                    // Re-open the dialog
                    const saveBtn = page.locator(SAVE_TO_LIST_SELECTOR).first();
                    if (await hasLocator(saveBtn)) {
                        const box = await locatorBoundingBox(saveBtn);
                        if (box) await smartClick(page, box);
                        await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => { });
                        await humanDelay(page, 300, 500);
                    }
                    continue; // Retry
                }
            }
        }

        // Step 2: Vision AI verification (only if DOM check was inconclusive)
        if (!selectedText) {
            const visionOk = await visionVerifySelectedList();
            if (!visionOk) {
                console.error(`[CHOOSE LIST] ✗ Vision AI: lista "${targetListName}" NON sembra selezionata`);
                if (attempt < MAX_ATTEMPTS) {
                    console.warn('[CHOOSE LIST] ABORT — chiudo dialog e riprovo...');
                    await page.keyboard.press('Escape');
                    await humanDelay(page, 500, 800);
                    const saveBtn = page.locator(SAVE_TO_LIST_SELECTOR).first();
                    if (await hasLocator(saveBtn)) {
                        const box = await locatorBoundingBox(saveBtn);
                        if (box) await smartClick(page, box);
                        await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => { });
                        await humanDelay(page, 300, 500);
                    }
                    continue; // Retry
                }
                console.error('[CHOOSE LIST] ⚠️ ATTENZIONE: proseguo ma la lista potrebbe essere SBAGLIATA');
            } else {
                console.log(`[CHOOSE LIST] ✓ Vision AI conferma lista "${targetListName}" selezionata`);
            }
        }

        // ── CONFIRM: chiudi il dialog ──
        const dialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 6_000 }).then(
            () => true,
            () => false,
        );
        if (!dialogClosed) {
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
            } else {
                await page.keyboard.press('Escape');
                await humanDelay(page, 300, 500);
                const stillOpen = await dialogLocator.isVisible().catch(() => false);
                if (stillOpen) {
                    const ready = await visionWaitFor(
                        page,
                        'the save to list dialog is closed and the search results page is visible again',
                        8_000,
                    );
                    if (!ready) {
                        throw new Error(`Dialog Save to list non chiusa dopo la selezione di "${targetListName}"`);
                    }
                }
            }
        }

        // ── TOAST VERIFICATION ──
        await verifyToast(page, targetListName);

        // Success — exit the attempt loop
        break;
    }
}

/**
 * Reads current page number and total pages from the SalesNav pagination bar.
 * Returns { current, total } or null if pagination cannot be read.
 */
async function readPaginationInfo(page: Page): Promise<{ current: number; total: number } | null> {
    try {
        const info = await page.evaluate(() => {
            // Strategy 1: Artdeco pagination — look for active page button + last page button
            const paginationContainer =
                document.querySelector('.artdeco-pagination') ??
                document.querySelector('nav[aria-label*="pagination" i]') ??
                document.querySelector('[class*="search-results__pagination"]') ??
                document.querySelector('ol.artdeco-pagination__pages');
            if (paginationContainer) {
                const buttons = Array.from(
                    paginationContainer.querySelectorAll<HTMLButtonElement | HTMLLIElement>(
                        'button[aria-label], li[data-test-pagination-page-btn]',
                    ),
                );
                const activeBtn =
                    paginationContainer.querySelector<HTMLButtonElement>(
                        'button[aria-current="true"], button.active, li.active button, li.selected button',
                    );
                const currentFromActive = activeBtn
                    ? parseInt((activeBtn.textContent ?? '').trim(), 10)
                    : NaN;

                // Collect all visible page numbers
                const pageNumbers: number[] = [];
                for (const btn of buttons) {
                    const num = parseInt((btn.textContent ?? '').trim(), 10);
                    if (!isNaN(num) && num > 0) pageNumbers.push(num);
                }
                if (pageNumbers.length > 0) {
                    const maxPage = Math.max(...pageNumbers);
                    const current = !isNaN(currentFromActive) ? currentFromActive : 1;
                    return { current, total: maxPage };
                }
            }

            // Strategy 2: Text pattern "Page X of Y" / "Pagina X di Y" / "X – Y of Z results"
            const bodyText = document.body.innerText || '';
            const pageOfMatch = bodyText.match(/(?:page|pagina)\s+(\d+)\s+(?:of|di)\s+(\d+)/i);
            if (pageOfMatch) {
                return { current: parseInt(pageOfMatch[1], 10), total: parseInt(pageOfMatch[2], 10) };
            }

            // Strategy 3: "X–Y of Z results" → derive page count (25 per page)
            const rangeMatch = bodyText.match(/(\d+)\s*[–\-]\s*(\d+)\s+(?:of|di|su)\s+(\d[\d,.]*)\s*(?:results|risultat)/i);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const totalResults = parseInt(rangeMatch[3].replace(/[,.\s]/g, ''), 10);
                const perPage = 25;
                const current = Math.ceil(start / perPage);
                const total = Math.ceil(totalResults / perPage);
                return { current: current || 1, total: total || 1 };
            }

            return null;
        });
        return info;
    } catch {
        return null;
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

    if (dryRun) {
        return true;
    }

    // Leggi la pagina corrente PRIMA del click per verificare che cambi davvero
    const pageBefore = await readPaginationInfo(page);

    // Scrolla il bottone Next nel viewport — la paginazione è in fondo al container
    await nextButton.scrollIntoViewIfNeeded().catch(() => { });
    await humanDelay(page, 300, 500);

    const clip =
        (await buildClipAroundLocator(page, nextButton, { top: 40, right: 160, bottom: 40, left: 220 })) ?? undefined;

    const box = (await hasLocator(nextButton)) ? await locatorBoundingBox(nextButton) : null;
    if (box) {
        await smartClick(page, box);
    } else {
        await safeVisionClick(page, 'pagination button labeled "Next" or "Avanti"', {
            clip,
            retries: 3,
            postClickDelayMs: 1_000,
        });
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch((err) => {
        console.warn('[WARN] networkidle timeout dopo click Next:', err instanceof Error ? err.message : String(err));
    });
    await humanDelay(page, 1000, 2_000);

    // Verifica che la pagina sia effettivamente cambiata
    const pageAfter = await readPaginationInfo(page);
    if (pageBefore && pageAfter && pageAfter.current <= pageBefore.current) {
        console.warn(`[WARN] Click Next non ha cambiato pagina (prima: ${pageBefore.current}, dopo: ${pageAfter.current}). Riprovo con click diretto...`);
        // Fallback: click diretto con force
        await nextButton.click({ force: true }).catch(() => { });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { });
        await humanDelay(page, 1000, 2_000);
    }
    return true;
}

/**
 * Scroll umano dell'intera pagina dei risultati con velocità variabile:
 *   - Fase "scan veloce": scroll ampi, pause brevi (come chi scorre cercando qualcosa)
 *   - Fase "lettura": rallenta quando trova nuovi lead (come chi si ferma a leggere)
 *   - Micro-pause casuali: 15% chance di pausa lunga "distrazione"
 *   - Burst scroll: occasionalmente 2-3 scroll rapidi consecutivi
 *
 * Garantisce il rendering lazy di SalesNav accumulando gli ID in un Set globale.
 * Restituisce il numero di lead card trovate nel DOM dopo lo scroll completo.
 */
export async function scrollAndReadPage(page: Page): Promise<number> {
    const viewport = page.viewportSize() ?? { width: 1400, height: 900 };

    // Set globale per accumulare ID lead (il virtual scroller rimuove card fuori viewport)
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__collectedLeadIds = new Set<string>();
    });

    const collectVisibleLeads = async (): Promise<number> => {
        return page.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
            const w = window as unknown as Record<string, unknown>;
            const collected = w.__collectedLeadIds as Set<string>;
            for (const a of anchors) {
                const href = a.getAttribute('href') ?? '';
                const id = href.match(/\/(lead|people)\/([^,/?]+)/)?.[2];
                if (id) collected.add(id);
            }
            return collected.size;
        });
    };

    // Posiziona mouse nell'area risultati
    const mouseX = Math.round(viewport.width * 0.6);
    const mouseY = Math.round(viewport.height * 0.4);
    await page.mouse.move(mouseX, mouseY);
    await page.waitForTimeout(100 + Math.floor(Math.random() * 150));

    const initialCount = await collectVisibleLeads();

    // Trova container scrollabile (SalesNav usa div interno, non body)
    const scrollContainerInfo = await page.evaluate(() => {
        const allElements = document.querySelectorAll('div, main, section, [role="main"]');
        let bestContainer: HTMLElement | null = null;
        let bestDiff = 0;
        for (const el of allElements) {
            const htmlEl = el as HTMLElement;
            const diff = htmlEl.scrollHeight - htmlEl.clientHeight;
            if (diff > 50 && diff > bestDiff) {
                const hasLeads = htmlEl.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
                if (hasLeads) {
                    bestContainer = htmlEl;
                    bestDiff = diff;
                }
            }
        }
        if (bestContainer) {
            bestContainer.setAttribute('data-scroll-target', 'true');
            return {
                found: true,
                scrollHeight: bestContainer.scrollHeight,
                clientHeight: bestContainer.clientHeight,
                overflow: bestDiff,
            };
        }
        return { found: false, scrollHeight: 0, clientHeight: 0, overflow: 0 };
    });

    console.log(
        `[SCROLL] Container: ${scrollContainerInfo.found ? 'OK' : 'body'}` +
        ` | overflow=${scrollContainerInfo.overflow}px | Lead iniziali: ${initialCount}`,
    );

    // ── Scroll con velocità variabile ──
    const MAX_STEPS = 20;
    let noNewLeadsCount = 0;

    // Funzione di scroll singola (container o wheel)
    const doScroll = async (delta: number): Promise<void> => {
        if (scrollContainerInfo.found) {
            await page.evaluate((d: number) => {
                const container = document.querySelector('[data-scroll-target="true"]');
                if (container) (container as HTMLElement).scrollTop += d;
            }, delta);
        } else {
            await page.mouse.wheel(0, delta);
        }
    };

    for (let i = 0; i < MAX_STEPS; i++) {
        const countBefore = await collectVisibleLeads();

        // ── Decide il "ritmo" di questo step ──
        const roll = Math.random();

        if (roll < 0.25) {
            // 25%: BURST — 2-3 scroll rapidi consecutivi (come chi scorre veloce cercando)
            const burstCount = 2 + Math.floor(Math.random() * 2);
            for (let b = 0; b < burstCount; b++) {
                const delta = 400 + Math.floor(Math.random() * 250);
                await doScroll(delta);
                await page.waitForTimeout(60 + Math.floor(Math.random() * 60));
            }
            await page.waitForTimeout(120 + Math.floor(Math.random() * 150));
        } else if (roll < 0.33) {
            // 8%: PAUSA BREVE — scroll piccolo, poi pausa (come chi si ferma un attimo)
            const delta = 200 + Math.floor(Math.random() * 150);
            await doScroll(delta);
            await page.waitForTimeout(600 + Math.floor(Math.random() * 600));
        } else {
            // 67%: SCROLL NORMALE — delta variabile, pausa breve
            const delta = 300 + Math.floor(Math.random() * 200);
            await doScroll(delta);
            await page.waitForTimeout(140 + Math.floor(Math.random() * 120));
        }

        // Controlla skeleton/loader solo ogni 4 step (non ad ogni step — troppo lento)
        if (i % 4 === 3) {
            await page.waitForFunction(
                () => !document.querySelector('.artdeco-loader, [class*="skeleton"], [class*="ghost"]'),
                { timeout: 1_500 },
            ).catch(() => { });
        }

        const countAfter = await collectVisibleLeads();

        if (countAfter > countBefore) {
            // Nuovi lead trovati — rallenta leggermente (come chi "nota" il contenuto)
            console.log(`[SCROLL] Step ${i + 1}: ${countAfter} lead (+${countAfter - countBefore})`);
            await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
            noNewLeadsCount = 0;
        } else {
            noNewLeadsCount++;
            if (noNewLeadsCount >= 3) break; // Fine contenuto
        }

        // Micro-movimento mouse occasionale (20%)
        if (Math.random() < 0.20) {
            const jitterX = mouseX + Math.floor(Math.random() * 80 - 40);
            const jitterY = mouseY + Math.floor(Math.random() * 50 - 25);
            await page.mouse.move(jitterX, jitterY);
        }
    }

    // Cleanup marker
    await page.evaluate(() => {
        const el = document.querySelector('[data-scroll-target="true"]');
        if (el) el.removeAttribute('data-scroll-target');
    }).catch(() => { });

    // Leggi totale accumulato
    const leadCount = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const collected = w.__collectedLeadIds as Set<string>;
        const count = collected.size;
        delete w.__collectedLeadIds;
        return count;
    });

    // Torna in cima — usa scrollTop diretto se abbiamo il container, altrimenti wheel rapido
    if (scrollContainerInfo.found) {
        await page.evaluate(() => {
            const container = document.querySelector('[data-scroll-target="true"]');
            if (container) (container as HTMLElement).scrollTop = 0;
            window.scrollTo({ top: 0 });
        });
    } else {
        // Wheel veloce su (meno step del vecchio codice)
        for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, -800);
            await page.waitForTimeout(30);
        }
    }
    await page.waitForTimeout(200 + Math.floor(Math.random() * 200));

    return leadCount;
}

async function prepareResultsPage(page: Page): Promise<void> {
    // Scroll veloce in cima — "Select All" è nell'header dei risultati
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    // Micro-scroll occasionale per sembrare umano (30% delle volte)
    if (Math.random() < 0.3) {
        await humanDelay(page, 100, 300);
        const dy = 60 + Math.random() * 150;
        await page.evaluate((d: number) => window.scrollBy({ top: d, behavior: 'smooth' }), dy);
        await humanDelay(page, 150, 350);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    await humanDelay(page, 200, 450);
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
    // Chiudi eventuali dialog/popup
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(200).catch(() => null);

    // Dismiss "Continua nel browser" / mobile app prompt (se presente)
    const continueBtn = page.locator('a:has-text("Continua nel browser"), a:has-text("Continue in browser"), button:has-text("Continua nel browser"), button:has-text("Continue in browser")').first();
    if ((await continueBtn.count().catch(() => 0)) > 0) {
        console.log('[UI] Dismissing mobile app prompt...');
        await pauseInputBlock(page);
        await continueBtn.click({ timeout: 3_000 }).catch(() => null);
        await resumeInputBlock(page);
        await page.waitForTimeout(500).catch(() => null);
    }
}

/**
 * AI-powered anomaly check: l'AI analizza la pagina e rileva segnali di allarme.
 * Controlla banner sospetti, rate-limit warnings, restrizioni account.
 * Restituisce true se è sicuro procedere, false se bisogna fermarsi.
 */
async function aiCheckPageHealth(page: Page): Promise<{ safe: boolean; warning: string | null }> {
    try {
        const response = await visionRead(
            page,
            'Analyze this LinkedIn page. Check for ANY of these warning signals:\n' +
            '- Rate limiting messages ("too fast", "limite raggiunto", "slow down")\n' +
            '- Account restriction or suspension notices\n' +
            '- CAPTCHA or security verification overlays\n' +
            '- Error pages or "something went wrong" messages\n' +
            '- Unusual banners blocking normal content\n\n' +
            'If EVERYTHING looks normal (search results, lead cards visible), respond: "OK"\n' +
            'If you see ANY warning signal, respond: "WARNING: [brief description]"',
        );
        if (response.toUpperCase().startsWith('OK')) {
            return { safe: true, warning: null };
        }
        return { safe: false, warning: response };
    } catch {
        // Se la vision fallisce, assumi safe e continua
        return { safe: true, warning: null };
    }
}

async function runAntiDetectionNoise(page: Page, totalProcessedPages: number): Promise<void> {
    // Movimento mouse leggero (40% delle volte) — basso impatto
    if (Math.random() < 0.4) {
        await randomMouseMove(page);
    }
    // Micro-pausa occasionale (5% → 1-3s)
    if (Math.random() < 0.05) {
        await humanDelay(page, 1_000, 3_000);
    }
    // Decoy browsing ogni ~18 pagine — meno aggressivo, niente tab switch
    if (totalProcessedPages > 0 && totalProcessedPages % 18 === 0) {
        const returnUrl = page.url();
        await performDecoyAction(page);
        await page.goto(returnUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await humanDelay(page, 600, 1_200);
        await waitForSearchResultsReady(page, 12_000);
    }

    // AI contextual delay: l'AI decide quanto aspettare basandosi sulla complessità della pagina.
    // Ogni ~5 pagine usa vision per una pausa più intelligente (evita overhead costante).
    if (totalProcessedPages > 0 && totalProcessedPages % 5 === 0) {
        try {
            const aiDelay = await visionContextualDelay(page);
            console.log(`[AI] Pausa contestuale: ${Math.round(aiDelay / 1000)}s`);
            await page.waitForTimeout(aiDelay);
        } catch {
            // Fallback a delay standard se vision non disponibile
            await humanDelay(page, 2_000, 4_000);
        }
    }
}

async function processSearchPage(page: Page, targetListName: string, dryRun: boolean): Promise<void> {
    await ensureNoChallenge(page);
    await prepareResultsPage(page);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            // Dismiss any leftover dialog/popup from a previous attempt
            if (attempt > 0) {
                await dismissTransientUi(page);
                await humanDelay(page, 250, 500);
            }
            await clickSelectAll(page, dryRun);
            await ensureNoChallenge(page);
            await openSaveToListDialog(page, dryRun);
            await chooseTargetList(page, targetListName, dryRun);
            await ensureNoChallenge(page);
            return;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (error instanceof ChallengeDetectedError) throw error;
            console.log(`[RETRY] Tentativo ${attempt + 1}/3 fallito: ${lastError.message}`);

            if (attempt === 1) {
                // Solo al 2° fallimento: reload come ultima risorsa
                console.log('[RETRY] Ricarico pagina come fallback...');
                await dismissTransientUi(page);
                await humanDelay(page, 300, 600);
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await waitForSearchResultsReady(page, 15_000);
                await humanDelay(page, 300, 500);
            }
        }
    }
    throw lastError ?? new Error('processSearchPage fallito dopo 3 tentativi');
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

/**
 * Pre-sync: scarica i membri attuali della lista target da LinkedIn e li salva nel DB.
 * DEVE essere il PRIMO step del workflow — prima di andare alle ricerche salvate.
 *
 * Flusso AI-guided (come un umano):
 *   1. Vai alla home Sales Navigator
 *   2. Naviga alla sezione Lead Lists (DOM fast-path → Vision AI fallback)
 *   3. Trova la lista target per nome e cliccaci
 *   4. Pagina per pagina: scroll umano → estrai profili → salva nel DB
 *
 * Senza questo step il DB sarebbe vuoto alla prima esecuzione e il bot
 * ri-salverebbe tutti i lead che sono già nella lista.
 */
async function preSyncListToDb(
    page: Page,
    targetListName: string,
): Promise<{ synced: number; total: number; listUrl: string | null }> {
    console.log(`\n[PRE-SYNC] ======================================================`);
    console.log(`[PRE-SYNC] FASE 1: Scarico membri della lista "${targetListName}"`);
    console.log(`[PRE-SYNC] ======================================================\n`);

    // ── Step 1: Assicurati di essere su Sales Navigator ──
    const isOnSalesNav = (): boolean => page.url().toLowerCase().includes('/sales/');

    if (!isOnSalesNav()) {
        console.log('[PRE-SYNC] Step 1: Navigazione alla home Sales Navigator...');
        await page.goto('https://www.linkedin.com/sales/home', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await dismissTransientUi(page);
        await humanDelay(page, 800, 1_500);

        // Controlla se LinkedIn ha chiesto il login — aspetta che l'utente lo faccia
        if (!(await isLoggedIn(page))) {
            await waitForManualLogin(page, 'PRE-SYNC');
        }

        if (!isOnSalesNav()) {
            console.log(`[PRE-SYNC] Non su Sales Navigator (URL: ${page.url()}) — procedo senza pre-sync`);
            return { synced: 0, total: 0, listUrl: null };
        }
    }

    // ── Step 2: Naviga alla pagina degli elenchi lead ──
    console.log('[PRE-SYNC] Step 2/4: Navigazione alla sezione Lead Lists...');

    const isOnListsPage = (): boolean => page.url().toLowerCase().includes('/sales/lists/people');

    const listsPageOk = await visionNavigationStep(
        page,
        'Pre-sync: click su Lists/Elenchi',
        'In the Sales Navigator interface, find and click on "Lists" or "Lead lists" or "Elenchi" or "Elenchi lead" in the left sidebar or top navigation bar. Look for a section that shows your saved lead lists. It might be under a "Leads" dropdown menu or in the sidebar.',
        async () => isOnListsPage(),
        [
            'a[href*="/sales/lists/people"]',
            'a:has-text("Lists")',
            'a:has-text("Elenchi")',
            'a:has-text("Lead lists")',
            'a:has-text("Elenchi lead")',
            'nav a[href*="/lists"]',
        ],
    );

    if (!listsPageOk) {
        // Fallback: navigazione diretta
        console.log('[PRE-SYNC] Vision/DOM navigation fallita — provo URL diretto...');
        await page.goto('https://www.linkedin.com/sales/lists/people/', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await dismissTransientUi(page);
        await humanDelay(page, 1_500, 2_500);
    }

    // Wait for list links to appear in DOM (non usare networkidle — SalesNav non lo raggiunge mai)
    await page.waitForSelector('a[href*="/sales/lists/people/"]', { timeout: 20_000 }).catch(() => {
        console.warn('[WARN] Nessun link lista trovato nel DOM entro 20s — procedo comunque');
    });
    // Re-inject __name shim after navigation (new page context)
    await reInjectOverlays(page);
    await humanDelay(page, 800, 1_500);

    console.log(`[PRE-SYNC] URL corrente: ${page.url()}`);

    // ── Step 3: Trova e clicca la lista target (GPT-5.4 Computer Use) ──
    console.log(`[PRE-SYNC] Step 3/4: Cerco la lista "${targetListName}"...`);

    const urlBefore = page.url();
    let listClicked = false;

    // Strategia primaria: GPT-5.4 Computer Use — il modello vede, clicca, e verifica da solo
    const cuApiKey = (() => {
        try {
            const { config: cfg } = require('../config') as typeof import('../config');
            return cfg.openaiApiKey;
        } catch { return ''; }
    })();
    if (cuApiKey) {
        console.log('[PRE-SYNC] Computer Use: GPT-5.4 cerca e apre la lista...');
        const { computerUseTask } = require('./computerUse') as typeof import('./computerUse');
        const cuResult = await computerUseTask(
            page,
            `You are on a LinkedIn Sales Navigator page showing a list of Lead Lists. ` +
            `Find the list named "${targetListName}" and click on it to OPEN it. ` +
            `The list name should be a clickable link — click directly on the text of the list name. ` +
            `After clicking, verify that the page changed to show the list's members/leads. ` +
            `If the page did NOT change (same URL, no lead profiles visible), it means you clicked in the wrong spot. ` +
            `Try clicking directly on the list name text link instead. ` +
            `If the list is not visible, scroll down to find it. ` +
            `The current URL is: ${page.url()}. After opening the list, the URL should change to include a list ID.`,
            { maxTurns: 10 },
        );

        if (cuResult.success) {
            // Verifica: l'URL è cambiato? (la lista si è aperta)
            const urlAfter = page.url();
            if (urlAfter !== urlBefore && /\/sales\/lists\/people\/\w+/.test(urlAfter)) {
                console.log(`[PRE-SYNC] ✓ Computer Use ha aperto la lista: ${urlAfter}`);
                listClicked = true;
            } else {
                console.warn(`[PRE-SYNC] Computer Use completato ma URL non cambiato (${urlAfter})`);
            }
        } else {
            console.warn(`[PRE-SYNC] Computer Use fallito: ${cuResult.error ?? 'sconosciuto'}`);
        }
    }

    // Fallback DOM: se Computer Use non disponibile o fallito
    if (!listClicked) {
        console.log('[PRE-SYNC] Fallback: cerco la lista via DOM...');
        const nameVariants = [targetListName];
        if (targetListName.length > 25) nameVariants.push(targetListName.substring(0, 25));
        if (targetListName.length > 15) nameVariants.push(targetListName.substring(0, 15));

        // Cerca link <a> con href /sales/lists/people/ che contenga il nome
        const listLink = await page.evaluate((variants: string[]) => {
            const anchors = Array.from(
                document.querySelectorAll('a[href*="/sales/lists/people/"]'),
            ) as HTMLAnchorElement[];
            for (const anchor of anchors) {
                const text = (anchor.innerText || anchor.textContent || '').trim().toLowerCase();
                const container = anchor.closest('li, article, tr, div') as HTMLElement | null;
                const containerText = (container?.innerText || '').trim().toLowerCase();
                for (const variant of variants) {
                    const lower = variant.toLowerCase();
                    if (text.includes(lower) || containerText.includes(lower)) {
                        const rect = anchor.getBoundingClientRect();
                        if (rect.width > 5 && rect.height > 5) {
                            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                        }
                    }
                }
            }
            return null;
        }, nameVariants);

        if (listLink) {
            console.log('[PRE-SYNC] Lista trovata via anchor DOM');
            await smartClick(page, listLink);
            listClicked = true;
        }
    }

    if (!listClicked) {
        console.warn(`[PRE-SYNC] ATTENZIONE: Impossibile trovare/aprire la lista "${targetListName}"`);
        console.warn(`[PRE-SYNC] URL corrente: ${page.url()}`);
        console.warn('[PRE-SYNC] Il dedup si baserà solo sui dati già presenti nel DB.\n');
        return { synced: 0, total: 0, listUrl: null };
    }

    // Wait for list page to load
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch((err) => {
        console.warn('[WARN] domcontentloaded timeout dopo click lista:', err instanceof Error ? err.message : String(err));
    });
    await humanDelay(page, 1_500, 2_500);
    await dismissTransientUi(page);

    const listUrl = page.url();
    console.log(`[PRE-SYNC] Lista aperta: ${listUrl}`);

    // ── Step 4: Scrapa tutti i membri pagina per pagina ──
    console.log('[PRE-SYNC] Step 4/4: Scansione di tutti i membri della lista...\n');

    let totalInserted = 0;
    let totalExtracted = 0;
    const maxPreSyncPages = 200; // cap a 5000 lead (200 * 25)

    for (let pageNum = 1; pageNum <= maxPreSyncPages; pageNum++) {
        // Scroll umano per caricare tutte le card nella pagina (lazy rendering)
        await scrollAndReadPage(page);

        // Estrai profili con il modulo dedup (stessi dati usati per il confronto successivo)
        const profiles = await extractProfileUrlsFromPage(page);
        totalExtracted += profiles.length;

        if (profiles.length === 0 && pageNum === 1) {
            console.log('[PRE-SYNC] Nessun profilo trovato nella prima pagina — lista vuota o DOM diverso');
            break;
        }

        if (profiles.length === 0) {
            console.log(`[PRE-SYNC] Pagina ${pageNum}: 0 profili — fine lista`);
            break;
        }

        // Salva nel DB usando saveExtractedProfiles (stessa logica del bulk save)
        // runId=0 identifica i dati inseriti dal pre-sync
        const inserted = await saveExtractedProfiles(
            targetListName,
            profiles,
            0,         // runId = 0 per pre-sync
            0,         // searchIndex = 0
            pageNum,
        );
        totalInserted += inserted;

        // Log progress con paginazione
        const paginationInfo = await readPaginationInfo(page);
        const pageLabel = paginationInfo
            ? `${paginationInfo.current}/${paginationInfo.total}`
            : `${pageNum}`;
        console.log(
            `[PRE-SYNC] Pagina ${pageLabel}: ${profiles.length} profili estratti, ${inserted} nuovi nel DB`,
        );

        // Ultima pagina?
        if (paginationInfo && paginationInfo.current >= paginationInfo.total) {
            break;
        }

        // Prossima pagina
        if (!(await hasNextPage(page))) {
            break;
        }
        const moved = await clickNextPage(page, false);
        if (!moved) {
            break;
        }

        // Pausa umana tra le pagine
        await humanDelay(page, 600, 1_200);
        await dismissTransientUi(page);
    }

    console.log(
        `\n[PRE-SYNC] Completato: ${totalInserted} nuovi membri nel DB` +
        ` su ${totalExtracted} totali estratti\n`,
    );

    return { synced: totalInserted, total: totalExtracted, listUrl };
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
        // Inject __name shim + overlays immediately on current page
        await reInjectOverlays(page);
        // Auto re-inject overlays on every page load — elimina flash e "automazione in corso" ripetuto
        page.on('load', () => { void reInjectOverlays(page).catch(() => null); });

        // ── PRE-SYNC: scarica i membri attuali della lista target dal sito e salvali nel DB ──
        // Così il dedup funziona anche al primo run o se i lead sono stati aggiunti manualmente.
        if (!dryRun) {
            const preSync = await preSyncListToDb(page, options.targetListName);
            if (preSync.synced > 0) {
                console.log(`[PRE-SYNC] DB aggiornato con ${preSync.synced} membri — il dedup è ora affidabile.\n`);
            } else if (preSync.listUrl === null) {
                console.warn(`[PRE-SYNC] ATTENZIONE: lista "${options.targetListName}" non trovata su LinkedIn — dedup potrebbe essere incompleto.\n`);
            }
        }

        await navigateToSavedSearches(page);
        await ensureNoChallenge(page);

        const discoveredSearches = await extractSavedSearches(page);
        report.searchesDiscovered = discoveredSearches.length;
        console.log(`[SEARCH] Ricerche salvate trovate: ${discoveredSearches.length}, URL: ${page.url()}`);

        // Logga i nomi di tutte le ricerche trovate — fondamentale per il debug
        if (discoveredSearches.length > 0) {
            console.log('[SEARCH] Elenco ricerche:');
            for (const s of discoveredSearches) {
                console.log(`  ${s.index + 1}. "${s.name}"`);
            }
        }

        if (discoveredSearches.length === 0) {
            const currentUrl = page.url().toLowerCase();
            const bodyText = ((await page.locator('body').textContent().catch(() => '')) ?? '').toLowerCase();
            console.log(`[SEARCH] Page body sample: "${bodyText.substring(0, 200)}"`);
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

        // Match ricerca: esatto → contiene → contenuto in
        let filteredSearches: SavedSearchDescriptor[] = [];
        if (normalizedRequestedSearchName.length > 0) {
            // 1. Match esatto (normalizzato)
            filteredSearches = discoveredSearches.filter(
                (search) => normalizeSearchName(search.name) === normalizedRequestedSearchName,
            );
            // 2. Fuzzy: il nome della ricerca contiene la query
            if (filteredSearches.length === 0) {
                filteredSearches = discoveredSearches.filter(
                    (search) => normalizeSearchName(search.name).includes(normalizedRequestedSearchName),
                );
                if (filteredSearches.length > 0) {
                    console.log(`[SEARCH] Match fuzzy (contiene "${options.searchName}"):`);
                    for (const s of filteredSearches) {
                        console.log(`  → "${s.name}"`);
                    }
                }
            }
            // 3. Fuzzy: la query contiene il nome della ricerca
            if (filteredSearches.length === 0) {
                filteredSearches = discoveredSearches.filter(
                    (search) => normalizedRequestedSearchName.includes(normalizeSearchName(search.name)),
                );
                if (filteredSearches.length > 0) {
                    console.log(`[SEARCH] Match fuzzy (contenuto in "${options.searchName}"):`);
                    for (const s of filteredSearches) {
                        console.log(`  → "${s.name}"`);
                    }
                }
            }
        } else {
            filteredSearches = discoveredSearches;
        }

        if (normalizedRequestedSearchName.length > 0 && filteredSearches.length === 0) {
            throw new Error(
                `Ricerca salvata non trovata: "${options.searchName}". ` +
                `Ricerche disponibili: ${discoveredSearches.map((s) => `"${s.name}"`).join(', ')}`,
            );
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

            // Log di contesto: piano di lavoro per questa ricerca
            const totalResultsLabel = searchReport.totalResultsDetected !== null
                ? `${searchReport.totalResultsDetected} risultati (≈${Math.ceil(searchReport.totalResultsDetected / 25)} pagine)`
                : `pagine stimate: max ${searchMaxPages}`;
            console.log(
                `\n[RICERCA] "${search.name}" — ${totalResultsLabel}` +
                ` — partenza da pagina ${initialPageNumber}` +
                ` — limite: ${searchMaxPages} pagine` +
                ` — lista target: "${options.targetListName}"`,
            );

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

                // ── FASE 0: AI health check — ogni 3 pagine l'AI verifica che non ci siano segnali sospetti ──
                if (pageNumber > 1 && (pageNumber - 1) % 3 === 0) {
                    const healthCheck = await aiCheckPageHealth(page);
                    if (!healthCheck.safe) {
                        console.log(`[AI-WARN] Segnale sospetto rilevato: ${healthCheck.warning}`);
                        console.log('[AI-WARN] Rallento e faccio pausa lunga per sicurezza...');
                        await humanDelay(page, 8_000, 15_000);
                        // Ricontrolla dopo la pausa
                        await ensureNoChallenge(page);
                    }
                }

                // ── FASE 1: Leggi paginazione ──
                const paginationInfo = await readPaginationInfo(page);
                const totalPagesDetected = paginationInfo?.total ?? searchMaxPages;
                const currentDisplayPage = paginationInfo?.current ?? pageNumber;
                const remaining = Math.max(0, totalPagesDetected - currentDisplayPage);

                // ── FASE 2: Scroll umano — "leggi" tutta la pagina come farebbe un umano ──
                // Questo carica tutte le lead card nel DOM (lazy rendering) e sembra naturale
                const leadsOnPage = await scrollAndReadPage(page);
                console.log(
                    `[PAGE] Pagina ${currentDisplayPage}/${totalPagesDetected}` +
                    ` — ${leadsOnPage} lead trovati dopo scroll` +
                    (remaining > 0 ? ` — ${remaining} pagine rimanenti` : ' — ultima pagina'),
                );

                // ── FASE 3: Estrai profili dal DOM e confronta col DB ──
                const extractedProfiles = await extractProfileUrlsFromPage(page);
                const dedupResult = await checkDuplicates(options.targetListName, extractedProfiles);
                const allSavedInDb = extractedProfiles.length > 0 && dedupResult.newProfiles === 0;

                console.log(
                    `[ANALISI] ${extractedProfiles.length} profili estratti` +
                    ` — ${dedupResult.newProfiles} nuovi, ${dedupResult.alreadySaved} già nel DB` +
                    (dedupResult.fuzzyWarnings > 0 ? `, ${dedupResult.fuzzyWarnings} fuzzy match` : ''),
                );

                // Log dettagliato dei primi profili estratti (max 5)
                const sampleSize = Math.min(extractedProfiles.length, 5);
                for (let pi = 0; pi < sampleSize; pi++) {
                    const p = extractedProfiles[pi];
                    console.log(
                        `  [${pi + 1}] ${p.firstName} ${p.lastName}` +
                        (p.title ? ` | ${p.title}` : '') +
                        (p.company ? ` @ ${p.company}` : '') +
                        (p.location ? ` | ${p.location}` : '') +
                        (p.linkedinUrl ? ` | ${p.linkedinUrl}` : ''),
                    );
                }
                if (extractedProfiles.length > sampleSize) {
                    console.log(`  ... e altri ${extractedProfiles.length - sampleSize} profili`);
                }

                // ── FASE 4: Decisione — skip o salva ──
                if (allSavedInDb) {
                    console.log(
                        `[SKIP] Pagina ${currentDisplayPage}: tutti i ${dedupResult.alreadySaved} lead sono già nella lista "${options.targetListName}" — passo alla prossima`,
                    );
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

                    // Determina se continuare o fermarsi
                    if (totalPagesDetected <= 1 || remaining <= 0) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — tutte le ${totalPagesDetected} pagine controllate.`);
                        break;
                    }
                    if (pageNumber >= searchMaxPages) {
                        console.log(`[DONE] Ricerca "${search.name}" — raggiunto limite max pagine (${searchMaxPages}).`);
                        break;
                    }
                    // Verifica che esista un bottone Next prima di cliccare
                    const nextAvailable = await hasNextPage(page);
                    if (!nextAvailable) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — nessun bottone Next (${totalPagesDetected} pagine totali).`);
                        break;
                    }
                    const movedSkip = await clickNextPage(page, false);
                    if (!movedSkip) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — Next non cliccabile.`);
                        break;
                    }
                    continue;
                }

                // ── FASE 5: Ci sono lead nuovi — seleziona tutto e salva nella lista ──
                console.log(
                    `[SAVE] Pagina ${currentDisplayPage}: ${dedupResult.newProfiles} lead nuovi da salvare nella lista "${options.targetListName}"`,
                );

                try {
                    await processSearchPage(page, options.targetListName, false);

                    // DB writes in parallelo — non bloccare la UI
                    const dbWrites: Promise<unknown>[] = [];
                    if (run && extractedProfiles.length > 0) {
                        dbWrites.push(
                            saveExtractedProfiles(
                                options.targetListName,
                                extractedProfiles,
                                run.id,
                                absoluteIndex,
                                pageNumber,
                            ).catch((e: unknown) => console.error('[DB] saveExtractedProfiles error:', e)),
                        );
                    }
                    if (run) {
                        dbWrites.push(
                            addSyncItem({
                                runId: run.id,
                                searchIndex: absoluteIndex,
                                pageNumber,
                                leadsOnPage,
                                status: 'SUCCESS',
                            }).catch((e: unknown) => console.error('[DB] addSyncItem error:', e)),
                        );
                    }
                    // Fire DB writes — await them later (before next page)
                    const dbWritePromise = dbWrites.length > 0 ? Promise.all(dbWrites) : null;

                    report.pagesProcessed += 1;
                    report.totalLeadsSaved += dedupResult.newProfiles;
                    searchReport.processedPages += 1;
                    searchReport.leadsSaved += dedupResult.newProfiles;
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

                    // Attendi DB writes prima di procedere
                    if (dbWritePromise) await dbWritePromise;

                    await ensureNoChallenge(page);
                    await runAntiDetectionNoise(page, report.pagesProcessed);

                    // Check if we've reached the last page
                    if (totalPagesDetected <= 1 || remaining <= 0) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — tutte le pagine processate.`);
                        break;
                    }
                    if (pageNumber >= searchMaxPages) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — raggiunto limite max pagine (${searchMaxPages}).`);
                        break;
                    }
                    const moved = await clickNextPage(page, false);
                    if (!moved) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — nessun bottone Next disponibile.`);
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

        // Final summary log
        console.log(
            `\n[SUMMARY] Stato: ${report.status}` +
            ` | Ricerche: ${report.searchesProcessed}/${report.searchesPlanned}` +
            ` | Pagine processate: ${report.pagesProcessed}` +
            ` | Pagine skippate (già nel DB): ${report.pagesSkippedAllSaved}` +
            ` | Lead salvati: ${report.totalLeadsSaved}` +
            (report.lastError ? ` | Errore: ${report.lastError.substring(0, 120)}` : ''),
        );
    }

    return report;
}
