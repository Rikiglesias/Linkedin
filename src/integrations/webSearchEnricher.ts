/**
 * webSearchEnricher.ts — Web search verification for lead data
 *
 * Searches public web (DuckDuckGo HTML) for verified person data.
 * Only returns data explicitly found on public pages — niente indovinato.
 *
 * Zero API cost. Uses DuckDuckGo HTML search + page scraping with cheerio.
 */

import { load as cheerioLoad } from 'cheerio';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { logInfo } from '../telemetry/logger';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WebSearchDataPoint {
    value: string;
    sourceUrl: string;
    confidence: number; // 0–100
}

export interface WebSearchResult {
    emails: WebSearchDataPoint[];
    phones: WebSearchDataPoint[];
    jobTitles: WebSearchDataPoint[];
    sourceUrls: string[];
    queriesRun: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SEARCH_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

const PERSONAL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'hotmail.it',
    'live.com',
    'live.it',
    'yahoo.com',
    'yahoo.it',
    'yahoo.fr',
    'yahoo.co.uk',
    'ymail.com',
    'aol.com',
    'icloud.com',
    'me.com',
    'protonmail.com',
    'proton.me',
    'tutanota.com',
    'mail.com',
    'zoho.com',
    'gmx.com',
    'libero.it',
    'virgilio.it',
    'alice.it',
    'tiscali.it',
    'web.de',
    'freenet.de',
    'laposte.net',
    'orange.fr',
    'free.fr',
    'example.com',
]);

const EMPTY_RESULT: WebSearchResult = {
    emails: [],
    phones: [],
    jobTitles: [],
    sourceUrls: [],
    queriesRun: 0,
};

// ─── DuckDuckGo HTML Search ─────────────────────────────────────────────────────

/**
 * Parse DuckDuckGo HTML result URLs. DDG wraps results in redirect links
 * with a `uddg` query parameter containing the real target URL.
 */
function extractRealUrl(href: string): string | null {
    if (!href) return null;
    // DDG redirect format: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
    if (href.includes('uddg=')) {
        try {
            const url = new URL(href.startsWith('//') ? `https:${href}` : href);
            const real = url.searchParams.get('uddg');
            return real || null;
        } catch {
            return null;
        }
    }
    // Direct URL
    if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
    }
    return null;
}

async function searchDuckDuckGo(query: string): Promise<string[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const res = await fetchWithRetryPolicy(
        url,
        {
            method: 'GET',
            headers: { 'User-Agent': SEARCH_UA },
        },
        {
            integration: 'web_search.duckduckgo',
            circuitKey: 'web_search.ddg',
            timeoutMs: 12_000,
        },
    );

    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerioLoad(html);
    const urls: string[] = [];

    $('a.result__a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const real = extractRealUrl(href);
        if (real) urls.push(real);
    });

    // Deduplicate and limit to top 8
    return [...new Set(urls)].slice(0, 8);
}

// ─── Page Data Extraction ───────────────────────────────────────────────────────

