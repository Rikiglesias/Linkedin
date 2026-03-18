import type { Page } from 'playwright';
import { createHash } from 'crypto';
import {
    detectChallenge,
    dismissKnownOverlays,
    humanDelay,
    isLoggedIn,
    randomMouseMove,
} from '../browser';
import { config } from '../config';
import { cleanText } from '../utils/text';
import { attemptChallengeResolution } from '../workers/challengeHandler';
import { pauseInputBlock, resumeInputBlock, humanMouseMoveToCoords, removeAllOverlays, releaseMouseConfinement } from '../browser/humanBehavior';
import {
    isPageClosedError,
    getSafeMaxSearches,
    getSafeSessionLimit,
    hasLocator,
    locatorBoundingBox,
    buildClipAroundLocator,
    reInjectOverlays,
    smartClick,
    safeVisionClick,
    findVisibleClickTarget,
    getViewButtonLocator,
    setInputBlockSuspended,
} from './bulkSaveHelpers';
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
    visionRead,
    visionReadTotalResults,
    visionVerify,
    visionWaitFor,
} from './visionNavigator';
import { checkDuplicates, extractProfileUrlsFromPage, saveExtractedProfiles } from './salesnavDedup';
import { computerUseSelectList, computerUseTask } from './computerUse';
// listScraper: navigateToSavedLists/scrapeLeadsFromSalesNavList non piu' usati — pre-sync usa vision-guided navigation
import {
    SALESNAV_NEXT_PAGE_SELECTOR as NEXT_PAGE_SELECTOR,
    SALESNAV_SELECT_ALL_SELECTOR as SELECT_ALL_SELECTOR,
    SALESNAV_SAVE_TO_LIST_SELECTOR as SAVE_TO_LIST_SELECTOR,
    SALESNAV_DIALOG_SELECTOR as DIALOG_SELECTOR,
} from './selectors';

export const SEARCHES_URL = 'https://www.linkedin.com/sales/search/saved-searches';

// _inputBlockSuspended state managed by bulkSaveHelpers.ts (setInputBlockSuspended/isInputBlockSuspended)

// Traccia se la lista target è già stata usata in questa sessione di bulk save.
// Dopo il primo save riuscito, skip digitazione nome lista → click diretto (come un umano esperto).
let _bulkSaveListFoundInSession = false;

