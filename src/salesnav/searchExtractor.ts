import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { humanDelay, humanMouseMove, simulateHumanReading, contextualReadingPause, randomMouseMove } from '../browser';

// ─── Resume state ─────────────────────────────────────────────────────────────

const RESUME_STATE_PATH = path.resolve(process.cwd(), 'data', 'salesnav_search_progress.json');

interface SearchProgress {
    startedAt: string;
    totalSearches: number;
    processedIndices: number[];
    errors: string[];
}

function loadProgress(): SearchProgress | null {
    try {
        if (!fs.existsSync(RESUME_STATE_PATH)) return null;
        const raw = fs.readFileSync(RESUME_STATE_PATH, 'utf8');
        return JSON.parse(raw) as SearchProgress;
    } catch {
        return null;
    }
}

function saveProgress(progress: SearchProgress): void {
    try {
        const dir = path.dirname(RESUME_STATE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(RESUME_STATE_PATH, JSON.stringify(progress, null, 2), 'utf8');
    } catch {
        // non-fatal: il processo può continuare senza resume state
    }
}

function clearProgress(): void {
    try {
        if (fs.existsSync(RESUME_STATE_PATH)) {
            fs.unlinkSync(RESUME_STATE_PATH);
        }
    } catch {
        // non-fatal
    }
}

const SEARCHES_URL = 'https://www.linkedin.com/sales/search/saved-searches';

// Bottone/link "Visualizza" / "View results" sulla riga di una ricerca salvata
const VIEW_SAVED_SEARCH_SELECTOR = [
    'button:has-text("Visualizza")',
    'button:has-text("View results")',
    'button:has-text("View")',
    'a:has-text("Visualizza")',
    'a:has-text("View results")',
].join(', ');

// Prima opzione della lista di destinazione nel dropdown "Salva nell'elenco"
// (la prima visibile è sempre quella usata di recente)
const FIRST_LIST_OPTION_SELECTOR = [
    '.save-to-list-modal li button',
    '.artdeco-typeahead__results-list li button',
    '[data-test-save-to-list-option]',
    '.save-leads-list-dialog li',
    'ul[role="listbox"] li:first-child',
    'ul[role="list"] li:first-child button',
].join(', ');

const SELECT_ALL_CHECKBOX_SELECTOR = [
    'input[aria-label="Select all current page results"]',
    'input[aria-label="Seleziona tutti i risultati nella pagina corrente"]',
    'button:has-text("Select all")',
    'button:has-text("Seleziona tutto")',
    '.artdeco-checkbox__input[aria-label*="Select all"]',
].join(', ');

const SAVE_TO_LIST_HEADER_BUTTON_SELECTOR = [
    'button:has-text("Save to list")',
    'button:has-text("Salva nell\'elenco")',
    'button[title="Save to list"]',
    'button[title="Salva nell\'elenco"]',
].join(', ');

const NEXT_PAGE_SELECTOR = [
    'button[aria-label="Next"]',
    'button[aria-label*="Avanti"]',
    'button.artdeco-pagination__button--next',
    'button:has-text("Next")',
    'button:has-text("Avanti")',
].join(', ');

function cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/**
 * Click sul bottone per andare avanti. Restituisce true se è scattato il cambio pagina.
 */
async function goToNextPage(page: Page): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if ((await nextButton.count()) === 0) {
        return false;
    }

    const ariaDisabled = (await nextButton.getAttribute('aria-disabled'))?.toLowerCase() === 'true';
    const disabled = ariaDisabled || (await nextButton.isDisabled().catch(() => false));
    if (disabled) {
        return false;
    }

    await humanMouseMove(page, NEXT_PAGE_SELECTOR);
    await humanDelay(page, 180, 420);
    await nextButton.click();
    await humanDelay(page, 2000, 4000); // L\'estrazione su Sales Navigator puo essere lenta
    await simulateHumanReading(page);
    return true;
}

/**
 * Clicca "Select all" nella pagina corrente
 */
async function clickSelectAll(page: Page): Promise<boolean> {
    const checkbox = page.locator(SELECT_ALL_CHECKBOX_SELECTOR).first();
    if ((await checkbox.count()) === 0) {
        console.warn('Bottone "Select All" non trovato.');
        return false;
    }

    // Evita di cliccare se è già selezionato
    const isChecked = await checkbox.isChecked().catch(() => false);
    if (!isChecked) {
        await humanMouseMove(page, SELECT_ALL_CHECKBOX_SELECTOR);
        await humanDelay(page, 150, 400);
        await checkbox.click({ force: true }); // Sales Nav usa label/input custom, force serve spesso
        await humanDelay(page, 800, 1500);
    }
    return true;
}

