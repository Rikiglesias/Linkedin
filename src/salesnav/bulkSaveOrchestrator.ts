import type { Page } from 'playwright';
import { createHash } from 'crypto';
import { clickLocatorHumanLike, detectChallenge, dismissKnownOverlays, humanDelay, isLoggedIn } from '../browser';
import { attemptChallengeResolution } from '../workers/challengeHandler';
import {
    getSafeMaxSearches,
    getSafeSessionLimit,
    reInjectOverlays,
    smartClick,
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
    getRuntimeFlag,
    setRuntimeFlag,
} from '../core/repositories';
import type { SalesNavSyncRunRecord } from '../core/repositories.types';
import { visionReadTotalResults } from './visionNavigator';
import { checkDuplicates, extractProfileUrlsFromPage, saveExtractedProfiles } from './salesnavDedup';
import { computerUseTask, isComputerUseEnabled } from './computerUse';
import type {
    SalesNavBulkSaveOptions,
    SalesNavBulkSaveSearchReport,
    SalesNavBulkSaveReport,
    SavedSearchDescriptor,
} from './bulkSaveTypes';
import { BulkSaveChallengeDetectedError } from './bulkSaveTypes';
import {
    readPaginationInfo,
    hasNextPage,
    clickNextPage,
    scrollAndReadPage,
    prepareResultsPage,
    restoreSearchPagePosition,
    dismissTransientUi,
    aiCheckPageHealth,
    runAntiDetectionNoise,
} from './bulkSavePagination';
import { setListFoundInSession } from './bulkSaveState';
import { clickSelectAll, openSaveToListDialog, chooseTargetList } from './bulkSavePageActions';

// Navigazione SalesNav (waitForManualLogin, navigateToSavedSearches) + costanti SEARCHES_URL e
// VIEW_SAVED_SEARCH_SELECTOR estratte in bulkSaveNavigation.ts (A13). SEARCHES_URL re-esportata
// (backward-compat); waitForManualLogin usata ancora internamente (navigateToSavedSearches + preSyncListToDb).
import { waitForManualLogin, navigateToSavedSearches } from './bulkSaveNavigation';
export { SEARCHES_URL } from './bulkSaveNavigation';

// Discovery ricerche salvate (waitForSearchResultsReady, normalizeSearchName, extractSavedSearches,
// ensureNoChallenge, verifyVisionSurface, clickSavedSearchView) estratta in bulkSaveSearchDiscovery.ts
// (A13). Usate internamente da runSalesNavBulkSave/processSearchPage; extractSavedSearches re-esportata.
import {
    waitForSearchResultsReady,
    normalizeSearchName,
    extractSavedSearches,
    ensureNoChallenge,
    verifyVisionSurface,
    clickSavedSearchView,
} from './bulkSaveSearchDiscovery';
export { extractSavedSearches };

// Guard: evita registrazione multipla del page.on('load') handler sulla stessa Page.
// Senza questo, ogni chiamata a runSalesNavBulkSave accumula handler → N re-inject per load.
const _loadHandlerRegistered = new WeakSet<Page>();

// Tipi e ChallengeDetectedError estratti in bulkSaveTypes.ts (A17: split file >1000 righe)
// Re-export per backward compatibility con consumer esterni
export type {
    SalesNavBulkSaveOptions,
    SalesNavBulkSavePageReport,
    SalesNavBulkSaveSearchReport,
    SalesNavBulkSaveReport,
    SavedSearchDescriptor,
} from './bulkSaveTypes';

const ChallengeDetectedError = BulkSaveChallengeDetectedError;

// Le seguenti funzioni sono state consolidate in ./bulkSaveHelpers.ts:
// isPageClosedError, clampNumber, getSafeMaxSearches, getSafeSessionLimit,
// getViewButtonLocator, hasLocator, locatorBoundingBox, buildClipFromBox,
// buildClipAroundLocator, reInjectOverlays, findVisibleClickTarget,
// smartClick, safeVisionClick, visionNavigationStep

// Azioni pagina (clickSelectAll, openSaveToListDialog, verifyToast, chooseTargetList, etc.)
// estratte in bulkSavePageActions.ts (A17)

/**
 * Reads current page number and total pages from the SalesNav pagination bar.
 * Returns { current, total } or null if pagination cannot be read.
 */