// Guard: evita registrazione multipla del page.on('load') handler sulla stessa Page.
// Senza questo, ogni chiamata a runSalesNavBulkSave accumula handler → N re-inject per load.
const _loadHandlerRegistered = new WeakSet<Page>();

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

    // Sospendi l'input blocker globalmente — impedisce che reInjectOverlays lo riattivi.
    // DEVE essere PRIMA di removeAllOverlays: così il page.on('load') non ri-inietta durante la rimozione.
    setInputBlockSuspended(page, true);
    await pauseInputBlock(page);

    // Rimuovi completamente TUTTI gli overlay dal DOM usando gli ID dinamici corretti.
    // removeAllOverlays conosce gli ID generati da crypto.randomBytes (a differenza di ID hardcoded).
    // Rimuove: stile cursor:none, classe root, cursore visuale, input block, toast.
    await removeAllOverlays(page);
    releaseMouseConfinement();

    console.warn(`[${context}] Sessione scaduta — in attesa del login manuale nel browser...`);
    console.warn(`[${context}] URL: ${page.url()}`);
    console.warn(`[${context}] Hai 3 minuti per completare il login.`);

    try {
        while (Date.now() - startTime < MAX_WAIT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            try {
                if (await isLoggedIn(page)) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    console.log(`[${context}] Login completato dopo ${elapsed}s. Riprendo...`);
                    // Attendi che la pagina post-login si stabilizzi
                    await humanDelay(page, 2000, 3000);
                    return;
                }
            } catch {
                // isLoggedIn può fallire durante navigazione/reload — ignora e riprova
            }
            const remaining = Math.round((MAX_WAIT_MS - (Date.now() - startTime)) / 1000);
            console.log(`[${context}] Ancora in attesa del login... (${remaining}s rimanenti)`);
        }

        throw new Error(
            `Timeout: login manuale non completato entro 3 minuti. URL: ${page.url()}`,
        );
    } finally {
        setInputBlockSuspended(page, false);
        // Re-inject overlays COMPLETAMENTE — la pagina è cambiata durante il login
        await reInjectOverlays(page).catch(() => { });
        await dismissKnownOverlays(page).catch(() => { });
        console.log(`[${context}] Overlay e input-block riattivati.`);
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


function normalizeSearchName(value: string | null | undefined): string {
    return cleanText(value).toLowerCase();
}

// Le seguenti funzioni sono state consolidate in ./bulkSaveHelpers.ts:
// isPageClosedError, clampNumber, getSafeMaxSearches, getSafeSessionLimit,
// getViewButtonLocator, hasLocator, locatorBoundingBox, buildClipFromBox,
// buildClipAroundLocator, reInjectOverlays, findVisibleClickTarget,
// smartClick, safeVisionClick, visionNavigationStep


async function navigateToSavedSearches(page: Page): Promise<void> {
    // Helper: siamo nell'area Sales Navigator? (URL deve contenere /sales/)
    const isOnSalesNav = (): boolean => page.url().toLowerCase().includes('/sales/');

    // Helper: verifica se siamo sulla pagina delle ricerche salvate
    // MUST be on /sales/search AND see View buttons — /sales/home ha bottoni "Visualizza" per alert/raccomandazioni
    const isOnSavedSearches = async (): Promise<boolean> => {
        const url = page.url().toLowerCase();
        if (!url.includes('/sales/')) return false;
        if (url.includes('/saved-searches') || url.includes('/saved_searches')) return true;
        // Solo su /sales/search* i bottoni View indicano ricerche salvate (non sulla home)
        if (!url.includes('/sales/search')) return false;
        const viewCount = await page.locator(VIEW_SAVED_SEARCH_SELECTOR).count().catch(() => 0);
        return viewCount > 0;
    };

    // Helper: verifica se siamo nella sezione Search di SalesNav
    const isOnSearchSection = async (): Promise<boolean> => {
        return page.url().toLowerCase().includes('/sales/search');
    };

    // Fast-exit: se siamo GIÀ sulla pagina delle ricerche salvate, non navigare via
    // (nel loop ricerche, dopo la prima iterazione siamo già qui)
    if (await isOnSavedSearches()) {
        console.log('[AI-NAV] Già sulla pagina delle ricerche salvate (skip navigazione).');
        await humanDelay(page, 200, 400);
        return;
    }

    // ── Step 0: Vai alla home di Sales Navigator ──
    const salesNavHome = 'https://www.linkedin.com/sales/home';
    console.log('[AI-NAV] Step 1/3: navigazione alla home Sales Navigator...');
    await page.goto(salesNavHome, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissTransientUi(page);
    await humanDelay(page, 800, 1_500);

    // Controlla se LinkedIn ha chiesto il login.
    // IMPORTANTE: check URL PRIMA di isLoggedIn. La pagina /sales/login ha cookie
    // LinkedIn validi (isLoggedIn → true) ma la sessione SalesNav è scaduta.
    const onLoginPage = page.url().toLowerCase().includes('/sales/login');
    const loggedIn = onLoginPage ? false : await isLoggedIn(page);
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
        const onLoginPage2 = page.url().toLowerCase().includes('/sales/login');
        if (onLoginPage2 || !(await isLoggedIn(page))) {
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

    // ── Step 1: Dalla home SalesNav, naviga a Search (DOM-first, URL fallback) ──
    // Vision AI NON usata qui — GPT-5.4 restituisce null sistematicamente per "Search"
    // in SalesNav (il link è dentro un dropdown/nav non standard). DOM + URL diretto è
    // affidabile al 100% e istantaneo.
    const onSearch = await isOnSearchSection();
    if (!onSearch) {
        console.log('[AI-NAV] Step 2/3: click su Search/Ricerca (DOM-first)...');
        let searchClicked = false;

        // Prova selettori DOM in ordine di affidabilità
        const searchSelectors = [
            'a[href*="/sales/search"]',
            'a:has-text("Search")',
            'a:has-text("Ricerca")',
            'button:has-text("Search")',
            'nav a[href*="/search"]',
        ];
        for (const sel of searchSelectors) {
            const locator = page.locator(sel).first();
            if ((await locator.count().catch(() => 0)) > 0) {
                const box = await locator.boundingBox().catch(() => null);
                if (box && box.width > 3 && box.height > 3) {
                    console.log(`[AI-NAV] Search trovata via DOM: ${sel}`);
                    await smartClick(page, box);
                    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
                    await humanDelay(page, 800, 1_500);
                    searchClicked = true;
                    break;
                }
            }
        }

        if (!searchClicked || !(await isOnSearchSection())) {
            console.log('[AI-NAV] DOM fallback: navigazione diretta a /sales/search/saved-searches...');
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

    // ── Step 2: Trova e clicca "Saved searches" / "Ricerche salvate" (DOM-first) ──
    console.log('[AI-NAV] Step 3/3: click su Saved searches (DOM-first)...');
    let savedClicked = false;
    const savedSelectors = [
        'a[href*="saved-searches"]',
        'a[href*="saved_searches"]',
        'a:has-text("Saved searches")',
        'a:has-text("Ricerche salvate")',
        'button:has-text("Saved searches")',
        'button:has-text("Ricerche salvate")',
        '[role="tab"]:has-text("Saved searches")',
        '[role="tab"]:has-text("Ricerche salvate")',
    ];
    for (const sel of savedSelectors) {
        const locator = page.locator(sel).first();
        if ((await locator.count().catch(() => 0)) > 0) {
            const box = await locator.boundingBox().catch(() => null);
            if (box && box.width > 3 && box.height > 3) {
                console.log(`[AI-NAV] Saved searches trovata via DOM: ${sel}`);
                await smartClick(page, box);
                await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
                await humanDelay(page, 800, 1_500);
                savedClicked = true;
                break;
            }
        }
    }

    if (!savedClicked || !(await isOnSavedSearches())) {
        console.log('[AI-NAV] URL diretto come fallback...');
        await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await dismissTransientUi(page);
        await humanDelay(page, 800, 1_500);
    }

    // ── Step 3: Verifica finale — aspetta i bottoni View/Visualizza ──
    const viewReady = await page.locator(VIEW_SAVED_SEARCH_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true, () => false);

    if (!viewReady) {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => null);
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
        // Fallback: click Playwright diretto
        await pauseInputBlock(page);
        try {
            await button.click({ timeout: 5_000 });
        } finally {
            await resumeInputBlock(page);
        }
    }

    await humanDelay(page, 800, 1_400);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch((err) => {
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
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => null);

    let clicked = false;
    // Tutti i testi possibili EN + IT (compresi sinonimi e varianti SalesNav)
    const saveTexts = [
        'save to list', "salva nell'elenco", 'salva nella lista',
        'salva in elenco', "aggiungi all'elenco", 'aggiungi alla lista', 'salva',
    ];

    // Strategia 1+2+3 in parallelo: testo visibile + locator CSS + getByRole
    const btnLocator = page.getByRole('button', {
        name: /save to list|salva nell.elenco|salva nella lista|salva in elenco|aggiungi all.elenco|aggiungi alla lista|^salva$/i,
    }).first();
    const [textBox, locatorBox, roleBox] = await Promise.all([
        findVisibleClickTarget(page, saveTexts),
        (async () => {
            const locator = page.locator(SAVE_TO_LIST_SELECTOR).first();
            return (await hasLocator(locator)) ? locatorBoundingBox(locator) : null;
        })(),
        (async () => {
            return (await btnLocator.count()) > 0 ? locatorBoundingBox(btnLocator) : null;
        })(),
    ]);

    if (textBox) {
        console.log(`[SAVE TO LIST] Strategia 1 OK: testo trovato a (${Math.round(textBox.x)},${Math.round(textBox.y)})`);
        await smartClick(page, textBox);
        clicked = true;
    } else if (locatorBox) {
        console.log('[SAVE TO LIST] Strategia 2 OK: locator CSS');
        await smartClick(page, locatorBox);
        clicked = true;
    } else if (roleBox) {
        console.log('[SAVE TO LIST] Strategia 3 OK: getByRole button');
        await smartClick(page, roleBox);
        clicked = true;
    } else if ((await btnLocator.count()) > 0) {
        console.log('[SAVE TO LIST] Strategia 3: button hidden, force click');
        const hiddenBox = await btnLocator.boundingBox().catch(() => null);
        if (hiddenBox) {
            await humanMouseMoveToCoords(page, hiddenBox.x + hiddenBox.width / 2, hiddenBox.y + hiddenBox.height / 2);
        }
        await btnLocator.click({ force: true });
        clicked = true;
    }

    // Strategia 4: Vision AI (chiede in entrambe le lingue)
    if (!clicked) {
        console.log('[SAVE TO LIST] Strategia 4: Vision AI...');
        await safeVisionClick(
            page,
            'button labeled "Save to list" or "Salva nell\'elenco" or "Salva nella lista" or "Aggiungi all\'elenco"',
            { retries: 3, postClickDelayMs: 900 },
        );
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
    console.log(`[CHOOSE LIST] Cerco "${targetListName}" nel dialog...${_bulkSaveListFoundInSession ? ' (fast path: lista già usata)' : ''}`);

    // ── Fast path: se la lista è già stata usata in questa sessione, prova click diretto ──
    // Un umano esperto che fa bulk save ripetitivo NON riscrive il nome ogni volta.
    // La lista è in cima al dialog (recente) → click diretto.
    // Se la lista ha già la checkbox selezionata (aria-checked/aria-selected), basta confermare.
    if (_bulkSaveListFoundInSession) {
        // Check se la lista è GIÀ selezionata (checkbox checked) → nessun click necessario
        const alreadySelected = await page.evaluate(({ container, name }: { container: string; name: string }) => {
            const root = document.querySelector(container) ?? document;
            const items = root.querySelectorAll('[aria-selected="true"], [aria-checked="true"], input:checked');
            for (const item of items) {
                const text = (item.closest('li, label, [role="option"]') ?? item).textContent?.toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
                if (text.includes(name.toLowerCase())) return true;
            }
            return false;
        }, { container: dialogContainerSelector, name: targetListName }).catch(() => false);

        if (alreadySelected) {
            console.log('[CHOOSE LIST] Fast path: lista già selezionata — confermo');
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                await verifyToast(page, targetListName);
                return;
            }
        }

        const directBox = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
        if (directBox) {
            console.log(`[CHOOSE LIST] Fast path OK: click diretto a (${Math.round(directBox.x)},${Math.round(directBox.y)})`);
            await smartClick(page, directBox);
            await humanDelay(page, 300, 600);

            // Verifica e chiudi dialog
            const fastDialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 6_000 }).then(
                () => true,
                () => false,
            );
            if (fastDialogClosed) {
                await verifyToast(page, targetListName);
                return;
            }
            // Dialog ancora aperta → prova conferma
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                await verifyToast(page, targetListName);
                return;
            }
            // Fast path non ha chiuso il dialog → fall through alle strategie normali
            console.log('[CHOOSE LIST] Fast path: dialog non chiusa, fallback a strategie standard...');
        }
    }

    // ── Strategia 0 (PRIMARIA): GPT-5.4 Computer Use ──
    // Il modello vede lo screenshot del dialog e decide autonomamente dove cliccare.
    if (config.openaiApiKey) {
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
            // Mouse move umano sull'input prima di digitare
            const inputBox = await searchInput.boundingBox().catch(() => null);
            if (inputBox) {
                await humanMouseMoveToCoords(page, inputBox.x + inputBox.width / 2 + (Math.random() * 6 - 3), inputBox.y + inputBox.height / 2 + (Math.random() * 4 - 2));
            }
            await searchInput.click();
            await humanDelay(page, 150, 300);
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
                // Mouse move umano sull'input per il retry parziale
                const retryBox = await searchInput.boundingBox().catch(() => null);
                if (retryBox) {
                    await humanMouseMoveToCoords(page, retryBox.x + retryBox.width / 2 + (Math.random() * 6 - 3), retryBox.y + retryBox.height / 2 + (Math.random() * 4 - 2));
                }
                await searchInput.click();
                await humanDelay(page, 100, 200);
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

        // Segna la lista come usata — dalla prossima pagina usa fast path (click diretto)
        _bulkSaveListFoundInSession = true;

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
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 600, 1_200);

    // Verifica che la pagina sia effettivamente cambiata
    const pageAfter = await readPaginationInfo(page);
    if (pageBefore && pageAfter && pageAfter.current <= pageBefore.current) {
        console.warn(`[WARN] Click Next non ha cambiato pagina (prima: ${pageBefore.current}, dopo: ${pageAfter.current}). Riprovo con click diretto...`);
        // Fallback: click diretto con force
        await nextButton.click({ force: true }).catch(() => { });
        // domcontentloaded (non networkidle — SalesNav ha WebSocket permanente)
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => { });
        await humanDelay(page, 600, 1_200);
    }

    // Attendi che le card lead appaiano nel DOM (lazy rendering post-navigazione).
    // Senza questo, scrollAndReadPage inizia prima che le card siano renderizzate.
    await page.waitForSelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]', { timeout: 8_000 }).catch(() => null);

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
 * Restituisce il numero di lead card trovate e i profili raccolti durante lo scroll.
 * I profili sono raccolti DURANTE lo scroll per evitare che il virtual scroller
 * distrugga le card dopo scroll-to-top (desync con extractProfileUrlsFromPage).
 */
export interface ScrollCollectedProfile {
    leadId: string;
    firstName: string;
    lastName: string;
    linkedinUrl: string;
    title?: string;
    company?: string;
    location?: string;
}

export interface ScrollResult {
    count: number;
    profiles: ScrollCollectedProfile[];
}

export async function scrollAndReadPage(page: Page, fast: boolean = false): Promise<ScrollResult> {
    const viewport = page.viewportSize() ?? { width: 1400, height: 900 };

    // Accumula profili lead lato Node (NON lato browser — evita fingerprint window.__collectedLeadIds)
    const collectedLeadIds = new Set<string>();
    const collectedProfiles = new Map<string, ScrollCollectedProfile>();

    const collectVisibleLeads = async (): Promise<number> => {
        const profiles = await page.evaluate(() => {
            const results: Array<{
                leadId: string; firstName: string; lastName: string;
                linkedinUrl: string; title?: string; company?: string; location?: string;
            }> = [];
            const anchors = document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
            for (const a of anchors) {
                const href = a.getAttribute('href') ?? '';
                const id = href.match(/\/(lead|people)\/([^,/?]+)/)?.[2];
                if (!id) continue;
                // Risali al container card per estrarre dati
                const card = a.closest('li, article, [data-x--lead-card]') ?? a.parentElement;
                const nameText = a.textContent?.trim() ?? '';
                const parts = nameText.split(/\s+/);
                const firstName = parts[0] ?? '';
                const lastName = parts.slice(1).join(' ') ?? '';
                // Title e company dai sibling/child span
                const subtitleEl = card?.querySelector('[class*="subtitle"], [class*="body-text"]');
                const subtitle = subtitleEl?.textContent?.trim() ?? '';
                const [title, company] = subtitle.includes(' at ') ? subtitle.split(' at ') :
                    subtitle.includes(' @ ') ? subtitle.split(' @ ') :
                    subtitle.includes(' presso ') ? subtitle.split(' presso ') : [subtitle, ''];
                const locationEl = card?.querySelector('[class*="location"], [class*="geo"]');
                const location = locationEl?.textContent?.trim() ?? undefined;
                results.push({
                    leadId: id, firstName, lastName,
                    linkedinUrl: href.startsWith('/') ? `https://www.linkedin.com${href.split('?')[0]}` : href,
                    title: title?.trim() || undefined,
                    company: company?.trim() || undefined,
                    location,
                });
            }
            return results;
        });
        for (const p of profiles) {
            collectedLeadIds.add(p.leadId);
            if (!collectedProfiles.has(p.leadId)) {
                collectedProfiles.set(p.leadId, p);
            }
        }
        return collectedLeadIds.size;
    };

    // Posiziona mouse nell'area risultati (curva Bezier, no teletrasporto)
    const mouseX = Math.round(viewport.width * 0.6);
    const mouseY = Math.round(viewport.height * 0.4);
    await humanMouseMoveToCoords(page, mouseX, mouseY);
    await page.waitForTimeout(100 + Math.floor(Math.random() * 150));

    const initialCount = await collectVisibleLeads();

    // Trova container scrollabile (SalesNav usa div interno, non body).
    // Ritorna l'indice nell'elenco DOM invece di settare un attributo visibile —
    // data-scroll-target era un fingerprint rilevabile da LinkedIn.
    const scrollContainerInfo = await page.evaluate(() => {
        const allElements = document.querySelectorAll('div, main, section, [role="main"]');
        let bestIndex = -1;
        let bestDiff = 0;
        for (let idx = 0; idx < allElements.length; idx++) {
            const htmlEl = allElements[idx] as HTMLElement;
            const diff = htmlEl.scrollHeight - htmlEl.clientHeight;
            if (diff > 50 && diff > bestDiff) {
                const hasLeads = htmlEl.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
                if (hasLeads) {
                    bestIndex = idx;
                    bestDiff = diff;
                }
            }
        }
        if (bestIndex >= 0) {
            const best = allElements[bestIndex] as HTMLElement;
            return {
                found: true,
                index: bestIndex,
                scrollHeight: best.scrollHeight,
                clientHeight: best.clientHeight,
                overflow: bestDiff,
            };
        }
        return { found: false, index: -1, scrollHeight: 0, clientHeight: 0, overflow: 0 };
    });

    console.log(
        `[SCROLL${fast ? ' FAST' : ''}] Container: ${scrollContainerInfo.found ? 'OK' : 'body'}` +
        ` | overflow=${scrollContainerInfo.overflow}px | Lead iniziali: ${initialCount}`,
    );

    // ── Scroll con velocità variabile ──
    // fast=true: scroll veloce solo per caricare le card nel DOM (bulk save — l'utente NON legge i profili)
    // fast=false: scroll umano con pause di lettura (navigazione esplorativa)
    const MAX_STEPS = fast ? 40 : 20;
    let noNewLeadsCount = 0;

    // Funzione di scroll singola (container via indice o wheel)
    const containerIndex = scrollContainerInfo.index;
    const doScroll = async (delta: number): Promise<void> => {
        if (scrollContainerInfo.found) {
            await page.evaluate(({ d, idx }) => {
                const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as HTMLElement | undefined;
                if (el) el.scrollTop += d;
            }, { d: delta, idx: containerIndex });
        } else {
            await page.mouse.wheel(0, delta);
        }
    };

    // Helper: controlla se il container è scrollato fino in fondo (pattern da listScraper.ts)
    const isAtBottom = async (): Promise<boolean> => {
        if (!scrollContainerInfo.found) {
            return page.evaluate(() =>
                window.scrollY + window.innerHeight >= document.body.scrollHeight - 100
            ).catch(() => true);
        }
        return page.evaluate((idx: number) => {
            const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as HTMLElement | undefined;
            return el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 100 : true;
        }, containerIndex).catch(() => true);
    };

    for (let i = 0; i < MAX_STEPS; i++) {
        const countBefore = await collectVisibleLeads();

        if (fast) {
            // FAST MODE: scroll + collect per ogni singolo scroll.
            // SalesNav usa un VIRTUAL SCROLLER: le card fuori viewport vengono distrutte dal DOM.
            // CRITICO: scroll delta PICCOLO (~1 card = ~120px). Un delta troppo grande (500+px)
            // salta card che il virtual scroller non fa in tempo a renderizzare → lead persi.
            // Raccogliamo i lead DOPO ogni singolo scroll prima che vengano distrutti.
            const burstCount = 2 + Math.floor(Math.random() * 2);
            for (let b = 0; b < burstCount; b++) {
                // Delta minimo: ~1-1.5 card alla volta (120-180px) per non saltare card nel virtual scroller
                const delta = 120 + Math.floor(Math.random() * 60);
                await doScroll(delta);
                // Wait adattivo per virtual scroller: poll DOM per nuove lead card
                const preCount = await page.evaluate(() =>
                    document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]').length
                );
                await page.waitForFunction(
                    (before: number) =>
                        document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]').length !== before,
                    preCount,
                    { timeout: 1_500 },
                ).catch(() => null);
                await page.waitForTimeout(150 + Math.floor(Math.random() * 100));
                // Raccogli lead dal viewport corrente (prima che vengano distrutti dallo scroll successivo)
                await collectVisibleLeads();
            }
            await page.waitForTimeout(150 + Math.floor(Math.random() * 100));
        } else {
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
        }

        // Controlla skeleton/loader solo ogni 4 step (non ad ogni step — troppo lento)
        if (i % 4 === 3) {
            await page.waitForFunction(
                () => !document.querySelector('.artdeco-loader, [class*="skeleton"], [class*="ghost"]'),
                { timeout: 1_500 },
            ).catch(() => { });
        }

        const countAfter = await collectVisibleLeads();

        // Early exit: SalesNav mostra 25 lead per pagina. Se li abbiamo tutti, stop.
        if (fast && countAfter >= 25) {
            console.log(`[SCROLL] Tutti i ${countAfter} lead raccolti — stop`);
            break;
        }

        if (countAfter > countBefore) {
            if (!fast) {
                // Nuovi lead trovati — rallenta leggermente (come chi "nota" il contenuto)
                await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
            }
            console.log(`[SCROLL] Step ${i + 1}: ${countAfter} lead (+${countAfter - countBefore})`);
            noNewLeadsCount = 0;
        } else {
            noNewLeadsCount++;
            if (fast) {
                // In fast mode, break SOLO se sia bottom raggiunto che nessun nuovo lead
                const atBottom = await isAtBottom();
                if (atBottom && noNewLeadsCount >= 3) break;
                if (noNewLeadsCount >= 10) break; // safety cap assoluto
            } else {
                if (noNewLeadsCount >= 4) break;
            }
        }

        // Micro-movimento mouse occasionale — skip in fast mode (un umano che fa bulk save non muove il mouse random)
        if (!fast && Math.random() < 0.20) {
            const jitterX = mouseX + Math.floor(Math.random() * 80 - 40);
            const jitterY = mouseY + Math.floor(Math.random() * 50 - 25);
            await humanMouseMoveToCoords(page, jitterX, jitterY);
        }
    }

    // Warning se fast mode ha trovato pochi lead (safety net dopo scroll completo)
    if (fast && collectedLeadIds.size < 15 && collectedLeadIds.size > 0) {
        console.warn(`[SCROLL] Solo ${collectedLeadIds.size} lead trovati dopo scroll completo — possibile rendering incompleto`);
    }

    // Totale accumulato lato Node — nessun cleanup DOM necessario
    const leadCount = collectedLeadIds.size;

    // Torna in cima — usa scrollTop via indice se abbiamo il container, altrimenti wheel rapido
    if (scrollContainerInfo.found) {
        await page.evaluate((idx: number) => {
            const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as HTMLElement | undefined;
            if (el) el.scrollTop = 0;
            window.scrollTo({ top: 0 });
        }, containerIndex);
    } else {
        // Wheel veloce su (meno step del vecchio codice)
        for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, -800);
            await page.waitForTimeout(30);
        }
    }
    await page.waitForTimeout(200 + Math.floor(Math.random() * 200));

    return { count: leadCount, profiles: [...collectedProfiles.values()] };
}