/**
 * Clicca su "Save to list" e seleziona l\'elenco corretto dal dropdown/modale
 */
async function saveSelectedToList(page: Page, listName: string): Promise<boolean> {
    const saveButton = page.locator(SAVE_TO_LIST_HEADER_BUTTON_SELECTOR).first();
    if ((await saveButton.count()) === 0) {
        console.warn('Bottone "Save to list" nell\'header non trovato.');
        return false;
    }

    await humanMouseMove(page, SAVE_TO_LIST_HEADER_BUTTON_SELECTOR);
    await humanDelay(page, 150, 400);
    await saveButton.click();
    await humanDelay(page, 1000, 2000);

    const targetListText = cleanText(listName);
    const listOption = page.locator(`text="${targetListText}"`).first();
    if ((await listOption.count()) === 0) {
        console.warn(`Impossibile trovare l\'elenco target nel dropdown: ${targetListText}`);
        // premo esc per chiudere il popup eventualmente
        await page.keyboard.press('Escape');
        return false;
    }

    await listOption.click();
    await humanDelay(page, 1000, 2500);

    // TODO: Gestire eventuali notifiche di successo o bottoni di conferma modali post-selezione
    return true;
}

export async function navigateToSavedSearches(page: Page): Promise<void> {
    await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1800, 3200);
    await simulateHumanReading(page);
}

/**
 * Naviga alla pagina delle ricerche salvate, clicca il bottone "Visualizza"
 * della PRIMA ricerca trovata e attende il caricamento dei risultati.
 * Restituisce l'URL della pagina risultante.
 */
export async function navigateToFirstSavedSearch(page: Page): Promise<string> {
    await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 2000, 3800);
    await simulateHumanReading(page);

    const viewButton = page.locator(VIEW_SAVED_SEARCH_SELECTOR).first();
    if ((await viewButton.count()) === 0) {
        throw new Error('Nessun bottone "Visualizza" trovato nella pagina delle ricerche salvate.');
    }

    await humanMouseMove(page, VIEW_SAVED_SEARCH_SELECTOR);
    await humanDelay(page, 200, 500);
    await viewButton.click();
    await humanDelay(page, 3000, 5500); // Sales Nav è lento al primo caricamento
    await simulateHumanReading(page);

    return page.url();
}

/**
 * Clicca "Save to list" e seleziona la PRIMA lista disponibile nel dropdown
 * (solitamente quella usata di recente da Sales Navigator).
 */
async function saveSelectedToRecentList(page: Page): Promise<boolean> {
    const saveButton = page.locator(SAVE_TO_LIST_HEADER_BUTTON_SELECTOR).first();
    if ((await saveButton.count()) === 0) {
        console.warn('Bottone "Save to list" nell\'header non trovato.');
        return false;
    }

    await humanMouseMove(page, SAVE_TO_LIST_HEADER_BUTTON_SELECTOR);
    await humanDelay(page, 150, 400);
    await saveButton.click();
    await humanDelay(page, 1200, 2400);

    const firstOption = page.locator(FIRST_LIST_OPTION_SELECTOR).first();
    if ((await firstOption.count()) === 0) {
        console.warn('Nessuna lista trovata nel dropdown "Save to list".');
        await page.keyboard.press('Escape');
        return false;
    }

    await humanMouseMove(page, FIRST_LIST_OPTION_SELECTOR);
    await humanDelay(page, 150, 350);
    await firstOption.click();
    await humanDelay(page, 1000, 2500);
    return true;
}

/**
 * Naviga alla prima ricerca salvata e, per ogni pagina,
 * seleziona tutti i lead e li salva nell'elenco usato di recente.
 *
 * Se viene passato `targetListName`, usa quello; altrimenti usa
 * la prima lista disponibile nel dropdown (recente).
 */
