import { Page } from 'playwright';
import { detectChallenge, dismissKnownOverlays, humanDelay, humanMouseMove } from '../browser';
import { blockUserInput, pauseInputBlock, resumeInputBlock } from '../browser/humanBehavior';
import { isLinkedInUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { SALESNAV_NEXT_PAGE_SELECTOR } from './selectors';

export interface SalesNavSavedList {
    name: string;
    url: string;
}

export interface SalesNavLeadCandidate {
    linkedinUrl: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    accountName: string;
    website: string;
    location: string;
    /** Public /in/ URL se trovato nella stessa card SalesNav */
    publicProfileUrl?: string;
}

export interface SalesNavListScrapeOptions {
    listUrl: string;
    maxPages: number;
    leadLimit: number;
    interactive?: boolean;
}

export interface SalesNavListScrapeResult {
    pagesVisited: number;
    candidatesDiscovered: number;
    uniqueCandidates: number;
    leads: SalesNavLeadCandidate[];
}

interface RawLeadCandidate {
    href: string;
    anchorText: string;
    lines: string[];
    publicProfileUrl?: string;
}

const SALESNAV_LISTS_URL = 'https://www.linkedin.com/sales/lists/people/';

/** Selector combinato per lead card SalesNav (lead + people + profili standard) */
const LEAD_ANCHOR_SELECTOR = 'a[href*="/sales/lead/"], a[href*="/sales/people/"], a[href*="/in/"]';

/**
 * Log-normal scroll increment: media ~400px con varianza naturale.
 * Simula il fatto che gli esseri umani scrollano con step irregolari.
 */
function logNormalScrollDelta(): number {
    const mu = Math.log(400);
    const sigma = 0.35;
    const u1 = Math.max(0.0001, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(150, Math.min(700, Math.exp(mu + sigma * z)));
}

/**
 * Scroll graduale per liste SalesNav: scende fino in fondo alla pagina
 * con step variabili e pause naturali, simulando comportamento umano.
 *
 * Pattern humanizzati:
 *   - Incrementi log-normali (media 400px, varianza naturale)
 *   - 15% scroll-up occasionale (simula ri-lettura di un lead interessante)
 *   - 10% overshoot + scroll-back (simula correzione)
 *   - Hover su lead card random per 1-3s (simula lettura)
 *   - Pause mid-scroll variabili (200-800ms)
 *
 * CRITICO: SalesNav spesso usa un div interno con overflow (non window scroll).
 * Questa funzione rileva il container scrollabile corretto e scrolla quello.
 */
async function lightListScroll(page: Page): Promise<void> {
    // Attendi che almeno una lead card appaia (SalesNav lazy-load)
    await page.waitForSelector(LEAD_ANCHOR_SELECTOR, { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 200, 500);

    // Rileva se SalesNav usa un container interno scrollabile (comune)
    // oppure il window scroll standard. Marca il container con data-lk-scroll.
    await page.evaluate((leadSel: string) => {
        const bodyOverflow = document.body.scrollHeight - window.innerHeight;
        if (bodyOverflow > 100) return; // Window scroll funziona — niente da fare

        // Window non scrollabile → cerca container interno con lead card
        const candidates = document.querySelectorAll('div, main, section, [role="main"]');
        let best: HTMLElement | null = null;
        let bestDiff = 0;
        for (const el of candidates) {
            const htmlEl = el as HTMLElement;
            const diff = htmlEl.scrollHeight - htmlEl.clientHeight;
            if (diff > 100 && diff > bestDiff) {
                if (htmlEl.querySelector(leadSel)) {
                    best = htmlEl;
                    bestDiff = diff;
                }
            }
        }
        if (best) {
            best.setAttribute('data-lk-scroll', '1');
        }
    }, LEAD_ANCHOR_SELECTOR).catch(() => { });

    // Helper: esegui scroll sul container corretto
    const doScroll = async (dy: number) => {
        await page.evaluate((delta: number) => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            if (c) {
                c.scrollTop += delta;
            } else {
                window.scrollBy({ top: delta, behavior: 'smooth' });
            }
        }, dy);
    };

    const getScrollPos = () =>
        page.evaluate(() => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            return c ? c.scrollTop : window.scrollY;
        }).catch(() => 0);

    const isAtBottom = () =>
        page.evaluate(() => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            if (c) return c.scrollTop + c.clientHeight >= c.scrollHeight - 100;
            return window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
        }).catch(() => true);

    // Scroll fino in fondo con pattern humanizzati
    let noProgressCount = 0;
    for (let step = 0; step < 25; step++) {
        if (await isAtBottom()) break;

        const posBefore = await getScrollPos();

        // 15%: scroll-up occasionale (ri-lettura di un lead visto)
        if (step > 2 && Math.random() < 0.15) {
            const scrollBackDelta = -(100 + Math.random() * 200);
            await doScroll(scrollBackDelta);
            await humanDelay(page, 400, 900);
            // Hover su una lead card visibile (simula lettura)
            await hoverRandomLeadCard(page);
            await humanDelay(page, 800, 2000);
            // Torna giù
            await doScroll(Math.abs(scrollBackDelta) + 50);
            await humanDelay(page, 300, 600);
            continue;
        }

        // Incremento log-normale
        const deltaY = logNormalScrollDelta();

        // 10%: overshoot + scroll-back
        if (Math.random() < 0.10) {
            const overshoot = deltaY * (1.3 + Math.random() * 0.4);
            await doScroll(overshoot);
            await humanDelay(page, 200, 500);
            // Correzione: torna indietro della differenza
            await doScroll(-(overshoot - deltaY));
            await humanDelay(page, 300, 600);
        } else {
            await doScroll(deltaY);
        }

        // Pausa mid-scroll variabile
        await humanDelay(page, 500 + Math.random() * 800, 1200 + Math.random() * 600);

        // 20%: hover su una lead card per 1-3s (lettura naturale)
        if (Math.random() < 0.20) {
            await hoverRandomLeadCard(page);
            await humanDelay(page, 1000, 3000);
        }

        // Verifica che lo scroll sia effettivamente avanzato
        const posAfter = await getScrollPos();
        if (Math.abs(posAfter - posBefore) < 10) {
            noProgressCount++;
            if (noProgressCount >= 3) break;
        } else {
            noProgressCount = 0;
        }
    }

    // Cleanup marker
    await page.evaluate(() => {
        const el = document.querySelector('[data-lk-scroll="1"]');
        if (el) el.removeAttribute('data-lk-scroll');
    }).catch(() => { });
}