async function prepareResultsPage(page: Page): Promise<void> {
    // Scroll veloce in cima — "Select All" è nell'header dei risultati
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    // Micro-scroll occasionale per sembrare umano (10% delle volte — ridotto da 30% per velocità)
    if (Math.random() < 0.1) {
        await humanDelay(page, 100, 300);
        const dy = 60 + Math.random() * 150;
        await page.evaluate((d: number) => window.scrollBy({ top: d, behavior: 'smooth' }), dy);
        await humanDelay(page, 150, 350);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    await humanDelay(page, 200, 450);
}

async function restoreSearchPagePosition(page: Page, targetPageNumber: number): Promise<boolean> {
    if (targetPageNumber <= 1) {
        return true;
    }

    console.log(`[RESUME] Ripristino posizione pagina ${targetPageNumber}...`);
    for (let currentPage = 1; currentPage < targetPageNumber; currentPage++) {
        const moved = await clickNextPage(page, false);
        if (!moved) {
            // NON crashare — fallback a pagina 1. Meglio rifare pagine già processate che fermare tutto.
            console.warn(
                `[RESUME] WARN: Next non disponibile alla pagina ${currentPage} (target: ${targetPageNumber}). Riparto da pagina 1.`,
            );
            return false;
        }
    }
    console.log(`[RESUME] Posizione ripristinata a pagina ${targetPageNumber}.`);
    return true;
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
    // DOM-first: check rapido per testi sospetti senza screenshot AI.
    // Se il DOM è pulito, ritorna safe immediatamente (0 token, 0 latenza).
    try {
        const suspiciousText = await page.evaluate(() => {
            const body = (document.body.innerText || '').toLowerCase();
            const patterns = [
                'unusual activity', 'attività insolita',
                'restricted', 'limitato', 'sospeso', 'suspended',
                'too fast', 'troppo veloce', 'slow down', 'rallenta',
                'security verification', 'verifica di sicurezza',
                'something went wrong', 'qualcosa è andato storto',
                'captcha', 'robot',
            ];
            for (const p of patterns) {
                if (body.includes(p)) return p;
            }
            return null;
        });

        if (!suspiciousText) {
            return { safe: true, warning: null };
        }

        // Testo sospetto trovato → conferma con Vision AI (potrebbe essere un falso positivo)
        const response = await visionRead(
            page,
            `The page DOM contains the text "${suspiciousText}". Is this a warning/restriction from LinkedIn, or normal content? Answer "OK" if normal, "WARNING: description" if it's a real problem.`,
        );
        if (response.toUpperCase().startsWith('OK')) {
            return { safe: true, warning: null };
        }
        return { safe: false, warning: response };
    } catch {
        return { safe: true, warning: null };
    }
}

// Soglie jitterate per anti-detection noise — cambiano ad ogni sessione per evitare pattern fissi.
// Un umano NON fa azioni a intervalli esatti di modulo (18, 36, 54...). Rigenerate ad ogni trigger.
let _nextHoverAt = 15 + Math.floor(Math.random() * 8);  // ~15-22
let _nextAiDelayAt = 8 + Math.floor(Math.random() * 6); // ~8-13

async function runAntiDetectionNoise(page: Page, totalProcessedPages: number): Promise<void> {
    // Movimento mouse leggero (20% delle volte — ridotto da 40% per velocità)
    if (Math.random() < 0.2) {
        await randomMouseMove(page);
    }
    // Micro-pausa occasionale (5% → 1-3s)
    if (Math.random() < 0.05) {
        await humanDelay(page, 1_000, 3_000);
    }
    // Micro-interazione SalesNav-safe con jitter: hover su un profilo (come un umano curioso).
    // NON naviga fuori da SalesNav — page.goto() a /feed/ o /mynetwork/ nel mezzo del bulk save
    // è un segnale di detection (navigazione senza click, referrer chain incoerente).
    if (totalProcessedPages > 0 && totalProcessedPages >= _nextHoverAt) {
        _nextHoverAt = totalProcessedPages + 14 + Math.floor(Math.random() * 10); // prossimo tra 14-23 pagine
        const leadLink = page.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').first();
        if ((await leadLink.count().catch(() => 0)) > 0) {
            await leadLink.hover().catch(() => null);
            await humanDelay(page, 400, 900);
        }
    }

    // Pausa contestuale con jitter: delay casuale per anti-detection.
    // Sostituisce visionContextualDelay (screenshot + AI) — un delay casuale è altrettanto
    // efficace e costa 0 token. L'intervallo 2-5s simula un utente che si distrae brevemente.
    if (totalProcessedPages > 0 && totalProcessedPages >= _nextAiDelayAt) {
        _nextAiDelayAt = totalProcessedPages + 7 + Math.floor(Math.random() * 8);
        await humanDelay(page, 2_000, 5_000);
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

            // Backoff esponenziale tra tentativi: 1-2s → 3-5s → (reload + 3-5s)
            // Senza backoff, 3 retry rapidi peggiorano un eventuale rate limit.
            const backoffMs = attempt === 0 ? 1000 + Math.random() * 1000 : 3000 + Math.random() * 2000;
            await humanDelay(page, backoffMs, backoffMs * 1.3);

            if (attempt === 1) {
                // Solo al 2° fallimento: reload come ultima risorsa
                console.log('[RETRY] Ricarico pagina come fallback...');
                await dismissTransientUi(page);
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
    // Navigazione diretta via URL — i click DOM su link SalesNav si bloccano
    // perché SalesNav usa SPA navigation e waitForLoadState non completa mai.
    console.log('[PRE-SYNC] Step 2/4: Navigazione alla sezione Lead Lists...');
    await page.goto('https://www.linkedin.com/sales/lists/people/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
    });
    await dismissTransientUi(page);

    // Se SalesNav richiede login separato, aspetta
    if (page.url().toLowerCase().includes('/sales/login')) {
        console.log('[PRE-SYNC] SalesNav richiede login separato — in attesa...');
        await waitForManualLogin(page, 'PRE-SYNC');
        await page.goto('https://www.linkedin.com/sales/lists/people/', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await dismissTransientUi(page);
    }
    await humanDelay(page, 1_500, 2_500);

    // Wait for list links to appear in DOM (non usare networkidle — SalesNav non lo raggiunge mai)
    await page.waitForSelector('a[href*="/sales/lists/people/"]', { timeout: 20_000 }).catch(() => {
        console.warn('[WARN] Nessun link lista trovato nel DOM entro 20s — procedo comunque');
    });
    // Re-inject __name shim after navigation (new page context)
    await reInjectOverlays(page);
    await humanDelay(page, 800, 1_500);

    console.log(`[PRE-SYNC] URL corrente: ${page.url()}`);

    // ── Step 3: Trova e clicca la lista target (DOM-first, CU fallback) ──
    console.log(`[PRE-SYNC] Step 3/4: Cerco la lista "${targetListName}"...`);

    const urlBefore = page.url();
    let listClicked = false;

    // Strategia primaria: DOM locator — trova la lista in <100ms (vs 46k token e 15s di CU)
    {
        console.log('[PRE-SYNC] Cerco la lista via DOM...');
        const nameVariants = [targetListName];
        if (targetListName.length > 25) nameVariants.push(targetListName.substring(0, 25));
        if (targetListName.length > 15) nameVariants.push(targetListName.substring(0, 15));

        // Cerca link <a> con href /sales/lists/people/ che contenga il nome
        // Strategia 1: click diretto via Playwright locator (bypassa overlay)
        const listAnchors = page.locator('a[href*="/sales/lists/people/"]');
        const anchorCount = await listAnchors.count().catch(() => 0);
        console.log(`[PRE-SYNC] Trovati ${anchorCount} link a liste nel DOM`);

        for (let i = 0; i < anchorCount; i++) {
            const anchor = listAnchors.nth(i);
            const text = ((await anchor.textContent({ timeout: 3_000 }).catch(() => '')) ?? '').trim().toLowerCase();
            console.log(`[PRE-SYNC]   anchor[${i}]: "${text.substring(0, 60)}"`);
            const matchesName = nameVariants.some((v) => text.includes(v.toLowerCase()));
            if (matchesName) {
                console.log(`[PRE-SYNC] Lista trovata via DOM locator: "${text.substring(0, 50)}"`);
                await pauseInputBlock(page);
                try {
                    await anchor.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
                    await humanDelay(page, 300, 600);
                    await anchor.click({ timeout: 5_000, force: true });
                } finally {
                    await resumeInputBlock(page);
                }
                listClicked = true;
                break;
            }
        }

        // Strategia 2: coordinate mouse (se locator non ha trovato match per nome)
        if (!listClicked) {
            const listLink = await page.evaluate((variants: string[]) => {
                const anchors = Array.from(
                    document.querySelectorAll('a[href*="/sales/lists/people/"]'),
                ) as HTMLAnchorElement[];
                for (const anchor of anchors) {
                    const anchorText = (anchor.innerText || anchor.textContent || '').trim().toLowerCase();
                    const container = anchor.closest('li, article, tr, div') as HTMLElement | null;
                    const containerText = (container?.innerText || '').trim().toLowerCase();
                    for (const variant of variants) {
                        const lower = variant.toLowerCase();
                        if (anchorText.includes(lower) || containerText.includes(lower)) {
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
                console.log('[PRE-SYNC] Lista trovata via coordinate DOM');
                await smartClick(page, listLink);
                listClicked = true;
            }
        }
    }

    // Fallback: Computer Use se DOM non ha trovato la lista (nome diverso, non visibile, ecc.)
    if (!listClicked && config.openaiApiKey) {
        console.log('[PRE-SYNC] DOM non ha trovato la lista — provo Computer Use...');
        const cuResult = await computerUseTask(
            page,
            `You are on a LinkedIn Sales Navigator page showing a list of Lead Lists. ` +
            `Find the list named "${targetListName}" and click on it to OPEN it. ` +
            `Click directly on the list name text link. If not visible, scroll down. ` +
            `The current URL is: ${page.url()}. After opening, the URL should change to include a list ID.`,
            { maxTurns: 6 },
        );
        if (cuResult.success) {
            const urlAfter = page.url();
            if (urlAfter !== urlBefore && /\/sales\/lists\/people\/\w+/.test(urlAfter)) {
                console.log(`[PRE-SYNC] ✓ Computer Use ha aperto la lista: ${urlAfter}`);
                listClicked = true;
            }
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

    // Gestisci redirect a /sales/login dopo il click sulla lista (sessione scaduta)
    // isLoggedIn può lanciare durante navigazione — se fallisce, assume sessione scaduta (safe default)
    const stillLoggedIn = await isLoggedIn(page).catch(() => false);
    if (page.url().toLowerCase().includes('/sales/login') || !stillLoggedIn) {
        console.warn('[PRE-SYNC] Sessione scaduta dopo click lista — in attesa del login manuale...');
        await waitForManualLogin(page, 'PRE-SYNC');
        // Dopo il login, ri-naviga alla pagina delle liste e riprova
        await page.goto('https://www.linkedin.com/sales/lists/people/', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await dismissTransientUi(page);
        await humanDelay(page, 1_500, 2_500);
        // Riprova click sulla lista — ora dovrebbe funzionare
        const retryAnchor = page.locator('a[href*="/sales/lists/people/"]');
        const retryCount = await retryAnchor.count().catch(() => 0);
        let retryClicked = false;
        const nameVariantsRetry = [targetListName];
        if (targetListName.length > 25) nameVariantsRetry.push(targetListName.substring(0, 25));
        for (let i = 0; i < retryCount; i++) {
            const text = ((await retryAnchor.nth(i).textContent({ timeout: 3_000 }).catch(() => '')) ?? '').trim().toLowerCase();
            if (nameVariantsRetry.some((v) => text.includes(v.toLowerCase()))) {
                await pauseInputBlock(page);
                try {
                    await retryAnchor.nth(i).scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
                    await humanDelay(page, 300, 600);
                    await retryAnchor.nth(i).click({ timeout: 5_000, force: true });
                } finally {
                    await resumeInputBlock(page);
                }
                retryClicked = true;
                break;
            }
        }
        if (retryClicked) {
            await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
            await humanDelay(page, 1_500, 2_500);
            await dismissTransientUi(page);
        }
    }

    const listUrl = page.url();
    console.log(`[PRE-SYNC] Lista aperta: ${listUrl}`);

    // Verifica finale: se ancora su login o pagina sbagliata, abort pre-sync
    if (listUrl.toLowerCase().includes('/sales/login') || !listUrl.toLowerCase().includes('/sales/')) {
        console.warn(`[PRE-SYNC] ATTENZIONE: Non sulla pagina della lista (URL: ${listUrl})`);
        console.warn('[PRE-SYNC] Il dedup si baserà solo sui dati già presenti nel DB.\n');
        return { synced: 0, total: 0, listUrl: null };
    }

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

        // Prossima pagina: usa solo il bottone Next DOM.
        // NON usare page.goto(url?page=N) — causa redirect a /sales/login se sessione scaduta → crash.
        if (!(await hasNextPage(page))) {
            console.log(`[PRE-SYNC] Nessun bottone Next — fine paginazione dopo ${pageNum} pagine`);
            break;
        }
        const moved = await clickNextPage(page, false);
        if (!moved) {
            console.log(`[PRE-SYNC] Click Next fallito — fine paginazione`);
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
    // Reset cache lista — ogni sessione parte da zero
    _bulkSaveListFoundInSession = false;

    // Cleanup run zombie: marca come FAILED tutti i run RUNNING più vecchi di 30 minuti.
    // Un run RUNNING che non è stato aggiornato da 30+ minuti è un crash/SIGINT non gestito.
    try {
        const { getDatabase } = await import('../db');
        const db = await getDatabase();
        const zombieResult = await db.run(
            `UPDATE salesnav_sync_runs SET status = 'FAILED', last_error = 'Zombie run cleanup (non aggiornato da 30+ min)', completed_at = datetime('now')
             WHERE status = 'RUNNING' AND updated_at < datetime('now', '-30 minutes')`,
        );
        if (zombieResult.changes && zombieResult.changes > 0) {
            console.log(`[CLEANUP] ${zombieResult.changes} run zombie marcati come FAILED`);
        }
    } catch { /* best-effort cleanup */ }

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
        await dismissKnownOverlays(page);
        // Auto re-inject overlays on every page load — elimina flash e "automazione in corso" ripetuto
        // + dismiss overlay LinkedIn nativi (cookie consent, premium upsell, download app)
        // Guard: registra il handler una sola volta per Page (evita accumulo se chiamato 2x)
        if (!_loadHandlerRegistered.has(page)) {
            _loadHandlerRegistered.add(page);
            page.on('load', () => { void reInjectOverlays(page).then(() => dismissKnownOverlays(page)).catch(() => null); });
        }

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

        // Guard: se il browser è morto durante il PRE-SYNC, non proseguire
        if (page.isClosed()) {
            throw new Error('Browser chiuso durante PRE-SYNC — impossibile proseguire con le ricerche salvate');
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

        // Match ricerca: prima match esatto sull'input completo, poi split per virgola
        let filteredSearches: SavedSearchDescriptor[] = [];
        if (normalizedRequestedSearchName.length > 0) {
            // FASE 1: match esatto sull'input completo (PRIMA dello split per virgola).
            // Se il nome della ricerca salvata contiene virgole (es. "Eventi 1-10, 11-50, Paesi Bassi"),
            // lo split per virgola romperebbe il match. Proviamo prima il nome intero.
            filteredSearches = discoveredSearches.filter(
                (search) => normalizeSearchName(search.name) === normalizedRequestedSearchName,
            );
            if (filteredSearches.length === 0) {
                filteredSearches = discoveredSearches.filter(
                    (search) => normalizeSearchName(search.name).includes(normalizedRequestedSearchName) ||
                        normalizedRequestedSearchName.includes(normalizeSearchName(search.name)),
                );
            }
            if (filteredSearches.length > 0) {
                console.log(`[SEARCH] Match diretto sull'input completo (${filteredSearches.length}):`);
                for (const s of filteredSearches) {
                    console.log(`  → "${s.name}"`);
                }
            }

            // FASE 2: se nessun match sull'input completo, splitta per virgola e cerca ciascuno
            if (filteredSearches.length === 0) {
                const requestedNames = (options.searchName ?? '')
                    .split(',')
                    .map((s) => normalizeSearchName(s))
                    .filter((s) => s.length > 0);

                if (requestedNames.length > 1) {
                    for (const reqName of requestedNames) {
                        // Solo match esatto per frammento — no fuzzy su pezzi corti
                        // per evitare che "spagna" matchi tutte le ricerche europee
                        const exact = discoveredSearches.filter(
                            (search) => normalizeSearchName(search.name) === reqName,
                        );
                        if (exact.length > 0) {
                            filteredSearches.push(...exact);
                            continue;
                        }
                        // Fuzzy solo se il frammento è lungo abbastanza (>10 char)
                        if (reqName.length > 10) {
                            const fuzzy = discoveredSearches.filter(
                                (search) => normalizeSearchName(search.name).includes(reqName),
                            );
                            filteredSearches.push(...fuzzy);
                        }
                    }
                    const seen = new Set<string>();
                    filteredSearches = filteredSearches.filter((s) => {
                        const key = normalizeSearchName(s.name);
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                    if (filteredSearches.length > 0) {
                        console.log(`[SEARCH] Ricerche selezionate per multi-match (${filteredSearches.length}/${discoveredSearches.length}):`);
                        for (const s of filteredSearches) {
                            console.log(`  → "${s.name}"`);
                        }
                    }
                }
            }

            // FASE 3: single name fallback (se FASE 1 e FASE 2 non hanno trovato nulla)
            if (filteredSearches.length === 0) {
                // Singolo nome: match esatto → contiene → contenuto in
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
                // DOM-first: readPaginationInfo è istantaneo. Vision AI solo come fallback.
                if (!dryRun) {
                    const paginationData = await readPaginationInfo(page);
                    if (paginationData && paginationData.total > 0) {
                        searchReport.totalResultsDetected = paginationData.total * 25;
                    } else {
                        const totalResults = await visionReadTotalResults(page);
                        if (totalResults !== null) {
                            searchReport.totalResultsDetected = totalResults;
                        }
                    }
                }

                if (!dryRun && initialPageNumber > 1) {
                    const restored = await restoreSearchPagePosition(page, initialPageNumber);
                    if (!restored) {
                        // Fallback: riparte da pagina 1 (meglio rifare pagine che crashare)
                        searchReport.startedPage = 1;
                        currentPageNumber = 1;
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                searchReport.status = 'FAILED_TO_OPEN';
                searchReport.errors.push(message);
                report.lastError = message;

                if (error instanceof ChallengeDetectedError) {
                    report.challengeDetected = true;
                    // Tenta risoluzione automatica CAPTCHA prima di andare in pausa
                    const resolved = await attemptChallengeResolution(page).catch(() => false);
                    if (resolved) {
                        console.log('[CHALLENGE] CAPTCHA risolto automaticamente — riprendo...');
                        await humanDelay(page, 1500, 3000);
                        continue;
                    }
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
            let consecutiveAllDuplicatePages = 0;
            const MAX_CONSECUTIVE_DUPLICATE_PAGES = 3;
            let consecutiveHealthCheckFailures = 0;
            const MAX_HEALTH_CHECK_FAILURES = 2;
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

                // ── FASE 0: AI health check — ogni 8 pagine l'AI verifica che non ci siano segnali sospetti ──
                // Ridotto da 3 a 8: un power user SalesNav non si ferma ogni 3 pagine.
                // Circuit breaker: dopo MAX_HEALTH_CHECK_FAILURES fallimenti consecutivi, disabilita per la sessione.
                if (pageNumber > 1 && (pageNumber - 1) % 8 === 0 &&
                    consecutiveHealthCheckFailures < MAX_HEALTH_CHECK_FAILURES) {
                    try {
                        const healthCheck = await aiCheckPageHealth(page);
                        consecutiveHealthCheckFailures = 0;
                        if (!healthCheck.safe) {
                            console.log(`[AI-WARN] Segnale sospetto rilevato: ${healthCheck.warning}`);
                            console.log('[AI-WARN] Rallento e faccio pausa lunga per sicurezza...');
                            await humanDelay(page, 8_000, 15_000);
                            // Ricontrolla dopo la pausa
                            await ensureNoChallenge(page);
                        }
                    } catch {
                        consecutiveHealthCheckFailures++;
                        if (consecutiveHealthCheckFailures >= MAX_HEALTH_CHECK_FAILURES) {
                            console.warn('[AI-WARN] Health check Vision disabilitato per il resto della sessione (Ollama down)');
                        }
                    }
                }

                // ── FASE 1: Leggi paginazione ──
                const paginationInfo = await readPaginationInfo(page);
                const totalPagesDetected = paginationInfo?.total ?? searchMaxPages;
                const currentDisplayPage = paginationInfo?.current ?? pageNumber;
                const remaining = Math.max(0, totalPagesDetected - currentDisplayPage);

                // ── FASE 2: Fast scroll — carica le card nel DOM (lazy rendering) ──
                // fast=true: un power user SalesNav che fa bulk save scorre veloce senza leggere i profili
                // I profili vengono raccolti DURANTE lo scroll per evitare desync con virtual scroller.
                const scrollResult = await scrollAndReadPage(page, true);
                let leadsOnPage = scrollResult.count;

                // Retry se pochi lead trovati (possibile rendering incompleto)
                const isLikelyLastPage = remaining <= 0 || (paginationInfo?.current === paginationInfo?.total);
                if (leadsOnPage < 15 && leadsOnPage > 0 && !isLikelyLastPage) {
                    console.warn(`[RETRY] Solo ${leadsOnPage}/25 lead — scroll-to-top + re-scroll...`);
                    await humanDelay(page, 800, 1500);
                    await page.evaluate(() => window.scrollTo({ top: 0 }));
                    await page.waitForTimeout(500 + Math.floor(Math.random() * 300));
                    const retryResult = await scrollAndReadPage(page, true);
                    if (retryResult.count > leadsOnPage) {
                        console.log(`[RETRY] Migliorato: ${retryResult.count} lead (era ${leadsOnPage})`);
                        leadsOnPage = retryResult.count;
                        // Merge dei profili dal retry
                        for (const p of retryResult.profiles) {
                            if (!scrollResult.profiles.some(sp => sp.leadId === p.leadId)) {
                                scrollResult.profiles.push(p);
                            }
                        }
                    }
                }

                console.log(
                    `[PAGE] Pagina ${currentDisplayPage}/${totalPagesDetected}` +
                    ` — ${leadsOnPage} lead trovati dopo scroll` +
                    (remaining > 0 ? ` — ${remaining} pagine rimanenti` : ' — ultima pagina'),
                );

                // ── FASE 3: Usa profili raccolti durante scroll, fallback a extractProfileUrlsFromPage ──
                // I profili dallo scroll sono più affidabili: raccolti card per card durante lo scroll,
                // non dopo scroll-to-top dove il virtual scroller ha distrutto card fuori viewport.
                const extractedProfiles = scrollResult.profiles.length >= 15
                    ? scrollResult.profiles.map(p => {
                        const name = `${p.firstName} ${p.lastName}`.trim();
                        const company = p.company ?? '';
                        const nameCompanyHash = name.length > 0 && company.length > 0
                            ? createHash('sha1').update(
                                `${name.toLowerCase().trim().replace(/\s+/g, ' ')}|${company.toLowerCase().trim().replace(/\s+/g, ' ')}`
                            ).digest('hex')
                            : '';
                        return {
                            salesnavUrl: null,
                            linkedinUrl: p.linkedinUrl || null,
                            name,
                            firstName: p.firstName,
                            lastName: p.lastName,
                            company,
                            title: p.title ?? '',
                            location: p.location ?? '',
                            nameCompanyHash,
                        };
                    })
                    : await extractProfileUrlsFromPage(page);

                // Warning discrepanza scroll vs extract
                if (extractedProfiles.length > 0 && extractedProfiles.length < leadsOnPage * 0.6) {
                    console.warn(
                        `[WARN] Discrepanza: ${leadsOnPage} lead IDs dallo scroll,` +
                        ` ma solo ${extractedProfiles.length} profili estratti dal DOM (virtual scroller).`,
                    );
                }

                const dedupResult = await checkDuplicates(options.targetListName, extractedProfiles);
                const trustworthy = extractedProfiles.length >= 15 || isLikelyLastPage;
                const allSavedInDb = trustworthy && extractedProfiles.length > 0 && dedupResult.newProfiles === 0;

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

                    // Early-stop: se N pagine consecutive sono tutte duplicate, la ricerca è esaurita
                    consecutiveAllDuplicatePages += 1;
                    if (consecutiveAllDuplicatePages >= MAX_CONSECUTIVE_DUPLICATE_PAGES) {
                        console.log(
                            `[EARLY-STOP] ${MAX_CONSECUTIVE_DUPLICATE_PAGES} pagine consecutive con tutti duplicati` +
                            ` — ricerca "${search.name}" probabilmente esaurita. Passo alla prossima.`,
                        );
                        break;
                    }

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
                    // Anti-detection: delay variabile tra pagine skippate
                    await humanDelay(page, 1_000, 3_000);
                    if (Math.random() < 0.20) {
                        await humanDelay(page, 2_000, 5_000);
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
                    // Attendi DB writes PRIMA di aggiornare i contatori — se il DB fallisce
                    // i contatori non devono incrementare (evita discrepanza report/DB su resume)
                    const dbWritePromise = dbWrites.length > 0 ? Promise.all(dbWrites) : null;
                    if (dbWritePromise) await dbWritePromise;

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
                    consecutiveAllDuplicatePages = 0;

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
                        // Tenta risoluzione automatica CAPTCHA prima di andare in pausa
                        const resolved = await attemptChallengeResolution(page).catch(() => false);
                        if (resolved) {
                            console.log('[CHALLENGE] CAPTCHA risolto automaticamente — riprendo pagina...');
                            await humanDelay(page, 1500, 3000);
                            continue;
                        }
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
            // Tenta risoluzione automatica CAPTCHA prima di andare in pausa
            const resolved = await attemptChallengeResolution(page).catch(() => false);
            if (resolved) {
                console.log('[CHALLENGE] CAPTCHA risolto automaticamente nel catch globale.');
                // Non possiamo fare continue qui (siamo nel catch globale) —
                // segnaliamo successo ma il run è comunque terminato, verrà ripreso con --resume
                report.status = 'PAUSED';
            } else {
                report.status = 'PAUSED';
            }
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