export async function scrapeSavedSearchAutoToRecentList(
    page: Page,
    maxPages: number = 5,
    targetListName?: string,
) {
    const searchUrl = await navigateToFirstSavedSearch(page);
    console.log(`Ricerca aperta. URL: ${searchUrl}`);

    let pagesVisited = 0;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        pagesVisited = pageNumber;
        console.log(`Processando pagina ${pageNumber} di ${maxPages}...`);

        // Simula lettura/scansione dei risultati prima di selezionare tutto
        await contextualReadingPause(page);
        await simulateHumanReading(page);
        // Pausa extra variabile: chi legge veloce, chi lentamente
        await humanDelay(page, 800, 2500);

        const selected = await clickSelectAll(page);
        if (!selected) {
            console.warn(`Salto pagina ${pageNumber}: impossibile selezionare tutti i risultati.`);
            break;
        }

        // Piccola pausa dopo la selezione, come se l'utente guardasse i lead selezionati
        await humanDelay(page, 600, 1400);

        let saved: boolean;
        if (targetListName) {
            saved = await saveSelectedToList(page, targetListName);
        } else {
            saved = await saveSelectedToRecentList(page);
        }

        if (!saved) {
            console.error(`Errore nel salvataggio sulla pagina ${pageNumber}. Interrompo.`);
            break;
        }

        console.log(`Pagina ${pageNumber} completata.`);

        // Movimento mouse casuale dopo il salvataggio (comportamento naturale post-azione)
        await randomMouseMove(page);
        await humanDelay(page, 500, 1200);

        // 20% di probabilità: pausa più lunga tra le pagine (distrazione, caffè, ecc.)
        if (Math.random() < 0.2) {
            await randomMouseMove(page);
            await humanDelay(page, 4000, 9000);
        }

        if (pageNumber >= maxPages) break;

        const moved = await goToNextPage(page);
        if (!moved) {
            console.log('Nessun pulsante Next trovato o disabilitato. Fine risultati.');
            break;
        }
    }

    return { pagesVisited, searchUrl };
}

/**
 * Conta quante ricerche salvate esistono nella pagina corrente.
 * Presuppone che la pagina delle ricerche salvate sia già caricata.
 */
async function countSavedSearches(page: Page): Promise<number> {
    return page.locator(VIEW_SAVED_SEARCH_SELECTOR).count();
}

/**
 * Clicca il bottone "Visualizza" dell'ennesima ricerca salvata (0-based)
 * con movimento mouse umano e attesa caricamento.
 */
async function clickNthViewButton(page: Page, index: number): Promise<string> {
    const buttons = page.locator(VIEW_SAVED_SEARCH_SELECTOR);
    const count = await buttons.count();
    if (index >= count) {
        throw new Error(`Ricerca ${index + 1} non trovata (trovate ${count}).`);
    }

    const button = buttons.nth(index);
    const box = await button.boundingBox();
    if (box) {
        const targetX = box.x + box.width / 2 + (Math.random() * 6 - 3);
        const targetY = box.y + box.height / 2 + (Math.random() * 6 - 3);
        await page.mouse.move(targetX - 80, targetY - 40, { steps: 6 });
        await humanDelay(page, 100, 300);
        await page.mouse.move(targetX, targetY, { steps: 8 });
        await humanDelay(page, 80, 200);
    }

    await button.click();
    await humanDelay(page, 3000, 5500);
    await simulateHumanReading(page);
    return page.url();
}

/**
 * Processa TUTTE le ricerche salvate: per ognuna apre i risultati e,
 * pagina per pagina, seleziona tutto e salva nell'elenco indicato
 * (o nella lista recente se targetListName è undefined).
 */
