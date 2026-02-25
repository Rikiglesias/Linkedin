import { Page } from 'playwright';
import { humanDelay, humanMouseMove, simulateHumanReading } from '../browser';
import { isLinkedInUrl, normalizeLinkedInUrl } from '../linkedinUrl';

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

const NEXT_PAGE_SELECTOR = [
    'button[aria-label="Next"]',
    'button[aria-label*="Avanti"]',
    'button.artdeco-pagination__button--next',
    'button:has-text("Next")',
    'button:has-text("Avanti")',
].join(', ');

const SHOW_MORE_SELECTOR = [
    'button:has-text("Show more")',
    'button:has-text("Mostra altri")',
    'button:has-text("Show results")',
    'button:has-text("Mostra risultati")',
].join(', ');

function cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function splitName(fullName: string): { firstName: string; lastName: string } {
    const cleaned = cleanText(fullName)
        .replace(/^(dr|dott|mr|mrs|ms)\.?\s+/i, '')
        .trim();
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
    return normalized.includes('save')
        || normalized.includes('salva')
        || normalized.includes('message')
        || normalized.includes('messaggio')
        || normalized.includes('connect')
        || normalized.includes('collegati')
        || normalized.includes('mutual')
        || normalized.includes('shared')
        || normalized.includes('lead filter')
        || normalized.includes('filtro')
        || normalized.includes('view profile')
        || normalized.includes('visualizza profilo')
        || normalized.includes('sales navigator');
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
    const normalizedUrl = normalizeLinkedInUrl(raw.href);
    if (!isLinkedInUrl(normalizedUrl)) {
        return null;
    }

    const fullName = cleanText(raw.anchorText) || cleanText(raw.lines[0] ?? '');
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
        const matches: RawLeadCandidate[] = [];
        const seen = new Set<string>();

        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const anchor of anchors) {
            const href = anchor.href || anchor.getAttribute('href') || '';
            if (!href) continue;
            if (!/linkedin\.com\/(sales\/lead|in\/)/i.test(href)) continue;

            const dedupeKey = href.split('#')[0];
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const container = anchor.closest('li, article, .artdeco-entity-lockup, [data-test-search-result]') as HTMLElement | null;
            const textSource = container?.innerText ?? anchor.innerText ?? '';
            const lines = textSource
                .split('\n')
                .map((line) => line.replace(/\s+/g, ' ').trim())
                .filter((line) => line.length > 0)
                .slice(0, 8);

            matches.push({
                href: dedupeKey,
                anchorText: (anchor.innerText || '').replace(/\s+/g, ' ').trim(),
                lines,
            });
        }

        return matches;
    });
}

async function clickShowMoreIfPresent(page: Page): Promise<boolean> {
    const button = page.locator(SHOW_MORE_SELECTOR).first();
    if (await button.count() === 0) {
        return false;
    }
    const disabled = await button.isDisabled().catch(() => false);
    if (disabled) {
        return false;
    }
    await humanMouseMove(page, SHOW_MORE_SELECTOR);
    await humanDelay(page, 180, 450);
    await button.click();
    await humanDelay(page, 1200, 2200);
    return true;
}

async function goToNextPage(page: Page): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if (await nextButton.count() === 0) {
        return false;
    }

    const ariaDisabled = (await nextButton.getAttribute('aria-disabled'))?.toLowerCase() === 'true';
    const disabled = ariaDisabled || await nextButton.isDisabled().catch(() => false);
    if (disabled) {
        return false;
    }

    await humanMouseMove(page, NEXT_PAGE_SELECTOR);
    await humanDelay(page, 180, 420);
    await nextButton.click();
    await humanDelay(page, 1300, 2600);
    return true;
}

export async function navigateToSavedLists(page: Page): Promise<SalesNavSavedList[]> {
    await page.goto(SALESNAV_LISTS_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1800, 3200);
    await simulateHumanReading(page);
    return extractSavedLists(page);
}

export async function scrapeLeadsFromSalesNavList(page: Page, options: SalesNavListScrapeOptions): Promise<SalesNavListScrapeResult> {
    const maxPages = Math.max(1, options.maxPages);
    const leadLimit = Math.max(1, options.leadLimit);

    await page.goto(options.listUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1500, 2800);

    const byUrl = new Map<string, SalesNavLeadCandidate>();
    let pagesVisited = 0;
    let candidatesDiscovered = 0;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        pagesVisited = pageNumber;
        await simulateHumanReading(page);

        // Prova 1-2 volte a espandere risultati nella pagina corrente.
        for (let i = 0; i < 2; i++) {
            const expanded = await clickShowMoreIfPresent(page);
            if (!expanded) break;
            await simulateHumanReading(page);
        }

        const rawCandidates = await extractRawLeadCandidates(page);
        candidatesDiscovered += rawCandidates.length;
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
    }

    return {
        pagesVisited,
        candidatesDiscovered,
        uniqueCandidates: byUrl.size,
        leads: Array.from(byUrl.values()).slice(0, leadLimit),
    };
}

