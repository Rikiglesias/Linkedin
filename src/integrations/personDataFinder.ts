/**
 * personDataFinder.ts — OSINT-based person data enrichment engine (v2)
 *
 * Multi-phase deep enrichment pipeline:
 *   Fase 1: Company Intelligence — homepage, OpenGraph, schema.org, sitemap.xml,
 *           address extraction, expanded social links (7 platforms)
 *   Fase 2: DNS Intelligence — MX provider detection, SOA email hint, SPF check
 *   Fase 3: Team Page Person Matching — find the person on team/about pages,
 *           extract their title, bio, email, phone from matched card
 *   Fase 4: Email Discovery — mailto: links, page text regex, schema.org email,
 *           DNS SOA email hint, name-to-email correlation
 *   Fase 5: Phone Discovery — tel: links, schema.org telephone, regex on
 *           homepage + contact + team pages, name correlation
 *   Fase 6: Social Profile Aggregation — GitHub (company-verified), Gravatar,
 *           Stack Overflow, all company social links
 *   Fase 7: Data Fusion — cross-reference scoring, source reliability weights,
 *           seniority/department inference from title + team page bio
 *
 * Zero API a pagamento — solo fonti pubbliche, scraping e DNS.
 * Integrato nella catena: Apollo → Hunter → EmailGuesser → Clearbit → **PersonDataFinder**
 */

import * as crypto from 'node:crypto';
import * as dns from 'node:dns';
import { load as cheerioLoad, type CheerioAPI } from 'cheerio';
import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { logInfo } from '../telemetry/logger';
import { cleanText } from '../utils/text';

// ─── Types (public — all backward-compatible) ────────────────────────────────

export type Seniority = 'c-level' | 'vp' | 'director' | 'manager' | 'senior' | 'mid' | 'junior' | null;
export type PhoneType = 'mobile' | 'office' | 'unknown';

export interface PersonDataEmail {
    address: string;
    confidence: number;
    source: string;
}

export interface PersonDataPhone {
    number: string;
    type: PhoneType;
    source: string;
}

export interface PersonDataCompany {
    name: string;
    domain: string;
    industry: string | null;
    size: string | null;
    description: string | null;
    socialLinks: Record<string, string>;
}

export interface PersonDataSocial {
    platform: string;
    url: string;
    confidence: number;
}

export interface PersonDataResult {
    firstName: string;
    lastName: string;
    fullName: string;
    emails: PersonDataEmail[];
    phones: PersonDataPhone[];
    jobTitle: string | null;
    headline: string | null;
    seniority: Seniority;
    department: string | null;
    company: PersonDataCompany | null;
    socialProfiles: PersonDataSocial[];
    location: string | null;
    timezone: string | null;
    sources: string[];
    overallConfidence: number;
    dataPoints: number;
}

export interface PersonDataFinderInput {
    firstName: string;
    lastName: string;
    domain?: string;
    companyName?: string;
    existingEmail?: string | null;
    existingPhone?: string | null;
    existingLinkedinUrl?: string | null;
}

// ─── Types (internal) ────────────────────────────────────────────────────────

interface ScrapedPage {
    url: string;
    html: string;
    $: CheerioAPI;
}

interface CompanyScrapeResult {
    company: PersonDataCompany;
    homepage: ScrapedPage;
    teamPageUrls: string[];
    contactPageUrls: string[];
    address: string | null;
}

interface DnsIntelligence {
    soaHostmaster: string | null;
    mxProvider: 'google' | 'microsoft' | 'zoho' | 'custom' | null;
    mxHost: string | null;
    hasSPF: boolean;
}

interface TeamMember {
    name: string;
    title: string | null;
    bio: string | null;
    email: string | null;
    phone: string | null;
    matchScore: number;
}

interface PhoneCandidate {
    raw: string;
    parsed: PhoneNumber;
    context: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SCRAPE_TIMEOUT_MS = 12_000;
const MAX_PAGE_SIZE_BYTES = 2_000_000;
const CIRCUIT_KEY = 'person_data_finder.web';
const RATE_LIMIT_DELAY_MS = 250;
const MAX_SUBPAGES = 5;

const companyCache = new Map<string, PersonDataCompany | null>();

// ─── Utility ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<ScrapedPage | null> {
    try {
        const res = await fetchWithRetryPolicy(
            url,
            {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
                },
            },
            {
                integration: 'person_data_finder.scrape',
                circuitKey: CIRCUIT_KEY,
                timeoutMs: SCRAPE_TIMEOUT_MS,
                maxAttempts: 2,
            },
        );
        if (!res.ok) return null;

        const contentLength = res.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_PAGE_SIZE_BYTES) return null;

        const html = await res.text();
        if (html.length > MAX_PAGE_SIZE_BYTES) return null;

        return { url, html, $: cheerioLoad(html) };
    } catch {
        return null;
    }
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{1,5}\)?[\s.-]?)?\d{2,5}[\s.-]?\d{2,5}[\s.-]?\d{0,5}/g;