export async function scrapeAllSavedSearchesAndSaveToList(
    page: Page,
    maxPages: number = 10,
    targetListName?: string,
): Promise<{ searchesProcessed: number; totalPagesVisited: number; errors: string[] }> {
    // Prima passata: conta le ricerche disponibili
    await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 2000, 3800);
    await simulateHumanReading(page);

    const totalSearches = await countSavedSearches(page);
    console.log(`Trovate ${totalSearches} ricerche salvate da processare.`);

    // Resume state: riprendi da dove ci siamo fermati se il numero di ricerche combacia
    const prevProgress = loadProgress();
    const processedSet = new Set<number>(
        prevProgress && prevProgress.totalSearches === totalSearches ? prevProgress.processedIndices : [],
    );
    if (processedSet.size > 0) {
        console.log(`Resume: saltando ${processedSet.size} ricerche già processate.`);
    }

    const progress: SearchProgress = {
        startedAt: prevProgress?.startedAt ?? new Date().toISOString(),
        totalSearches,
        processedIndices: [...processedSet],
        errors: prevProgress?.errors ?? [],
    };

    let searchesProcessed = 0;
    let totalPagesVisited = 0;
    const errors: string[] = [...progress.errors];

    for (let i = 0; i < totalSearches; i++) {
        if (processedSet.has(i)) {
            console.log(`[Ricerca ${i + 1}/${totalSearches}] Già processata — salto.`);
            searchesProcessed += 1;
            continue;
        }

        console.log(`\n[Ricerca ${i + 1}/${totalSearches}] Caricamento...`);

        // Ricarica sempre la pagina delle ricerche per avere il DOM fresco
        await page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 1800, 3200);
        await simulateHumanReading(page);

        let searchUrl: string;
        try {
            searchUrl = await clickNthViewButton(page, i);
        } catch (err) {
            const msg = `Ricerca ${i + 1}: impossibile aprire (${err instanceof Error ? err.message : String(err)})`;
            console.error(msg);
            errors.push(msg);
            progress.errors = errors;
            saveProgress(progress);
            continue;
        }

        console.log(`[Ricerca ${i + 1}] URL: ${searchUrl}`);

        // Processa le pagine della ricerca corrente
        let pagesVisited = 0;
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
            pagesVisited = pageNumber;
            console.log(`  Pagina ${pageNumber}...`);

            await contextualReadingPause(page);
            await simulateHumanReading(page);
            await humanDelay(page, 800, 2500);

            const selected = await clickSelectAll(page);
            if (!selected) {
                console.warn(`  Nessun "Select All" trovato a pagina ${pageNumber}, interrompo questa ricerca.`);
                break;
            }

            await humanDelay(page, 600, 1400);

            let saved: boolean;
            if (targetListName) {
                saved = await saveSelectedToList(page, targetListName);
            } else {
                saved = await saveSelectedToRecentList(page);
            }

            if (!saved) {
                console.error(`  Errore salvataggio pagina ${pageNumber}. Interrompo questa ricerca.`);
                errors.push(`Ricerca ${i + 1}, pagina ${pageNumber}: errore salvataggio.`);
                progress.errors = errors;
                saveProgress(progress);
                break;
            }

            console.log(`  Pagina ${pageNumber} OK.`);
            await randomMouseMove(page);
            await humanDelay(page, 500, 1200);

            if (Math.random() < 0.2) {
                await randomMouseMove(page);
                await humanDelay(page, 4000, 9000);
            }

            if (pageNumber >= maxPages) break;

            const moved = await goToNextPage(page);
            if (!moved) {
                console.log('  Fine risultati per questa ricerca.');
                break;
            }
        }

        totalPagesVisited += pagesVisited;
        searchesProcessed += 1;

        // Aggiorna stato di resume dopo ogni ricerca completata
        processedSet.add(i);
        progress.processedIndices = [...processedSet];
        progress.errors = errors;
        saveProgress(progress);

        // Pausa inter-ricerca: più lunga, simula cambio di focus dell'utente
        if (i < totalSearches - 1) {
            await randomMouseMove(page);
            await humanDelay(page, 5000, 12000);
        }
    }

    // Tutte le ricerche completate: rimuovi il file di resume
    clearProgress();

    return { searchesProcessed, totalPagesVisited, errors };
}

export async function scrapeSavedSearchAndSaveToList(
    page: Page,
    searchUrl: string,
    targetListName: string,
    maxPages: number = 5
) {
    if (!searchUrl) throw new Error('URL ricerca salvata non valido');
    if (!targetListName) throw new Error('Nome elenco di destinazione vuoto');

    console.log(`Navigazione alla ricerca salvata: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 3000, 6000); // Lento al primo caricamento

    let pagesVisited = 0;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        pagesVisited = pageNumber;
        console.log(`Processando pagina ${pageNumber} di ${maxPages}...`);

        // Simula lettura dei risultati prima di selezionare tutto
        await contextualReadingPause(page);
        await simulateHumanReading(page);
        await humanDelay(page, 800, 2500);

        const selected = await clickSelectAll(page);
        if (!selected) {
            console.warn(`Salto pagina ${pageNumber}: impossibile selezionare tutti i risultati.`);
            break;
        }

        // Pausa dopo la selezione come se l'utente verificasse i lead selezionati
        await humanDelay(page, 600, 1400);

        const saved = await saveSelectedToList(page, targetListName);
        if (!saved) {
            console.error(`Errore nel salvataggio all'elenco sulla pagina ${pageNumber}. Interrompo.`);
            break;
        }

        console.log(`Pagina ${pageNumber} completata con successo. Salvataggio su '${targetListName}'.`);

        // Movimento mouse casuale post-azione
        await randomMouseMove(page);
        await humanDelay(page, 500, 1200);

        // 20% probabilità di pausa lunga (distrazione naturale)
        if (Math.random() < 0.2) {
            await randomMouseMove(page);
            await humanDelay(page, 4000, 9000);
        }

        if (pageNumber >= maxPages) {
            break;
        }

        const moved = await goToNextPage(page);
        if (!moved) {
            console.log('Nessun pulsante Next trovato o pulsante disabilitato. Fine risultati.');
            break;
        }
    }

    return {
        pagesVisited
    };
}