// Funzioni di paginazione, scroll, UI e anti-detection estratte in bulkSavePagination.ts (A17)

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
                await clickLocatorHumanLike(page, anchor, {
                    scrollTimeoutMs: 3_000,
                });
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

    // Fallback: Computer Use se DOM non ha trovato la lista (F2: opt-in esplicito, zero-PII di default)
    if (!listClicked && isComputerUseEnabled()) {
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
        console.warn(
            '[WARN] domcontentloaded timeout dopo click lista:',
            err instanceof Error ? err.message : String(err),
        );
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
            const text = (
                (await retryAnchor
                    .nth(i)
                    .textContent({ timeout: 3_000 })
                    .catch(() => '')) ?? ''
            )
                .trim()
                .toLowerCase();
            if (nameVariantsRetry.some((v) => text.includes(v.toLowerCase()))) {
                await clickLocatorHumanLike(page, retryAnchor.nth(i), {
                    scrollTimeoutMs: 3_000,
                });
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
            0, // runId = 0 per pre-sync
            0, // searchIndex = 0
            pageNum,
        );
        totalInserted += inserted;

        // Log progress con paginazione
        const paginationInfo = await readPaginationInfo(page);
        const pageLabel = paginationInfo ? `${paginationInfo.current}/${paginationInfo.total}` : `${pageNum}`;
        console.log(`[PRE-SYNC] Pagina ${pageLabel}: ${profiles.length} profili estratti, ${inserted} nuovi nel DB`);

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
        `\n[PRE-SYNC] Completato: ${totalInserted} nuovi membri nel DB` + ` su ${totalExtracted} totali estratti\n`,
    );

    return { synced: totalInserted, total: totalExtracted, listUrl };
}