/**
 * Hover su una lead card visibile random — simula il comportamento
 * di un utente che legge i dettagli di un lead mentre scrolla.
 */
async function hoverRandomLeadCard(page: Page): Promise<void> {
    try {
        const cardCount = await page.locator(LEAD_ANCHOR_SELECTOR).count();
        if (cardCount === 0) return;
        const idx = Math.floor(Math.random() * Math.min(cardCount, 10));
        const card = page.locator(LEAD_ANCHOR_SELECTOR).nth(idx);
        const box = await card.boundingBox();
        if (box) {
            // Muovi il mouse verso la card con un po' di jitter
            const x = box.x + box.width * (0.2 + Math.random() * 0.6);
            const y = box.y + box.height * (0.2 + Math.random() * 0.6);
            await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 5) });
        }
    } catch {
        // Best-effort hover
    }
}

const NEXT_PAGE_SELECTOR = SALESNAV_NEXT_PAGE_SELECTOR;

const SHOW_MORE_SELECTOR = [
    'button:has-text("Show more")',
    'button:has-text("Mostra altri")',
    'button:has-text("Show results")',
    'button:has-text("Mostra risultati")',
].join(', ');

function cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** Pattern di stato SalesNav che inquinano il nome (es. "era online 5 ore fa") */
const SALESNAV_STATUS_PATTERNS = [
    /\s+era online\b.*/i,
    /\s+was online\b.*/i,
    /\s+active\s+\d+.*/i,
    /\s+attivo\s+\d+.*/i,
    /\s+\d+[hdm]\s+ago\b.*/i,
    /\s+\d+\s+(ore?|minut[oi]|giorni?|hours?|minutes?|days?)\s+(fa|ago)\b.*/i,
    /\s+online\s+now.*/i,
    /\s+online\s+ora.*/i,
    /\s+\(\d+\).*/,  // "(3rd)" connection degree
    /\s+·\s+\d+(st|nd|rd|th).*/i,
];