function normalizeNameForMatch(name: string): string {
    return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ─── Fase 1: Company Intelligence ────────────────────────────────────────────

const TEAM_PAGE_PATTERNS = /\/(about|team|chi-siamo|leadership|our-team|people|staff|who-we-are|equipe|kontakt|kontakte|ueber-uns|unser-team|notre-equipe|nosotros)/i;
const CONTACT_PAGE_PATTERNS = /\/(contact|contatti|contacts|kontakt|contacto|contattaci|get-in-touch|reach-us|write-us|scrivici)/i;

/** Discover relevant pages from sitemap.xml */
async function discoverPagesFromSitemap(
    domain: string,
): Promise<{ team: string[]; contact: string[] }> {
    const result = { team: [] as string[], contact: [] as string[] };
    try {
        const sitemapPage = await fetchPage(`https://${domain}/sitemap.xml`);
        if (!sitemapPage) return result;

        const urls: string[] = [];
        // Cheerio parsing of XML <loc> tags
        sitemapPage.$('loc').each((_, el) => {
            const loc = sitemapPage.$(el).text().trim();
            if (loc) urls.push(loc);
        });
        // Regex fallback for malformed XML
        const locMatches = sitemapPage.html.match(/<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi) ?? [];
        for (const match of locMatches) {
            const url = match.replace(/<\/?loc>/gi, '').trim();
            if (url && !urls.includes(url)) urls.push(url);
        }

        for (const url of urls) {
            if (TEAM_PAGE_PATTERNS.test(url) && result.team.length < 3) result.team.push(url);
            else if (CONTACT_PAGE_PATTERNS.test(url) && result.contact.length < 2) result.contact.push(url);
        }
    } catch { /* sitemap not available */ }
    return result;
}

async function scrapeCompanyIntelligence(
    domain: string,
    companyName?: string,
): Promise<CompanyScrapeResult | null> {
    if (companyCache.has(domain)) {
        const cached = companyCache.get(domain);
        return cached
            ? { company: cached, homepage: null as unknown as ScrapedPage, teamPageUrls: [], contactPageUrls: [], address: null }
            : null;
    }

    const homepageUrl = `https://${domain}`;
    const page = await fetchPage(homepageUrl);
    if (!page) {
        companyCache.set(domain, null);
        return null;
    }

    const $ = page.$;

    // ── Title, meta, OpenGraph ──
    const title = cleanText($('title').first().text());
    const metaDescription = cleanText($('meta[name="description"]').attr('content'));
    const ogDescription = cleanText($('meta[property="og:description"]').attr('content'));
    const ogTitle = cleanText($('meta[property="og:title"]').attr('content'));

    // ── Schema.org (Organization, LocalBusiness, Corporation) ──
    let schemaOrg: Record<string, unknown> = {};
    let schemaAddress: string | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
            const type = json['@type'] as string;
            if (type === 'Organization' || type === 'LocalBusiness' || type === 'Corporation') {
                schemaOrg = json;
                // Extract address from schema.org PostalAddress
                const addr = json.address as Record<string, string> | undefined;
                if (addr) {
                    const parts = [
                        addr.streetAddress,
                        addr.postalCode,
                        addr.addressLocality,
                        addr.addressRegion,
                        addr.addressCountry,
                    ].filter(Boolean);
                    if (parts.length > 0) schemaAddress = parts.join(', ');
                }
            }
        } catch { /* skip malformed JSON-LD */ }
    });

    // ── Social links (expanded: 7 platforms) ──
    const socialLinks: Record<string, string> = {};
    $('a[href]').each((_, el) => {
        const href = ($(el).attr('href') ?? '').trim();
        if (!href || href === '#') return;
        if (/linkedin\.com\/(company|in)\//i.test(href)) socialLinks.linkedin = href;
        else if (/twitter\.com\/|x\.com\//i.test(href)) socialLinks.twitter = href;
        else if (/github\.com\//i.test(href) && !href.endsWith('github.com/')) socialLinks.github = href;
        else if (/facebook\.com\//i.test(href) && !href.endsWith('facebook.com/')) socialLinks.facebook = href;
        else if (/instagram\.com\//i.test(href) && !href.endsWith('instagram.com/')) socialLinks.instagram = href;
        else if (/youtube\.com\/(c|channel|@)/i.test(href)) socialLinks.youtube = href;
        else if (/tiktok\.com\/@/i.test(href)) socialLinks.tiktok = href;
    });

    // Also extract from schema.org sameAs
    const sameAs = schemaOrg.sameAs;
    if (Array.isArray(sameAs)) {
        for (const url of sameAs as string[]) {
            if (/linkedin\.com/i.test(url) && !socialLinks.linkedin) socialLinks.linkedin = url;
            else if (/twitter\.com|x\.com/i.test(url) && !socialLinks.twitter) socialLinks.twitter = url;
            else if (/facebook\.com/i.test(url) && !socialLinks.facebook) socialLinks.facebook = url;
            else if (/instagram\.com/i.test(url) && !socialLinks.instagram) socialLinks.instagram = url;
            else if (/youtube\.com/i.test(url) && !socialLinks.youtube) socialLinks.youtube = url;
        }
    }

    // ── Industry, size, description ──
    const industry = (schemaOrg.industry as string) || null;
    const numEmployees = schemaOrg.numberOfEmployees;
    let size: string | null = null;
    if (typeof numEmployees === 'string') size = numEmployees;
    else if (typeof numEmployees === 'object' && numEmployees !== null) {
        const ne = numEmployees as Record<string, unknown>;
        if (ne.value) size = String(ne.value);
        else if (ne.minValue && ne.maxValue) size = `${ne.minValue}-${ne.maxValue}`;
    }
    const description = metaDescription || ogDescription || (schemaOrg.description as string) || null;

    // ── Discover team + contact page links from homepage ──
    const teamPageUrls: string[] = [];
    const contactPageUrls: string[] = [];
    $('a[href]').each((_, el) => {
        const href = ($(el).attr('href') ?? '').trim();
        if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        const fullUrl = href.startsWith('http')
            ? href
            : `${homepageUrl}${href.startsWith('/') ? '' : '/'}${href}`;
        // Avoid external links
        try {
            if (new URL(fullUrl).hostname.replace(/^www\./, '') !== domain) return;
        } catch {
            return;
        }
        if (TEAM_PAGE_PATTERNS.test(href) && teamPageUrls.length < 3) teamPageUrls.push(fullUrl);
        if (CONTACT_PAGE_PATTERNS.test(href) && contactPageUrls.length < 2) contactPageUrls.push(fullUrl);
    });

    // ── Sitemap.xml discovery ──
    const sitemapPages = await discoverPagesFromSitemap(domain);
    for (const url of sitemapPages.team) {
        if (!teamPageUrls.includes(url) && teamPageUrls.length < 3) teamPageUrls.push(url);
    }
    for (const url of sitemapPages.contact) {
        if (!contactPageUrls.includes(url) && contactPageUrls.length < 2) contactPageUrls.push(url);
    }

    const company: PersonDataCompany = {
        name: companyName || (schemaOrg.name as string) || ogTitle || title.split(/[|–—-]/)[0]?.trim() || domain,
        domain,
        industry,
        size,
        description,
        socialLinks,
    };

    companyCache.set(domain, company);
    return { company, homepage: page, teamPageUrls, contactPageUrls, address: schemaAddress };
}

// ─── Fase 2: DNS Intelligence ────────────────────────────────────────────────

const MX_PROVIDER_MAP: Array<{ pattern: RegExp; provider: DnsIntelligence['mxProvider'] }> = [
    { pattern: /google\.com|googlemail\.com|smtp\.google/i, provider: 'google' },
    { pattern: /outlook\.com|microsoft\.com|office365\.com|hotmail\.com/i, provider: 'microsoft' },
    { pattern: /zoho\.com|zoho\.eu|zoho\.in/i, provider: 'zoho' },
];

async function gatherDnsIntelligence(domain: string): Promise<DnsIntelligence> {
    const result: DnsIntelligence = {
        soaHostmaster: null,
        mxProvider: null,
        mxHost: null,
        hasSPF: false,
    };

    const [soaResult, mxResult, txtResult] = await Promise.allSettled([
        dns.promises.resolveSoa(domain),
        dns.promises.resolveMx(domain),
        dns.promises.resolveTxt(domain),
    ]);

    // SOA → hostmaster email hint
    if (soaResult.status === 'fulfilled' && soaResult.value) {
        result.soaHostmaster = soaResult.value.hostmaster ?? null;
    }

    // MX → email provider detection
    if (mxResult.status === 'fulfilled' && mxResult.value?.length) {
        mxResult.value.sort((a, b) => a.priority - b.priority);
        const primaryMx = mxResult.value[0]?.exchange;
        if (!primaryMx) return result;
        result.mxHost = primaryMx;
        for (const { pattern, provider } of MX_PROVIDER_MAP) {
            if (pattern.test(primaryMx)) {
                result.mxProvider = provider;
                break;
            }
        }
        if (!result.mxProvider) result.mxProvider = 'custom';
    }

    // TXT → SPF presence
    if (txtResult.status === 'fulfilled') {
        for (const record of txtResult.value) {
            const txt = record.join('');
            if (txt.startsWith('v=spf1')) {
                result.hasSPF = true;
                break;
            }
        }
    }

    return result;
}

// ─── Fase 3: Team Page Person Matching ───────────────────────────────────────

function parseTeamMembers($: CheerioAPI): TeamMember[] {
    const members: TeamMember[] = [];

    // Strategy 1: Schema.org Person entities
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
            if (json['@type'] === 'Person') {
                members.push({
                    name: cleanText(json.name as string),
                    title: cleanText(json.jobTitle as string) || null,
                    bio: cleanText(json.description as string) || null,
                    email: (json.email as string) || null,
                    phone: (json.telephone as string) || null,
                    matchScore: 0,
                });
            }
        } catch { /* skip */ }
    });

    // Strategy 2: Common team card CSS patterns
    const cardSelectors = [
        '.team-member',
        '.team-card',
        '.member-card',
        '.person-card',
        '.staff-member',
        '.leadership-card',
        '[class*="team-member"]',
        '[class*="team_member"]',
        '.team__member',
        '.team-item',
        '[itemtype*="schema.org/Person"]',
    ];

    for (const selector of cardSelectors) {
        $(selector).each((_, el) => {
            const card = $(el);
            const name = cleanText(
                card.find('h2, h3, h4, .name, .member-name, [class*="name"]').first().text(),
            );
            if (!name || name.length > 60) return;

            const title =
                cleanText(
                    card
                        .find(
                            '.title, .role, .position, .job-title, [class*="title"], [class*="role"], [class*="position"]',
                        )
                        .first()
                        .text(),
                ) || null;
            const bio = cleanText(card.find('.bio, .description, .about, p').first().text())?.slice(0, 300) || null;

            let email: string | null = null;
            let phone: string | null = null;
            card.find('a[href^="mailto:"]').each((__, a) => {
                if (!email) email = ($(a).attr('href') ?? '').replace('mailto:', '').split('?')[0]?.trim() ?? '';
            });
            card.find('a[href^="tel:"]').each((__, a) => {
                if (!phone) phone = ($(a).attr('href') ?? '').replace('tel:', '').trim();
            });

            members.push({ name, title, bio, email, phone, matchScore: 0 });
        });
        if (members.length > 0) break; // Use first matching selector
    }

    // Strategy 3: Generic heading + paragraph (less reliable)
    if (members.length === 0) {
        $('article, .entry, [class*="member"], [class*="person"]').each((_, el) => {
            const block = $(el);
            const heading = cleanText(block.find('h2, h3, h4').first().text());
            if (!heading || heading.length > 60 || heading.split(/\s+/).length > 5) return;

            members.push({
                name: heading,
                title: cleanText(block.find('p, .subtitle, span').first().text())?.slice(0, 100) || null,
                bio: null,
                email: null,
                phone: null,
                matchScore: 0,
            });
        });
    }

    return members;
}

function matchPersonToTeamMembers(
    members: TeamMember[],
    firstName: string,
    lastName: string,
): TeamMember | null {
    const firstNorm = normalizeNameForMatch(firstName);
    const lastNorm = normalizeNameForMatch(lastName);
    const fullNorm = `${firstNorm} ${lastNorm}`;

    let bestMatch: TeamMember | null = null;
    let bestScore = 0;

    for (const member of members) {
        const memberNorm = normalizeNameForMatch(member.name);
        let score = 0;

        if (memberNorm === fullNorm) {
            score = 100;
        } else if (memberNorm.includes(fullNorm) || fullNorm.includes(memberNorm)) {
            score = 85;
        } else if (memberNorm.includes(firstNorm) && memberNorm.includes(lastNorm)) {
            score = 80;
        } else if (memberNorm.includes(lastNorm) && lastNorm.length >= 4 && firstNorm[0] && memberNorm.startsWith(firstNorm[0])) {
            score = 60;
        } else if (memberNorm.includes(lastNorm) && lastNorm.length >= 4) {
            score = 40;
        }

        if (score > bestScore) {
            bestScore = score;
            member.matchScore = score;
            bestMatch = member;
        }
    }

    return bestScore >= 40 ? bestMatch : null;
}

async function findPersonOnTeamPages(
    teamPageUrls: string[],
    firstName: string,
    lastName: string,
): Promise<TeamMember | null> {
    for (const url of teamPageUrls.slice(0, 3)) {
        await delay(RATE_LIMIT_DELAY_MS);
        const teamPage = await fetchPage(url);
        if (!teamPage) continue;

        const members = parseTeamMembers(teamPage.$);
        if (members.length === 0) continue;

        const matched = matchPersonToTeamMembers(members, firstName, lastName);
        if (matched) return matched;
    }
    return null;
}

// ─── Fase 4: Email Discovery from Web Pages ─────────────────────────────────

function extractEmailsFromPage(
    $: CheerioAPI,
    firstName: string,
    lastName: string,
): PersonDataEmail[] {
    const emails: PersonDataEmail[] = [];
    const seen = new Set<string>();
    const firstLower = firstName.toLowerCase();
    const lastLower = lastName.toLowerCase();

    // 1. mailto: links
    $('a[href^="mailto:"]').each((_, el) => {
        const email = ($(el).attr('href') ?? '')
            .replace(/^mailto:/i, '')
            .split('?')[0]?.trim().toLowerCase() ?? '';
        if (!email || seen.has(email) || !EMAIL_REGEX.test(email)) return;
        // Reset regex lastIndex since it's global
        EMAIL_REGEX.lastIndex = 0;
        seen.add(email);

        const isCorrelated = email.includes(firstLower) || email.includes(lastLower);
        emails.push({
            address: email,
            confidence: isCorrelated ? 70 : 30,
            source: isCorrelated ? 'webpage_mailto_correlated' : 'webpage_mailto',
        });
    });

    // 2. Schema.org email property
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
            const schemaEmail = ((json.email as string) ?? '').trim().toLowerCase();
            if (schemaEmail && !seen.has(schemaEmail)) {
                seen.add(schemaEmail);
                const isCorrelated = schemaEmail.includes(firstLower) || schemaEmail.includes(lastLower);
                emails.push({
                    address: schemaEmail,
                    confidence: isCorrelated ? 75 : 35,
                    source: 'schema_org_email',
                });
            }
        } catch { /* skip */ }
    });

    // 3. Regex on visible text (only name-correlated — uncorrelated is too noisy)
    const bodyText = cleanText($('body').text());
    let match: RegExpExecArray | null;
    EMAIL_REGEX.lastIndex = 0;
    while ((match = EMAIL_REGEX.exec(bodyText)) !== null) {
        const email = match[0].toLowerCase();
        if (seen.has(email)) continue;
        // Skip generic addresses
        if (/^(info|support|help|admin|contact|noreply|no-reply|privacy|sales|hello|ciao|webmaster)@/i.test(email))
            continue;
        seen.add(email);

        const isCorrelated = email.includes(firstLower) || email.includes(lastLower);
        if (isCorrelated) {
            emails.push({
                address: email,
                confidence: 55,
                source: 'webpage_text_correlated',
            });
        }
    }

    return emails;
}