async function extractDataFromPage(
    pageUrl: string,
    personName: string,
): Promise<{ emails: WebSearchDataPoint[]; phones: WebSearchDataPoint[] }> {
    const emails: WebSearchDataPoint[] = [];
    const phones: WebSearchDataPoint[] = [];

    try {
        const res = await fetchWithRetryPolicy(
            pageUrl,
            { method: 'GET', headers: { 'User-Agent': SEARCH_UA } },
            {
                integration: 'web_search.page_fetch',
                circuitKey: 'web_search.pages',
                timeoutMs: 8_000,
            },
        );

        if (!res.ok) return { emails, phones };
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/html')) return { emails, phones };

        const html = await res.text();
        if (html.length > 500_000) return { emails, phones };

        const $ = cheerioLoad(html);
        const bodyText = $('body').text();
        const pageLower = bodyText.toLowerCase();

        // Only extract data if the page mentions the person by name
        const nameParts = personName.toLowerCase().split(/\s+/);
        if (!nameParts.every((p) => pageLower.includes(p))) {
            return { emails, phones };
        }

        // ── Emails from mailto: links ──
        $('a[href^="mailto:"]').each((_, el) => {
            const mailto = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0]?.trim();
            if (mailto && mailto.includes('@')) {
                const domain = mailto.split('@')[1]?.toLowerCase() || '';
                if (!PERSONAL_DOMAINS.has(domain)) {
                    emails.push({ value: mailto.toLowerCase(), sourceUrl: pageUrl, confidence: 85 });
                }
            }
        });

        // ── Emails from schema.org ──
        $('[itemprop="email"]').each((_, el) => {
            const em = ($(el).text().trim() || $(el).attr('content') || '').toLowerCase();
            if (em && em.includes('@') && !PERSONAL_DOMAINS.has(em.split('@')[1] || '')) {
                if (!emails.some((e) => e.value === em)) {
                    emails.push({ value: em, sourceUrl: pageUrl, confidence: 80 });
                }
            }
        });

        // ── Emails from page text ──
        const textEmails = bodyText.match(EMAIL_RE) || [];
        for (const em of textEmails) {
            const lower = em.toLowerCase();
            const domain = lower.split('@')[1] || '';
            if (
                !PERSONAL_DOMAINS.has(domain) &&
                !emails.some((e) => e.value === lower) &&
                !lower.includes('noreply') &&
                !lower.includes('no-reply') &&
                !lower.includes('example.com')
            ) {
                emails.push({ value: lower, sourceUrl: pageUrl, confidence: 60 });
            }
        }

        // ── Phones from tel: links ──
        $('a[href^="tel:"]').each((_, el) => {
            const tel = ($(el).attr('href') || '').replace(/^tel:/i, '').trim();
            if (tel && tel.replace(/\D/g, '').length >= 8) {
                phones.push({ value: tel, sourceUrl: pageUrl, confidence: 80 });
            }
        });

        // ── Phones from schema.org ──
        $('[itemprop="telephone"]').each((_, el) => {
            const tel = ($(el).text().trim() || $(el).attr('content') || '').trim();
            if (tel && tel.replace(/\D/g, '').length >= 8) {
                if (!phones.some((p) => p.value === tel)) {
                    phones.push({ value: tel, sourceUrl: pageUrl, confidence: 75 });
                }
            }
        });
    } catch {
        // Skip failed pages silently
    }

    return { emails, phones };
}

// ─── Deduplication ──────────────────────────────────────────────────────────────

function dedup(items: WebSearchDataPoint[]): WebSearchDataPoint[] {
    const seen = new Map<string, WebSearchDataPoint>();
    for (const item of items) {
        const existing = seen.get(item.value);
        if (!existing || existing.confidence < item.confidence) {
            seen.set(item.value, item);
        }
    }
    return Array.from(seen.values());
}

// ─── Main ───────────────────────────────────────────────────────────────────────

/**
 * Search the public web for verified data about a person.
 * Returns only data that is explicitly found on public pages — nothing guessed.
 */
export async function searchWebForPersonData(
    firstName: string,
    lastName: string,
    companyName?: string,
    domain?: string,
): Promise<WebSearchResult> {
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) return EMPTY_RESULT;

    const result: WebSearchResult = { ...EMPTY_RESULT, emails: [], phones: [], jobTitles: [], sourceUrls: [] };

    // Build search queries (max 2 to avoid rate-limiting)
    const queries: string[] = [];
    if (companyName) {
        queries.push(`"${fullName}" "${companyName}" email`);
    }
    if (domain) {
        queries.push(`"${fullName}" site:${domain}`);
    }
    if (!companyName && !domain) {
        queries.push(`"${fullName}" email contact`);
    }

    // Run searches
    const allUrls: string[] = [];
    for (const query of queries.slice(0, 2)) {
        const urls = await searchDuckDuckGo(query);
        allUrls.push(...urls);
        result.queriesRun++;
        if (queries.length > 1) {
            await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
        }
    }

    const uniqueUrls = [...new Set(allUrls)]
        .filter((u) => !u.includes('linkedin.com')) // LinkedIn handled separately via browser
        .slice(0, 6);
    result.sourceUrls = uniqueUrls;

    // Fetch and extract data from each page
    for (const pageUrl of uniqueUrls) {
        const data = await extractDataFromPage(pageUrl, fullName);
        result.emails.push(...data.emails);
        result.phones.push(...data.phones);
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    }

    result.emails = dedup(result.emails);
    result.phones = dedup(result.phones);

    if (result.emails.length > 0 || result.phones.length > 0) {
        await logInfo('web_search.data_found', {
            person: fullName,
            emails: result.emails.length,
            phones: result.phones.length,
            pagesScraped: uniqueUrls.length,
        });
    }

    return result;
}