function cleanSalesNavName(raw: string): string {
    let cleaned = cleanText(raw);
    for (const pattern of SALESNAV_STATUS_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.replace(/^(dr|dott|mr|mrs|ms)\.?\s+/i, '').trim();
}

function splitName(fullName: string): { firstName: string; lastName: string } {
    const cleaned = cleanSalesNavName(fullName);
    if (!cleaned) {
        return { firstName: '', lastName: '' };
    }
    const parts = cleaned.split(' ');
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' };
    }
    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
    };
}

function looksLikeNoise(line: string): boolean {
    const normalized = line.toLowerCase();
    if (!normalized) return true;
    return (
        normalized.includes('save') ||
        normalized.includes('salva') ||
        normalized.includes('message') ||
        normalized.includes('messaggio') ||
        normalized.includes('connect') ||
        normalized.includes('collegati') ||
        normalized.includes('mutual') ||
        normalized.includes('shared') ||
        normalized.includes('lead filter') ||
        normalized.includes('filtro') ||
        normalized.includes('view profile') ||
        normalized.includes('visualizza profilo') ||
        normalized.includes('sales navigator') ||
        normalized.includes('era online') ||
        normalized.includes('was online') ||
        normalized.includes('online now') ||
        normalized.includes('online ora') ||
        normalized.includes('active ') ||
        /^\d+[hdm]\s+ago$/i.test(normalized) ||
        /^\d+\s+(ore?|minut[oi]|giorni?)\s+fa$/i.test(normalized) ||
        normalized.includes('select') ||
        normalized.includes('seleziona') ||
        normalized.includes('add to list') ||
        normalized.includes('aggiungi a lista') ||
        // Gradi di connessione LinkedIn — non sono dati utili
        /^[1-4]°$/.test(line.trim()) ||
        /collegamento di \d+° grado/i.test(normalized) ||
        /\d+(st|nd|rd|th) degree connection/i.test(normalized) ||
        /^degree connection$/i.test(normalized) ||
        /è online$|is online$/i.test(normalized)
    );
}

/**
 * Rileva se una riga sembra una location geografica (es. "Milan, Lombardy, Italy").
 * SalesNav mostra la location come riga separata nella card del lead.
 */
function looksLikeLocation(line: string): boolean {
    const normalized = line.toLowerCase().trim();
    if (!normalized) return false;
    // Pattern: "City, Region, Country" o "City, Country" o "Area metropolitana di X"
    if (/^area metropolitana/i.test(normalized)) return true;
    if (/metropolitan area$/i.test(normalized)) return true;
    if (/greater .+ area$/i.test(normalized)) return true;
    // Contiene virgole con segmenti brevi (tipico di location)
    const parts = normalized.split(',').map((p) => p.trim());
    if (parts.length >= 2 && parts.every((p) => p.length > 1 && p.length < 40)) return true;
    // Paesi comuni a fine riga
    if (/\b(italy|italia|france|spain|españa|netherlands|nederland|germany|deutschland|belgium|uk|united kingdom|portugal|switzerland|austria|ireland|poland|czech|sweden|denmark|norway|finland|greece|romania|hungary|croatia|brazil|argentina|mexico|india|china|japan|australia|canada|united states)\s*$/i.test(normalized)) return true;
    return false;
}

