import { Page } from 'playwright';
import { detectChallenge, humanDelay, humanMouseMove } from '../browser';
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
}

const SALESNAV_LISTS_URL = 'https://www.linkedin.com/sales/lists/people/';

/** Selector combinato per lead card SalesNav (lead + people + profili standard) */
const LEAD_ANCHOR_SELECTOR = 'a[href*="/sales/lead/"], a[href*="/sales/people/"], a[href*="/in/"]';

/**
 * Scroll graduale per liste SalesNav: scende fino in fondo alla pagina
 * con step variabili e pause naturali. NON torna mai su (niente pattern
 * su-giù-su-giù). Rivela tutti i lead lazy-loaded di SalesNav.
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
    }, LEAD_ANCHOR_SELECTOR).catch(() => {});

    // Scroll fino in fondo con step variabili e tracking progresso
    let noProgressCount = 0;
    for (let step = 0; step < 20; step++) {
        const atBottom = await page.evaluate(() => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            if (c) return c.scrollTop + c.clientHeight >= c.scrollHeight - 100;
            return window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
        }).catch(() => true);
        if (atBottom) break;

        const posBefore = await page.evaluate(() => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            return c ? c.scrollTop : window.scrollY;
        }).catch(() => 0);

        const deltaY = 280 + Math.random() * 350;
        await page.evaluate((dy: number) => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            if (c) {
                c.scrollTop += dy;
            } else {
                window.scrollBy({ top: dy, behavior: 'smooth' });
            }
        }, deltaY);

        await humanDelay(page, 600 + Math.random() * 800, 1200 + Math.random() * 600);

        // Verifica che lo scroll sia effettivamente avanzato
        const posAfter = await page.evaluate(() => {
            const c = document.querySelector('[data-lk-scroll="1"]') as HTMLElement | null;
            return c ? c.scrollTop : window.scrollY;
        }).catch(() => posBefore);

        if (Math.abs(posAfter - posBefore) < 10) {
            noProgressCount++;
            if (noProgressCount >= 3) break; // Contenuto completamente caricato
        } else {
            noProgressCount = 0;
        }
    }

    // Cleanup marker
    await page.evaluate(() => {
        const el = document.querySelector('[data-lk-scroll="1"]');
        if (el) el.removeAttribute('data-lk-scroll');
    }).catch(() => {});
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
        normalized.includes('aggiungi a lista')
    );
}

function pickJobAndAccount(lines: string[], fullName: string): { jobTitle: string; accountName: string } {
    const normalizedName = cleanText(fullName).toLowerCase();
    const candidates = lines
        .map(cleanText)
        .filter((line) => line.length > 1)
        .filter((line) => line.toLowerCase() !== normalizedName)
        .filter((line) => !looksLikeNoise(line));

    let jobTitle = '';
    let accountName = '';

    for (const line of candidates) {
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
        accountName = candidates[1];
    }
    if (!accountName && candidates.length === 1) {
        accountName = candidates[0];
    }

    return { jobTitle, accountName };
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
    const { jobTitle, accountName } = pickJobAndAccount(raw.lines, fullName);
    return {
        linkedinUrl: normalizedUrl,
        firstName,
        lastName,
        jobTitle,
        accountName: accountName || fullName,
        website: '',
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
        const matches: Array<{ href: string; anchorText: string; lines: string[] }> = [];
        const seen = new Set<string>();

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
            });
        }

        return matches;
    });
}

async function clickShowMoreIfPresent(page: Page): Promise<boolean> {
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
    // Re-inject overlay dopo navigazione (DOM distrutto da page.goto)
    if (options.interactive) await blockUserInput(page);
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
        // Re-inject overlay dopo cambio pagina
        if (options.interactive) await blockUserInput(page);
    }

    return {
        pagesVisited,
        candidatesDiscovered,
        uniqueCandidates: byUrl.size,
        leads: Array.from(byUrl.values()).slice(0, leadLimit),
    };
}