export async function runSalesNavBulkSave(
    page: Page,
    options: SalesNavBulkSaveOptions,
): Promise<SalesNavBulkSaveReport> {
    // Reset cache lista — ogni sessione parte da zero
    setListFoundInSession(false);

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
    } catch (cleanupErr) {
        // A04: zombie cleanup fallito — run zombie resteranno in stato RUNNING
        console.warn(
            `[A04] Zombie run cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
    }

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
            page.on('load', () => {
                void reInjectOverlays(page)
                    .then(() => dismissKnownOverlays(page))
                    .catch(() => null);
            });
        }

        // ── PRE-SYNC: scarica i membri attuali della lista target dal sito e salvali nel DB ──
        // Così il dedup funziona anche al primo run o se i lead sono stati aggiunti manualmente.
        // H03: Skip se l'ultimo pre-sync è recente (< 2h) — evita full scan 80 pagine ogni volta.
        if (!dryRun) {
            let skipPreSync = false;
            if (options.resume) {
                try {
                    const lastPreSyncRaw = await getRuntimeFlag(`presync_last_run:${options.targetListName}`);
                    if (lastPreSyncRaw) {
                        const elapsed = Date.now() - Date.parse(lastPreSyncRaw);
                        const elapsedHours = elapsed / (1000 * 60 * 60);
                        if (Number.isFinite(elapsedHours) && elapsedHours < 2) {
                            console.log(
                                `[PRE-SYNC] Skip: ultimo sync ${elapsedHours.toFixed(1)}h fa (< 2h). Usa --no-resume per forzare.`,
                            );
                            skipPreSync = true;
                        }
                    }
                } catch (preSyncErr) {
                    // A04: pre-sync check fallito — procedi con pre-sync (comportamento safe)
                    console.warn(
                        `[A04] Pre-sync elapsed check failed: ${preSyncErr instanceof Error ? preSyncErr.message : String(preSyncErr)}`,
                    );
                }
            }
            const preSync = skipPreSync
                ? { synced: 0, total: 0, listUrl: null }
                : await preSyncListToDb(page, options.targetListName);
            if (preSync.synced > 0) {
                console.log(`[PRE-SYNC] DB aggiornato con ${preSync.synced} membri — il dedup è ora affidabile.\n`);
                // H03: Salva timestamp per skip pre-sync nelle prossime 2h
                await setRuntimeFlag(`presync_last_run:${options.targetListName}`, new Date().toISOString()).catch(
                    () => null,
                );
            } else if (preSync.listUrl === null) {
                console.warn(
                    `[PRE-SYNC] ATTENZIONE: lista "${options.targetListName}" non trovata su LinkedIn — dedup potrebbe essere incompleto.\n`,
                );
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
            const bodyText = (
                (await page
                    .locator('body')
                    .textContent()
                    .catch(() => '')) ?? ''
            ).toLowerCase();
            console.log(`[SEARCH] Page body sample: "${bodyText.substring(0, 200)}"`);
            const isSavedSearchesPage =
                currentUrl.includes('/sales/search/saved-searches') && /saved searches|ricerche salvate/.test(bodyText);

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
                    (search) =>
                        normalizeSearchName(search.name).includes(normalizedRequestedSearchName) ||
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
                            const fuzzy = discoveredSearches.filter((search) =>
                                normalizeSearchName(search.name).includes(reqName),
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
                        console.log(
                            `[SEARCH] Ricerche selezionate per multi-match (${filteredSearches.length}/${discoveredSearches.length}):`,
                        );
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
                    filteredSearches = discoveredSearches.filter((search) =>
                        normalizeSearchName(search.name).includes(normalizedRequestedSearchName),
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
                    filteredSearches = discoveredSearches.filter((search) =>
                        normalizedRequestedSearchName.includes(normalizeSearchName(search.name)),
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
            const totalResultsLabel =
                searchReport.totalResultsDetected !== null
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
            // M03: Aumentato da 3 a 5 — con 3 pagine, early-stop scattava troppo presto
            // su ricerche con molti risultati dove alcune pagine intermedie erano duplicate.
            const MAX_CONSECUTIVE_DUPLICATE_PAGES = 5;
            let consecutiveHealthCheckFailures = 0;
            const MAX_HEALTH_CHECK_FAILURES = 2;
            for (let pageNumber = initialPageNumber; pageNumber <= searchMaxPages; pageNumber++) {
                currentPageNumber = pageNumber;
                searchReport.finalPage = pageNumber;

                if (report.pagesProcessed >= safeSessionLimit) {
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
                if (
                    pageNumber > 1 &&
                    (pageNumber - 1) % 8 === 0 &&
                    consecutiveHealthCheckFailures < MAX_HEALTH_CHECK_FAILURES
                ) {
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
                            console.warn(
                                '[AI-WARN] Health check Vision disabilitato per il resto della sessione (Ollama down)',
                            );
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
                const isLikelyLastPage = remaining <= 0 || paginationInfo?.current === paginationInfo?.total;
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
                            if (!scrollResult.profiles.some((sp) => sp.leadId === p.leadId)) {
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
                const extractedProfiles =
                    scrollResult.profiles.length >= 15
                        ? scrollResult.profiles.map((p) => {
                              const name = `${p.firstName} ${p.lastName}`.trim();
                              const company = p.company ?? '';
                              const nameCompanyHash =
                                  name.length > 0 && company.length > 0
                                      ? createHash('sha1')
                                            .update(
                                                `${name.toLowerCase().trim().replace(/\s+/g, ' ')}|${company.toLowerCase().trim().replace(/\s+/g, ' ')}`,
                                            )
                                            .digest('hex')
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
                        console.log(
                            `[DONE] Ricerca "${search.name}" completata — tutte le ${totalPagesDetected} pagine controllate.`,
                        );
                        break;
                    }
                    if (pageNumber >= searchMaxPages) {
                        console.log(
                            `[DONE] Ricerca "${search.name}" — raggiunto limite max pagine (${searchMaxPages}).`,
                        );
                        break;
                    }
                    // Verifica che esista un bottone Next prima di cliccare
                    const nextAvailable = await hasNextPage(page);
                    if (!nextAvailable) {
                        console.log(
                            `[DONE] Ricerca "${search.name}" completata — nessun bottone Next (${totalPagesDetected} pagine totali).`,
                        );
                        break;
                    }
                    const movedSkip = await clickNextPage(page, false);
                    if (!movedSkip) {
                        console.log(`[DONE] Ricerca "${search.name}" completata — Next non cliccabile.`);
                        break;
                    }
                    // Anti-detection: delay variabile tra pagine skippate
                    await humanDelay(page, 1_000, 3_000);
                    if (Math.random() < 0.2) {
                        await humanDelay(page, 2_000, 5_000);
                    }
                    continue;
                }

                // ── C08: Check limite 2500 membri/lista SalesNav PRIMA di salvare ──
                // LinkedIn ha hard limit 2500 lead/lista. Superato → fail silenzioso o errore UI.
                try {
                    const { getDatabase: getDb } = await import('../db');
                    const memberCountRow = await getDb().then((db) =>
                        db.get<{ cnt: number }>(
                            'SELECT COUNT(*) as cnt FROM salesnav_list_members WHERE list_name = ?',
                            [options.targetListName],
                        ),
                    );
                    const currentMembers = memberCountRow?.cnt ?? 0;
                    if (currentMembers + dedupResult.newProfiles > 2400) {
                        console.warn(
                            `[SAVE] ⚠️ Lista "${options.targetListName}" ha ${currentMembers} membri + ${dedupResult.newProfiles} nuovi = ${currentMembers + dedupResult.newProfiles} — vicino al limite 2500. Rischio fallimento salvataggio LinkedIn.`,
                        );
                        if (currentMembers >= 2450) {
                            console.error(
                                `[SAVE] ❌ Lista "${options.targetListName}" ha ${currentMembers} membri — troppo vicino al limite 2500. Skip salvataggio per evitare errore LinkedIn.`,
                            );
                            if (run) {
                                await addSyncItem({
                                    runId: run.id,
                                    searchIndex: absoluteIndex,
                                    pageNumber,
                                    leadsOnPage,
                                    status: 'SKIPPED',
                                }).catch(() => null);
                            }
                            continue;
                        }
                    }
                } catch (limitErr) {
                    // A04: member limit check fallito — procedi comunque (meglio che bloccare)
                    console.warn(
                        `[A04] List member limit check failed: ${limitErr instanceof Error ? limitErr.message : String(limitErr)}`,
                    );
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
                        console.log(
                            `[DONE] Ricerca "${search.name}" completata — raggiunto limite max pagine (${searchMaxPages}).`,
                        );
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
