/**
 * salesnav/bulkSaveNavigation.ts
 * ─────────────────────────────────────────────────────────────────
 * Navigazione SalesNav per il bulk-save: waitForManualLogin (session recovery con
 * gestione overlay) e navigateToSavedSearches (raggiunge la pagina ricerche salvate
 * via navbar/DOM/URL fallback in 3 step). Estratto da bulkSaveOrchestrator.ts (A13,
 * split SRP). ANTI-BAN ALTO: humanDelay variabili, clickLocatorHumanLike, smartClick,
 * navigazione umana multi-step — copiato VERBATIM, zero cambio logica/timing.
 */

import type { Page } from 'playwright';
import { clickLocatorHumanLike, dismissKnownOverlays, humanDelay, isLoggedIn } from '../browser';
import { pauseInputBlock, removeAllOverlays, releaseMouseConfinement } from '../browser/humanBehavior';
import { enableWindowClickThrough, disableWindowClickThrough } from '../browser/windowInputBlock';
import { reInjectOverlays, setInputBlockSuspended, smartClick } from './bulkSaveHelpers';
import { dismissTransientUi } from './bulkSavePagination';

export const SEARCHES_URL = 'https://www.linkedin.com/sales/search/saved-searches';

export const VIEW_SAVED_SEARCH_SELECTOR = [
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
export async function waitForManualLogin(page: Page, context: string): Promise<void> {
    const MAX_WAIT_MS = 3 * 60 * 1000; // 3 minuti
    const POLL_INTERVAL_MS = 5_000;
    const startTime = Date.now();

    // Sospendi l'input blocker globalmente — impedisce che reInjectOverlays lo riattivi.
    // DEVE essere PRIMA di removeAllOverlays: così il page.on('load') non ri-inietta durante la rimozione.
    setInputBlockSuspended(page, true);
    await pauseInputBlock(page);

    // Sblocca il click-through OS (WS_EX_TRANSPARENT): senza questo la finestra resta
    // bot-only (impostata da syncSearchService:215 enableWindowClickThrough prima del bulk-save)
    // e il mouse fisico dell'utente passa SOTTO la finestra → non può cliccare per loggarsi.
    // DEVE precedere removeAllOverlays. Pattern identico a listActions.ts:150 / salesNavigatorSync.ts:843.
    disableWindowClickThrough(page.context());

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

        throw new Error(`Timeout: login manuale non completato entro 3 minuti. URL: ${page.url()}`);
    } finally {
        setInputBlockSuspended(page, false);
        // Ri-protegge la finestra a livello OS (bot-only) prima di re-iniettare gli overlay DOM:
        // ripristina lo stato click-through attivo prima del login (simmetrico a disableWindowClickThrough sopra).
        enableWindowClickThrough(page.context());
        // Re-inject overlays COMPLETAMENTE — la pagina è cambiata durante il login
        await reInjectOverlays(page).catch(() => {});
        await dismissKnownOverlays(page).catch(() => {});
        console.log(`[${context}] Overlay e input-block riattivati.`);
    }
}

export async function navigateToSavedSearches(page: Page): Promise<void> {
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
        const viewCount = await page
            .locator(VIEW_SAVED_SEARCH_SELECTOR)
            .count()
            .catch(() => 0);
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
    // M04: Tentare navigazione dalla navbar LinkedIn (più naturale di goto diretto).
    // Un umano clicca "Sales Navigator" dal menu, non digita l'URL.
    // Fallback a goto diretto se il link non è trovato nella navbar.
    const salesNavHome = 'https://www.linkedin.com/sales/home';
    console.log('[AI-NAV] Step 1/3: navigazione alla home Sales Navigator...');
    let navigatedViaNbar = false;
    try {
        // Cerca il link SalesNav nella navbar LinkedIn (icona compass o testo "Sales Nav")
        const navLink = page.locator('a[href*="/sales"]').first();
        if (await navLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await humanDelay(page, 300, 800);
            await clickLocatorHumanLike(page, navLink, {
                selectorForDwell: 'a[href*="/sales"]',
                scrollTimeoutMs: 5000,
            });
            await page.waitForURL('**/sales/**', { timeout: 15_000 }).catch(() => null);
            navigatedViaNbar = true;
            console.log('[AI-NAV] Navigato a SalesNav dalla navbar LinkedIn.');
        }
    } catch {
        /* fallback a goto diretto */
    }
    if (!navigatedViaNbar) {
        await page.goto(salesNavHome, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
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
                    "Verifica che la sessione LinkedIn sia attiva e che l'account abbia una licenza Sales Navigator. " +
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
    const viewReady = await page
        .locator(VIEW_SAVED_SEARCH_SELECTOR)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(
            () => true,
            () => false,
        );

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