function pickJobAccountAndLocation(lines: string[], fullName: string): { jobTitle: string; accountName: string; location: string } {
    const normalizedName = cleanText(fullName).toLowerCase();
    const candidates = lines
        .map(cleanText)
        .filter((line) => line.length > 1)
        .filter((line) => line.toLowerCase() !== normalizedName)
        .filter((line) => !looksLikeNoise(line));

    let jobTitle = '';
    let accountName = '';
    let location = '';

    for (const line of candidates) {
        if (!location && looksLikeLocation(line)) {
            location = line;
            continue;
        }
        if (!jobTitle) {
            jobTitle = line;
        }
        if (!accountName) {
            const atMatch = line.match(/\b(?:at|presso)\s+(.+)/i);
            if (atMatch?.[1]) {
                accountName = cleanText(atMatch[1]);
            }
        }
    }

    if (!accountName && candidates.length > 1) {
        const nonLocation = candidates.filter((c) => c !== location);
        if (nonLocation.length > 1) accountName = nonLocation[1];
        else if (nonLocation.length === 1) accountName = nonLocation[0];
    }
    if (!accountName && candidates.length === 1 && candidates[0] !== location) {
        accountName = candidates[0];
    }

    return { jobTitle, accountName, location };
}

function parseRawLeadCandidate(raw: RawLeadCandidate): SalesNavLeadCandidate | null {
    let normalizedUrl = normalizeLinkedInUrl(raw.href);
    if (!isLinkedInUrl(normalizedUrl)) {
        return null;
    }

    // Pulisci suffisso ,NAME_SEARCH,xxx dall'URL SalesNav
    normalizedUrl = normalizedUrl.replace(/,NAME_SEARCH[^/]*/i, '');

    const fullName = cleanSalesNavName(raw.anchorText) || cleanSalesNavName(raw.lines[0] ?? '');
    const { firstName, lastName } = splitName(fullName);
    const { jobTitle, accountName, location } = pickJobAccountAndLocation(raw.lines, fullName);
    return {
        linkedinUrl: normalizedUrl,
        firstName,
        lastName,
        jobTitle,
        accountName: accountName || fullName,
        website: '',
        location,
        publicProfileUrl: raw.publicProfileUrl,
    };
}

async function extractSavedLists(page: Page): Promise<SalesNavSavedList[]> {
    const rows = await page.evaluate(() => {
        const seen = new Set<string>();
        const results: Array<{ name: string; url: string }> = [];
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const anchor of anchors) {
            const href = anchor.href || '';
            if (!/linkedin\.com\/sales\/lists\/people\//i.test(href)) continue;
            if (href.includes('/sales/lists/people/')) {
                // ignore the root page link itself
                const normalizedHref = href.split('#')[0];
                const pathname = (() => {
                    try {
                        return new URL(normalizedHref).pathname;
                    } catch {
                        return '';
                    }
                })();
                if (/^\/sales\/lists\/people\/?$/i.test(pathname)) continue;
                if (seen.has(normalizedHref)) continue;
                seen.add(normalizedHref);
                const parentText = (anchor.closest('li, article, div') as HTMLElement | null)?.innerText ?? '';
                const name = (anchor.innerText || parentText || '').replace(/\s+/g, ' ').trim();
                if (!name) continue;
                results.push({ name, url: normalizedHref });
            }
        }
        return results;
    });

    const byUrl = new Map<string, SalesNavSavedList>();
    for (const row of rows) {
        const name = cleanText(row.name);
        const url = cleanText(row.url);
        if (!name || !url) continue;
        byUrl.set(url, { name, url });
    }
    return Array.from(byUrl.values());
}