/** Convert DNS SOA hostmaster to email hint (hostmaster format: admin.example.com → admin@example.com) */
function soaToEmailHint(soaHostmaster: string, domain: string): string | null {
    if (!soaHostmaster) return null;
    // SOA hostmaster format: first-part.domain.tld (first dot is @)
    const parts = soaHostmaster.split('.');
    if (parts.length < 3 || !parts[0]) return null;
    const localPart = parts[0];
    const emailDomain = parts.slice(1).join('.');
    // Only useful if it's our target domain
    if (emailDomain.replace(/\.$/, '') !== domain) return null;
    // Skip generic hostmaster names
    if (/^(hostmaster|postmaster|dns-admin|dnsadmin|admin)$/i.test(localPart)) return null;
    return `${localPart}@${emailDomain.replace(/\.$/, '')}`;
}

// ─── Fase 5: Phone Discovery ─────────────────────────────────────────────────

function extractPhoneNumbers(html: string, $?: CheerioAPI): PhoneCandidate[] {
    const candidates: PhoneCandidate[] = [];
    const seen = new Set<string>();

    if ($) {
        // tel: links (highest reliability)
        $('a[href^="tel:"]').each((_, el) => {
            const raw = ($(el).attr('href') ?? '').replace('tel:', '').trim();
            const parsed = parsePhoneNumberFromString(raw, 'IT');
            if (parsed?.isValid() && !seen.has(parsed.number)) {
                seen.add(parsed.number);
                const context = cleanText($(el).parent().text()).slice(0, 200);
                candidates.push({ raw, parsed, context });
            }
        });

        // Schema.org telephone property
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
                const tel = (json.telephone as string) ?? '';
                if (tel) {
                    const parsed = parsePhoneNumberFromString(tel, 'IT');
                    if (parsed?.isValid() && !seen.has(parsed.number)) {
                        seen.add(parsed.number);
                        candidates.push({ raw: tel, parsed, context: 'schema.org telephone' });
                    }
                }
            } catch { /* skip */ }
        });
    }

    // Regex on visible text
    const textContent = $ ? cleanText($('body').text()) : html;
    const matches = textContent.match(PHONE_REGEX) ?? [];
    for (const raw of matches) {
        const trimmed = raw.trim();
        if (trimmed.length < 7) continue;
        const parsed = parsePhoneNumberFromString(trimmed, 'IT');
        if (parsed?.isValid() && !seen.has(parsed.number)) {
            seen.add(parsed.number);
            const idx = textContent.indexOf(trimmed);
            const context = textContent.slice(Math.max(0, idx - 80), idx + trimmed.length + 80);
            candidates.push({ raw: trimmed, parsed, context });
        }
    }

    return candidates;
}

function classifyPhoneType(phone: PhoneNumber): PhoneType {
    const type = phone.getType();
    if (type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE') return 'mobile';
    if (type === 'FIXED_LINE' || type === 'TOLL_FREE' || type === 'SHARED_COST') return 'office';
    return 'unknown';
}

function correlatePhoneToName(
    candidates: PhoneCandidate[],
    firstName: string,
    lastName: string,
): PersonDataPhone[] {
    const firstLower = firstName.toLowerCase();
    const lastLower = lastName.toLowerCase();

    return candidates.map((c) => {
        const contextLower = c.context.toLowerCase();
        const nameNearby = contextLower.includes(firstLower) || contextLower.includes(lastLower);
        return {
            number: c.parsed.formatInternational(),
            type: classifyPhoneType(c.parsed),
            source: nameNearby ? 'company_website_correlated' : 'company_website',
        };
    });
}

async function discoverPhones(
    homepage: ScrapedPage | null,
    contactPageUrls: string[],
    teamPageUrls: string[],
    firstName: string,
    lastName: string,
): Promise<PersonDataPhone[]> {
    const allCandidates: PhoneCandidate[] = [];

    // Homepage phones (often has main office number)
    if (homepage) {
        allCandidates.push(...extractPhoneNumbers(homepage.html, homepage.$));
    }

    // Contact page(s)
    let pagesScraped = 0;
    for (const url of contactPageUrls.slice(0, 2)) {
        if (pagesScraped >= MAX_SUBPAGES) break;
        await delay(RATE_LIMIT_DELAY_MS);
        const contactPage = await fetchPage(url);
        if (contactPage) {
            allCandidates.push(...extractPhoneNumbers(contactPage.html, contactPage.$));
            pagesScraped++;
        }
    }

    // Team page(s) — may correlate name to phone
    for (const url of teamPageUrls.slice(0, 2)) {
        if (pagesScraped >= MAX_SUBPAGES) break;
        await delay(RATE_LIMIT_DELAY_MS);
        const teamPage = await fetchPage(url);
        if (teamPage) {
            allCandidates.push(...extractPhoneNumbers(teamPage.html, teamPage.$));
            pagesScraped++;
        }
    }

    // Deduplicate by international number
    const seen = new Set<string>();
    const unique = allCandidates.filter((c) => {
        if (seen.has(c.parsed.number)) return false;
        seen.add(c.parsed.number);
        return true;
    });

    return correlatePhoneToName(unique, firstName, lastName);
}

// ─── Fase 6: Social Profile Aggregation ──────────────────────────────────────

async function searchGitHub(
    fullName: string,
    companyName?: string,
): Promise<PersonDataSocial | null> {
    try {
        const query = companyName ? `${fullName} ${companyName}` : fullName;
        const res = await fetchWithRetryPolicy(
            `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=5`,
            {
                method: 'GET',
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'PersonDataFinder/2.0',
                },
            },
            {
                integration: 'person_data_finder.github',
                circuitKey: 'person_data_finder.github',
                timeoutMs: 8_000,
                maxAttempts: 1,
            },
        );
        if (!res.ok) return null;

        const data = (await res.json()) as {
            items?: Array<{
                html_url?: string;
                login?: string;
                name?: string;
                company?: string;
            }>;
        };
        if (!data.items?.length) return null;

        // Find best match: prioritize company verification
        const nameNorm = normalizeNameForMatch(fullName);
        const companyNorm = companyName ? normalizeNameForMatch(companyName) : '';

        let bestMatch = data.items[0];
        if (!bestMatch) return null;
        let bestConfidence = 25;

        for (const item of data.items) {
            let confidence = 25;
            if (item.name && normalizeNameForMatch(item.name) === nameNorm) confidence += 20;
            if (companyNorm && item.company && normalizeNameForMatch(item.company).includes(companyNorm))
                confidence += 25;
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestMatch = item;
            }
        }

        if (!bestMatch.html_url) return null;

        return {
            platform: 'github',
            url: bestMatch.html_url,
            confidence: bestConfidence,
        };
    } catch {
        return null;
    }
}