async function extractRawLeadCandidates(page: Page): Promise<RawLeadCandidate[]> {
    return page.evaluate(() => {
        const matches: Array<{ href: string; anchorText: string; lines: string[]; publicProfileUrl?: string }> = [];
        const seen = new Set<string>();

        /** Cerca un link /in/ nella stessa card container */
        function findPublicProfileUrl(container: HTMLElement | null, primaryHref: string): string | undefined {
            if (!container) return undefined;
            // Se il link primario è già /in/, non serve cercare
            if (/\/in\//i.test(primaryHref)) return undefined;
            const publicLinks = container.querySelectorAll('a[href*="/in/"]') as NodeListOf<HTMLAnchorElement>;
            for (const link of publicLinks) {
                const h = link.href || link.getAttribute('href') || '';
                if (h && /linkedin\.com\/in\//i.test(h)) {
                    return h.split('#')[0].split('?')[0];
                }
            }
            return undefined;
        }

        // Strategia 1: cerca anchor con href /sales/lead/ o /in/
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const anchor of anchors) {
            const href = anchor.href || anchor.getAttribute('href') || '';
            if (!href) continue;
            if (!/linkedin\.com\/(sales\/lead|sales\/people|in\/)/i.test(href)) continue;
            // Escludi link a liste (non sono lead)
            if (/\/sales\/lists\//i.test(href)) continue;

            // Normalizza URL per dedup: rimuovi hash, query e suffisso ,NAME_SEARCH
            const dedupeKey = href.split('#')[0].split('?')[0].replace(/,NAME_SEARCH.*$/i, '');
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            // Cerca il container più vicino (card del lead)
            const container = anchor.closest(
                'li, article, tr, .artdeco-entity-lockup, [data-test-search-result], ' +
                '[class*="entity-result"], [class*="result-lockup"], [class*="lead-result"]',
            ) as HTMLElement | null;
            const textSource = container?.innerText ?? anchor.innerText ?? '';
            const lines = textSource
                .split('\n')
                .map((line) => line.replace(/\s+/g, ' ').trim())
                .filter((line) => line.length > 0)
                .slice(0, 10);

            matches.push({
                href: href.split('#')[0],
                anchorText: (anchor.innerText || '').replace(/\s+/g, ' ').trim(),
                lines,
                publicProfileUrl: findPublicProfileUrl(container, href),
            });
        }

        // Strategia 2: cerca data-entity-urn (SalesNav usa spesso questi)
        const entityElements = document.querySelectorAll('[data-entity-urn*="lead"]');
        for (const el of entityElements) {
            const leadAnchor = el.querySelector('a[href*="/sales/lead/"]') as HTMLAnchorElement | null;
            if (!leadAnchor) continue;
            const href = leadAnchor.href || '';
            const dedupeKey = href.split('#')[0].split('?')[0].replace(/,NAME_SEARCH.*$/i, '');
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const textSource = (el as HTMLElement).innerText || '';
            const lines = textSource
                .split('\n')
                .map((line) => line.replace(/\s+/g, ' ').trim())
                .filter((line) => line.length > 0)
                .slice(0, 10);

            matches.push({
                href: href.split('#')[0],
                anchorText: (leadAnchor.innerText || '').replace(/\s+/g, ' ').trim(),
                lines,
                publicProfileUrl: findPublicProfileUrl(el as HTMLElement, href),
            });
        }

        return matches;
    });
}

async function clickShowMoreIfPresent(page: Page): Promise<boolean> {
    await dismissKnownOverlays(page);
    const button = page.locator(SHOW_MORE_SELECTOR).first();
    if ((await button.count()) === 0) {
        return false;
    }
    const disabled = await button.isDisabled().catch(() => false);
    if (disabled) {
        return false;
    }
    await pauseInputBlock(page);
    await humanMouseMove(page, SHOW_MORE_SELECTOR);
    await humanDelay(page, 180, 450);
    await button.click();
    await resumeInputBlock(page);
    await humanDelay(page, 1200, 2200);
    return true;
}

async function goToNextPage(page: Page): Promise<boolean> {
    await dismissKnownOverlays(page);
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if ((await nextButton.count()) === 0) {
        return false;
    }

    const ariaDisabled = (await nextButton.getAttribute('aria-disabled'))?.toLowerCase() === 'true';
    const disabled = ariaDisabled || (await nextButton.isDisabled().catch(() => false));
    if (disabled) {
        return false;
    }

    await pauseInputBlock(page);
    await humanMouseMove(page, NEXT_PAGE_SELECTOR);
    await humanDelay(page, 180, 420);
    await nextButton.click();
    await resumeInputBlock(page);
    // Attendi caricamento AJAX della nuova pagina (SalesNav non fa page reload)
    await humanDelay(page, 2000, 3500);
    // Attendi che i risultati siano visibili (indicatore di caricamento completato)
    await page.waitForSelector(LEAD_ANCHOR_SELECTOR, { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 500, 1000);
    return true;
}

export async function navigateToSavedLists(page: Page): Promise<SalesNavSavedList[]> {
    await page.goto(SALESNAV_LISTS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await humanDelay(page, 1800, 3200);
    await lightListScroll(page);
    return extractSavedLists(page);
}

export async function scrapeLeadsFromSalesNavList(
    page: Page,
    options: SalesNavListScrapeOptions,
): Promise<SalesNavListScrapeResult> {
    const maxPages = Math.max(1, options.maxPages);
    const leadLimit = Math.max(1, options.leadLimit);

    await page.goto(options.listUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await humanDelay(page, 1500, 2800);
    // Re-inject overlay dopo navigazione (DOM distrutto da page.goto) — skip in interactive
    if (!options.interactive) await blockUserInput(page);
    // Attendi che almeno una lead card appaia prima di iniziare
    await page.waitForSelector(LEAD_ANCHOR_SELECTOR, { timeout: 15_000 }).catch(() => null);

    const byUrl = new Map<string, SalesNavLeadCandidate>();
    let pagesVisited = 0;
    let candidatesDiscovered = 0;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        pagesVisited = pageNumber;
        await lightListScroll(page);

        // Prova 1-2 volte a espandere risultati nella pagina corrente.
        for (let i = 0; i < 2; i++) {
            const expanded = await clickShowMoreIfPresent(page);
            if (!expanded) break;
            await lightListScroll(page);
        }

        // Challenge check per pagina — interrompi subito se LinkedIn blocca
        if (await detectChallenge(page)) {
            console.log(`[SYNC] Challenge rilevato a pagina ${pageNumber}. Interruzione.`);
            break;
        }

        let rawCandidates = await extractRawLeadCandidates(page);
        // Retry una volta se 0 candidati trovati (AJAX lento o scroll insufficiente)
        if (rawCandidates.length === 0) {
            console.log(`[SYNC] Pagina ${pageNumber}: 0 candidati, attendo e riprovo...`);
            await humanDelay(page, 2000, 3000);
            await lightListScroll(page);
            rawCandidates = await extractRawLeadCandidates(page);
        }
        candidatesDiscovered += rawCandidates.length;
        console.log(`[SYNC] Pagina ${pageNumber}: ${rawCandidates.length} candidati trovati, ${byUrl.size} unici finora`);
        for (const raw of rawCandidates) {
            const parsed = parseRawLeadCandidate(raw);
            if (!parsed) continue;
            byUrl.set(parsed.linkedinUrl, parsed);
            if (byUrl.size >= leadLimit) {
                break;
            }
        }

        if (byUrl.size >= leadLimit) {
            break;
        }
        if (pageNumber >= maxPages) {
            break;
        }

        const moved = await goToNextPage(page);
        if (!moved) {
            break;
        }
        // Re-inject overlay dopo cambio pagina — skip in interactive
        if (!options.interactive) await blockUserInput(page);
    }

    return {
        pagesVisited,
        candidatesDiscovered,
        uniqueCandidates: byUrl.size,
        leads: Array.from(byUrl.values()).slice(0, leadLimit),
    };
}