async function searchGravatar(email: string): Promise<PersonDataSocial | null> {
    if (!email) return null;
    try {
        const hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
        const res = await fetchWithRetryPolicy(
            `https://www.gravatar.com/${hash}.json`,
            { method: 'GET' },
            {
                integration: 'person_data_finder.gravatar',
                circuitKey: 'person_data_finder.gravatar',
                timeoutMs: 5_000,
                maxAttempts: 1,
            },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as {
            entry?: Array<{ profileUrl?: string }>;
        };
        const entry = data.entry?.[0];
        if (!entry?.profileUrl) return null;

        return {
            platform: 'gravatar',
            url: entry.profileUrl,
            confidence: 60,
        };
    } catch {
        return null;
    }
}

async function searchStackOverflow(fullName: string): Promise<PersonDataSocial | null> {
    try {
        const res = await fetchWithRetryPolicy(
            `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${encodeURIComponent(fullName)}&site=stackoverflow&pagesize=3&filter=!nNPvSNdWme`,
            { method: 'GET' },
            {
                integration: 'person_data_finder.stackoverflow',
                circuitKey: 'person_data_finder.stackoverflow',
                timeoutMs: 8_000,
                maxAttempts: 1,
            },
        );
        if (!res.ok) return null;

        const data = (await res.json()) as {
            items?: Array<{ link?: string; display_name?: string; reputation?: number }>;
        };
        const first = data.items?.[0];
        if (!first?.link || !first.reputation || first.reputation < 100) return null;

        const nameMatch =
            first.display_name && normalizeNameForMatch(first.display_name) === normalizeNameForMatch(fullName);
        return {
            platform: 'stackoverflow',
            url: first.link,
            confidence: nameMatch ? 45 : 20,
        };
    } catch {
        return null;
    }
}

async function aggregateSocialProfiles(
    firstName: string,
    lastName: string,
    email: string | null,
    companySocialLinks: Record<string, string>,
    companyName?: string,
): Promise<PersonDataSocial[]> {
    const profiles: PersonDataSocial[] = [];

    // All company social links
    for (const [platform, url] of Object.entries(companySocialLinks)) {
        profiles.push({
            platform: `${platform}_company`,
            url,
            confidence: platform === 'linkedin' ? 80 : 70,
        });
    }

    // Search APIs in parallel
    const fullName = `${firstName} ${lastName}`;
    const [github, gravatar, stackoverflow] = await Promise.all([
        searchGitHub(fullName, companyName),
        email ? searchGravatar(email) : Promise.resolve(null),
        searchStackOverflow(fullName),
    ]);

    if (github) profiles.push(github);
    if (gravatar) profiles.push(gravatar);
    if (stackoverflow) profiles.push(stackoverflow);

    return profiles;
}

// ─── Fase 7: Data Fusion & Scoring ───────────────────────────────────────────

const SENIORITY_PATTERNS: Array<{ pattern: RegExp; level: Seniority }> = [
    { pattern: /\b(ceo|cto|cfo|coo|cmo|founder|co-founder|chief|presidente|amministratore\s+delegato|managing\s+director)\b/i, level: 'c-level' },
    { pattern: /\b(vp|vice\s*president|vice\s*presidente|svp|evp)\b/i, level: 'vp' },
    { pattern: /\b(director|direttore|head\s+of|country\s+manager)\b/i, level: 'director' },
    { pattern: /\b(manager|responsabile|team\s+lead|group\s+lead|coordinat)\b/i, level: 'manager' },
    { pattern: /\b(senior|sr\.?|lead|principal|staff)\b/i, level: 'senior' },
    { pattern: /\b(junior|jr\.?|entry|stage|intern|stagista|tirocinante|apprentice|trainee)\b/i, level: 'junior' },
];

function inferSeniority(title: string | null): Seniority {
    if (!title) return null;
    for (const { pattern, level } of SENIORITY_PATTERNS) {
        if (pattern.test(title)) return level;
    }
    return 'mid';
}

const DEPARTMENT_PATTERNS: Array<{ pattern: RegExp; dept: string }> = [
    { pattern: /\b(engineer|developer|software|tech|it|devops|sre|infrastructure|backend|frontend|fullstack|architect|programmer|data\s+scientist)\b/i, dept: 'Engineering' },
    { pattern: /\b(sales|vendite|account\s*executive|business\s*development|bdr|sdr|revenue|commercial)\b/i, dept: 'Sales' },
    { pattern: /\b(marketing|growth|seo|sem|content|brand|comunicazione|demand\s+gen|digital\s+marketing)\b/i, dept: 'Marketing' },
    { pattern: /\b(hr|human\s*resources|talent|recruiting|risorse\s*umane|people\s+ops|people\s+operations)\b/i, dept: 'HR' },
    { pattern: /\b(finance|accounting|contabilit|cfo|financial|controller|treasury)\b/i, dept: 'Finance' },
    { pattern: /\b(legal|legale|compliance|privacy|counsel|attorney)\b/i, dept: 'Legal' },
    { pattern: /\b(design|ux|ui|product\s*design|graphic|creative\s+director)\b/i, dept: 'Design' },
    { pattern: /\b(operations|ops|supply\s*chain|logistics|logistica|procurement)\b/i, dept: 'Operations' },
    { pattern: /\b(product\s+manag|product\s+own|pm\b)/i, dept: 'Product' },
    { pattern: /\b(customer\s+success|cs\s+manager|support|assistenza|customer\s+service)\b/i, dept: 'Customer Success' },
];

function inferDepartment(title: string | null): string | null {
    if (!title) return null;
    for (const { pattern, dept } of DEPARTMENT_PATTERNS) {
        if (pattern.test(title)) return dept;
    }
    return null;
}

function computeOverallConfidence(result: PersonDataResult): number {
    let weightedScore = 0;
    let totalWeight = 0;

    // Email confidence (high weight — most valuable data point)
    if (result.emails.length > 0) {
        const bestEmail = Math.max(...result.emails.map((e) => e.confidence));
        weightedScore += bestEmail * 3;
        totalWeight += 3;
    }

    // Phone confidence (weighted by correlation)
    if (result.phones.length > 0) {
        const hasCorrelated = result.phones.some((p) => p.source.includes('correlated'));
        weightedScore += (hasCorrelated ? 70 : 45) * 2;
        totalWeight += 2;
    }

    // Company intelligence (weighted by completeness)
    if (result.company) {
        const filledFields = [
            result.company.industry,
            result.company.size,
            result.company.description,
        ].filter(Boolean).length;
        weightedScore += (40 + filledFields * 10) * 2;
        totalWeight += 2;
    }

    // Social profiles
    if (result.socialProfiles.length > 0) {
        const bestSocial = Math.max(...result.socialProfiles.map((s) => s.confidence));
        weightedScore += bestSocial * 1.5;
        totalWeight += 1.5;
    }

    // Job title / seniority / department
    if (result.jobTitle) {
        weightedScore += 50;
        totalWeight += 1;
    }
    if (result.seniority) {
        weightedScore += 30;
        totalWeight += 0.5;
    }
    if (result.department) {
        weightedScore += 25;
        totalWeight += 0.5;
    }

    // Location
    if (result.location) {
        weightedScore += 25;
        totalWeight += 0.5;
    }

    // Cross-reference bonus: multiple independent sources
    const uniqueSources = new Set(result.sources);
    if (uniqueSources.size >= 4) weightedScore += 25;
    else if (uniqueSources.size >= 3) weightedScore += 15;
    else if (uniqueSources.size >= 2) weightedScore += 8;

    // Name-correlated data bonus
    const correlatedEmails = result.emails.filter((e) => e.source.includes('correlated')).length;
    const correlatedPhones = result.phones.filter((p) => p.source.includes('correlated')).length;
    if (correlatedEmails > 0) weightedScore += 15;
    if (correlatedPhones > 0) weightedScore += 10;

    return totalWeight > 0 ? Math.min(100, Math.round(weightedScore / totalWeight)) : 0;
}

function countDataPoints(result: PersonDataResult): number {
    let count = 0;
    if (result.firstName) count++;
    if (result.lastName) count++;
    count += result.emails.length;
    count += result.phones.length;
    if (result.jobTitle) count++;
    if (result.headline) count++;
    if (result.seniority) count++;
    if (result.department) count++;
    if (result.company) count += Object.values(result.company).filter(Boolean).length;
    count += result.socialProfiles.length;
    if (result.location) count++;
    if (result.timezone) count++;
    return count;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Trova tutti i dati disponibili di una persona da fonti pubbliche.
 * Pipeline a 7 fasi: company intel → DNS → team matching → email discovery →
 * phone discovery → social aggregation → data fusion.
 */
export async function findPersonData(input: PersonDataFinderInput): Promise<PersonDataResult> {
    const { firstName, lastName, domain, companyName, existingEmail, existingPhone, existingLinkedinUrl } = input;
    const startTime = Date.now();
    const sources: string[] = [];

    const result: PersonDataResult = {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        emails: [],
        phones: [],
        jobTitle: null,
        headline: null,
        seniority: null,
        department: null,
        company: null,
        socialProfiles: [],
        location: null,
        timezone: null,
        sources: [],
        overallConfidence: 0,
        dataPoints: 0,
    };

    // Seed with existing data
    if (existingEmail) {
        result.emails.push({ address: existingEmail, confidence: 90, source: 'existing_db' });
    }
    if (existingPhone) {
        result.phones.push({ number: existingPhone, type: 'unknown', source: 'existing_db' });
    }
    if (existingLinkedinUrl) {
        result.socialProfiles.push({ platform: 'linkedin', url: existingLinkedinUrl, confidence: 95 });
    }

    // ── Fase 1: Company Intelligence ──
    let companyResult: CompanyScrapeResult | null = null;
    let dnsIntel: DnsIntelligence | null = null;

    if (domain) {
        // Run company scraping and DNS intelligence in parallel
        const [companyRes, dnsRes] = await Promise.all([
            scrapeCompanyIntelligence(domain, companyName),
            gatherDnsIntelligence(domain),
        ]);
        companyResult = companyRes;
        dnsIntel = dnsRes;

        if (companyResult) {
            result.company = companyResult.company;
            sources.push('company_website');

            if (companyResult.company.description) {
                result.headline = companyResult.company.description.slice(0, 200);
            }
            if (companyResult.address) {
                result.location = companyResult.address;
            }
        }

        if (dnsIntel?.mxHost) {
            sources.push('dns_intelligence');
        }
    }

    // ── Fase 3: Team Page Person Matching ──
    let teamMatch: TeamMember | null = null;
    if (companyResult?.teamPageUrls.length) {
        teamMatch = await findPersonOnTeamPages(companyResult.teamPageUrls, firstName, lastName);
        if (teamMatch) {
            sources.push('team_page_match');
            // Merge data from team page
            if (teamMatch.title && !result.jobTitle) result.jobTitle = teamMatch.title;
            if (teamMatch.bio && !result.headline) result.headline = teamMatch.bio.slice(0, 200);
            if (teamMatch.email) {
                const teamEmail = teamMatch.email.toLowerCase();
                const alreadyHas = result.emails.some(
                    (e) => e.address.toLowerCase() === teamEmail,
                );
                if (!alreadyHas) {
                    result.emails.push({
                        address: teamMatch.email,
                        confidence: teamMatch.matchScore >= 80 ? 85 : 65,
                        source: 'team_page_correlated',
                    });
                }
            }
            if (teamMatch.phone) {
                const parsed = parsePhoneNumberFromString(teamMatch.phone, 'IT');
                if (parsed?.isValid()) {
                    const alreadyHas = result.phones.some(
                        (p) => p.number === parsed.formatInternational(),
                    );
                    if (!alreadyHas) {
                        result.phones.push({
                            number: parsed.formatInternational(),
                            type: classifyPhoneType(parsed),
                            source: 'team_page_correlated',
                        });
                    }
                }
            }
        }
    }

    // ── Fase 4: Email Discovery from Web Pages ──
    if (companyResult?.homepage) {
        const pageEmails = extractEmailsFromPage(companyResult.homepage.$, firstName, lastName);
        // Merge (dedup by address)
        const existingAddresses = new Set(result.emails.map((e) => e.address.toLowerCase()));
        for (const email of pageEmails) {
            if (!existingAddresses.has(email.address.toLowerCase())) {
                result.emails.push(email);
                existingAddresses.add(email.address.toLowerCase());
            }
        }
        if (pageEmails.length > 0) sources.push('web_email_discovery');
    }

    // DNS SOA email hint
    if (dnsIntel?.soaHostmaster && domain) {
        const soaEmail = soaToEmailHint(dnsIntel.soaHostmaster, domain);
        if (soaEmail) {
            const alreadyHas = result.emails.some(
                (e) => e.address.toLowerCase() === soaEmail.toLowerCase(),
            );
            if (!alreadyHas) {
                result.emails.push({
                    address: soaEmail,
                    confidence: 20,
                    source: 'dns_soa_hint',
                });
            }
        }
    }

    // ── Fase 5: Phone Discovery ──
    if (domain) {
        const phones = await discoverPhones(
            companyResult?.homepage ?? null,
            companyResult?.contactPageUrls ?? [],
            companyResult?.teamPageUrls ?? [],
            firstName,
            lastName,
        );
        if (phones.length > 0) {
            // Merge (dedup by number)
            const existingNumbers = new Set(result.phones.map((p) => p.number));
            for (const phone of phones) {
                if (!existingNumbers.has(phone.number)) {
                    result.phones.push(phone);
                    existingNumbers.add(phone.number);
                }
            }
            sources.push('phone_discovery');
        }
    }

    // ── Fase 6: Social Profile Aggregation ──
    const socialProfiles = await aggregateSocialProfiles(
        firstName,
        lastName,
        existingEmail ?? result.emails[0]?.address ?? null,
        companyResult?.company.socialLinks ?? {},
        companyName,
    );
    // Merge (dedup by platform+url)
    const existingSocials = new Set(result.socialProfiles.map((s) => `${s.platform}:${s.url}`));
    for (const profile of socialProfiles) {
        const key = `${profile.platform}:${profile.url}`;
        if (!existingSocials.has(key)) {
            result.socialProfiles.push(profile);
            existingSocials.add(key);
        }
    }
    if (socialProfiles.length > 0) sources.push('social_aggregation');

    // ── Fase 7: Inference & Scoring ──
    result.seniority = inferSeniority(result.jobTitle);
    result.department = inferDepartment(result.jobTitle);

    // Sort emails by confidence (best first), phones by correlation
    result.emails.sort((a, b) => b.confidence - a.confidence);
    result.phones.sort((a, b) => {
        const aCorr = a.source.includes('correlated') ? 1 : 0;
        const bCorr = b.source.includes('correlated') ? 1 : 0;
        return bCorr - aCorr;
    });

    result.sources = sources;
    result.overallConfidence = computeOverallConfidence(result);
    result.dataPoints = countDataPoints(result);

    const durationMs = Date.now() - startTime;
    void logInfo('person_data_finder.complete', {
        firstName,
        lastName,
        domain: domain ?? null,
        emailsFound: result.emails.length,
        phonesFound: result.phones.length,
        socialProfilesFound: result.socialProfiles.length,
        teamPageMatched: !!teamMatch,
        dnsProvider: dnsIntel?.mxProvider ?? null,
        dataPoints: result.dataPoints,
        overallConfidence: result.overallConfidence,
        sources: sources.join(','),
        durationMs,
    });

    return result;
}

