/**
 * leadEnricher.ts — Lead Enrichment Pipeline (v2)
 *
 * Catena multi-sorgente per trovare email, telefono e dati professionali:
 *   0. Domain Discovery (Clearbit autocomplete + DNS probe — GRATIS)
 *   1. Apollo.io (se configurato con piano a pagamento)
 *   2. Hunter.io (se configurato)
 *   3. Email Guesser (pattern + SMTP — zero API, richiede dominio)
 *   4. Clearbit Prospector (se configurato)
 *   5. Person Data Finder (OSINT 7-fase — zero API, richiede dominio)
 *
 * La Domain Discovery è il pezzo chiave: trasforma il nome azienda in un dominio
 * reale, abilitando EmailGuesser e PersonDataFinder anche senza API a pagamento.
 *
 * Env opzionali:
 *   APOLLO_API_KEY   — Apollo.io API key
 *   HUNTER_API_KEY   — Hunter.io API key
 *   CLEARBIT_API_KEY — Clearbit Secret Key
 */

import { config } from '../config';
import { logInfo } from '../telemetry/logger';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { guessBusinessEmail } from './emailGuesser';
import { findPersonData, type PersonDataResult } from './personDataFinder';
import { discoverCompanyDomain, type DomainSource } from './domainDiscovery';
import { searchWebForPersonData, type WebSearchResult } from './webSearchEnricher';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface EnrichmentResult {
    email: string | null;
    emailConfidence: number; // 0–100
    /** Email aziendale (name@company.com) — sempre cercata anche se email personale esiste */
    businessEmail: string | null;
    businessEmailConfidence: number;
    phone: string | null;
    jobTitle: string | null;
    companyName: string | null;
    companyDomain: string | null;
    linkedinUrl: string | null;
    headline: string | null;
    location: string | null;
    industry: string | null;
    seniority: string | null;
    source: 'apollo' | 'hunter' | 'email_guesser' | 'clearbit' | 'person_data_finder' | 'none';
    /** Come il dominio è stato scoperto */
    domainSource?: DomainSource | 'website' | null;
    /** Deep enrichment via Person Data Finder (OSINT) */
    deepEnrichment?: PersonDataResult | null;
    /** Web search enrichment (DuckDuckGo) */
    webSearchData?: WebSearchResult | null;
    /** Per-field source provenance — JSON for DB storage */
    enrichmentSources?: Record<string, string>;
}

// ─── Personal Email Detection ────────────────────────────────────────────────

const PERSONAL_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'hotmail.it',
    'live.com',
    'live.it',
    'msn.com',
    'yahoo.com',
    'yahoo.it',
    'yahoo.fr',
    'yahoo.co.uk',
    'ymail.com',
    'aol.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'protonmail.com',
    'proton.me',
    'pm.me',
    'tutanota.com',
    'tutamail.com',
    'mail.com',
    'zoho.com',
    'gmx.com',
    'gmx.it',
    'gmx.de',
    'gmx.net',
    'fastmail.com',
    'libero.it',
    'virgilio.it',
    'alice.it',
    'tin.it',
    'tiscali.it',
    'email.it',
    'pec.it',
    'aruba.it',
    'posteo.de',
    'web.de',
    'freenet.de',
    'laposte.net',
    'orange.fr',
    'sfr.fr',
    'free.fr',
    'wanadoo.fr',
    'ziggo.nl',
    'kpnmail.nl',
    'xs4all.nl',
    'hetnet.nl',
]);

/** Ritorna true se l'email è personale (gmail, outlook, etc.) */
export function isPersonalEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const domain = email.split('@')[1]?.toLowerCase();
    return domain ? PERSONAL_EMAIL_DOMAINS.has(domain) : false;
}

/** Ritorna true se l'email è aziendale (non personale e non vuota) */
export function isBusinessEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return !isPersonalEmail(email);
}

const EMPTY_RESULT: EnrichmentResult = {
    email: null,
    emailConfidence: 0,
    businessEmail: null,
    businessEmailConfidence: 0,
    phone: null,
    jobTitle: null,
    companyName: null,
    companyDomain: null,
    linkedinUrl: null,
    headline: null,
    location: null,
    industry: null,
    seniority: null,
    source: 'none',
};

// ─── Apollo.io ────────────────────────────────────────────────────────────────

interface ApolloPersonMatch {
    first_name?: string;
    last_name?: string;
    email?: string;
    email_status?: string; // 'verified' | 'guessed' | 'unavailable'
    title?: string;
    headline?: string;
    linkedin_url?: string;
    phone_numbers?: Array<{ sanitized_number?: string }>;
    city?: string;
    state?: string;
    country?: string;
    seniority?: string;
    organization?: {
        name?: string;
        website_url?: string;
        industry?: string;
        primary_domain?: string;
    };
}

async function enrichViaApollo(
    firstName: string,
    lastName: string,
    opts: { domain?: string; linkedinUrl?: string; organizationName?: string },
): Promise<EnrichmentResult | null> {
    if (!config.apolloApiKey) return null;

    try {
        const body: Record<string, string> = {
            first_name: firstName,
            last_name: lastName,
        };
        if (opts.domain) body.domain = opts.domain;
        if (opts.linkedinUrl) body.linkedin_url = opts.linkedinUrl;
        if (opts.organizationName) body.organization_name = opts.organizationName;

        const res = await fetchWithRetryPolicy(
            'https://api.apollo.io/api/v1/people/match',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': config.apolloApiKey,
                },
                body: JSON.stringify(body),
            },
            {
                integration: 'apollo.people_match',
                circuitKey: 'apollo.api',
                timeoutMs: 10_000,
            },
        );

        if (!res.ok) return null;

        const data = (await res.json()) as { person?: ApolloPersonMatch };
        const p = data.person;
        if (!p) return null;

        const email = p.email && p.email_status !== 'unavailable' ? p.email : null;
        const phone = p.phone_numbers?.[0]?.sanitized_number || null;
        const org = p.organization;
        const locationParts = [p.city, p.state, p.country].filter(Boolean);

        return {
            email,
            emailConfidence: p.email_status === 'verified' ? 95 : p.email_status === 'guessed' ? 60 : 0,
            businessEmail: null,
            businessEmailConfidence: 0, // classificato dopo in enrichLead
            phone,
            jobTitle: p.title || null,
            companyName: org?.name || null,
            companyDomain: org?.primary_domain || org?.website_url || null,
            linkedinUrl: p.linkedin_url || null,
            headline: p.headline || null,
            location: locationParts.length > 0 ? locationParts.join(', ') : null,
            industry: org?.industry || null,
            seniority: p.seniority || null,
            source: 'apollo',
        };
    } catch {
        return null;
    }
}

// ─── Hunter.io ────────────────────────────────────────────────────────────────

async function enrichViaHunter(firstName: string, lastName: string, domain: string): Promise<EnrichmentResult | null> {
    if (!config.hunterApiKey || !domain) return null;

    try {
        const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${config.hunterApiKey}`;
        const res = await fetchWithRetryPolicy(
            url,
            {
                method: 'GET',
            },
            {
                integration: 'hunter.email_finder',
                circuitKey: 'hunter.api',
                timeoutMs: 8_000,
            },
        );

        if (!res.ok) return null;

        const data = (await res.json()) as {
            data?: { email?: string; confidence?: number; position?: string };
        };

        const email = data.data?.email || null;
        if (!email) return null;

        return {
            email,
            emailConfidence: data.data?.confidence ?? 0,
            businessEmail: null,
            businessEmailConfidence: 0,
            phone: null,
            jobTitle: data.data?.position ?? null,
            companyName: null,
            companyDomain: domain,
            linkedinUrl: null,
            headline: null,
            location: null,
            industry: null,
            seniority: null,
            source: 'hunter',
        };
    } catch {
        return null;
    }
}

// ─── Clearbit ─────────────────────────────────────────────────────────────────

async function enrichViaClearbit(
    firstName: string,
    lastName: string,
    domain: string,
): Promise<EnrichmentResult | null> {
    if (!config.clearbitApiKey || !domain) return null;

    try {
        const url = `https://prospector.clearbit.com/v2/people/find?domain=${encodeURIComponent(domain)}&name=${encodeURIComponent(`${firstName} ${lastName}`)}`;
        const auth = Buffer.from(`${config.clearbitApiKey}:`).toString('base64');
        const res = await fetchWithRetryPolicy(
            url,
            {
                headers: { Authorization: `Basic ${auth}` },
                method: 'GET',
            },
            {
                integration: 'clearbit.person_lookup',
                circuitKey: 'clearbit.api',
                timeoutMs: 8_000,
            },
        );

        if (!res.ok) return null;

        const data = (await res.json()) as {
            email?: string;
            phone?: string;
            title?: string;
        };

        const email = data.email || null;
        if (!email) return null;

        return {
            email,
            emailConfidence: 75, // Clearbit non espone confidence esplicita
            businessEmail: null,
            businessEmailConfidence: 0,
            phone: data.phone || null,
            jobTitle: data.title || null,
            companyName: null,
            companyDomain: domain,
            linkedinUrl: null,
            headline: null,
            location: null,
            industry: null,
            seniority: null,
            source: 'clearbit',
        };
    } catch {
        return null;
    }
}

// ─── Domain Extraction ────────────────────────────────────────────────────────

/** Estrae il dominio da un URL website. Solo parsing, nessuna euristica. */
function inferDomain(website?: string | null): string {
    const rawWebsite = (website ?? '').trim();
    if (!rawWebsite) return '';

    try {
        const parsed =
            rawWebsite.startsWith('http://') || rawWebsite.startsWith('https://')
                ? new URL(rawWebsite)
                : new URL(`https://${rawWebsite}`);
        return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        const fallback = rawWebsite
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .split('/')[0]
            ?.trim()
            .toLowerCase();
        return fallback || '';
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Arricchisce un lead con email e dati aggiuntivi tramite Hunter/Clearbit.
 * Restituisce il risultato dell'enrichment; la persistenza è demandata al chiamante.
 */
export async function enrichLead(
    leadId: number,
    firstName: string,
    lastName: string,
    domain: string,
    opts?: { linkedinUrl?: string; deep?: boolean; organizationName?: string },
): Promise<EnrichmentResult> {
    if (!firstName || !lastName) return EMPTY_RESULT;

    // Per-field source provenance tracking
    const sources: Record<string, string> = {};

    let result: EnrichmentResult | null = null;

    // 1. Apollo.io (più completo: email, phone, job title, company, industry, location)
    result = await enrichViaApollo(firstName, lastName, {
        domain,
        linkedinUrl: opts?.linkedinUrl,
        organizationName: opts?.organizationName,
    });

    if (result) {
        if (result.email) sources.email = 'apollo';
        if (result.phone) sources.phone = 'apollo';
        if (result.jobTitle) sources.job_title = 'apollo';
        if (result.companyName) sources.company = 'apollo';
        if (result.location) sources.location = 'apollo';
    }

    // 2. Hunter.io (fallback)
    if (!result) {
        result = await enrichViaHunter(firstName, lastName, domain);
        if (result?.email) sources.email = 'hunter';
        if (result?.jobTitle) sources.job_title = 'hunter';
    }

    // 3. Email Guesser (pattern + SMTP, zero API cost)
    if (!result && domain) {
        const guess = await guessBusinessEmail(firstName, lastName, domain);
        if (guess) {
            result = {
                email: guess.email,
                emailConfidence: guess.confidence,
                businessEmail: null,
                businessEmailConfidence: 0,
                phone: null,
                jobTitle: null,
                companyName: null,
                companyDomain: domain,
                linkedinUrl: null,
                headline: null,
                location: null,
                industry: null,
                seniority: null,
                source: 'email_guesser',
            };
            sources.email = 'email_guesser:smtp_verified';
        }
    }

    // 4. Clearbit (fallback)
    if (!result) {
        result = await enrichViaClearbit(firstName, lastName, domain);
        if (result?.email) sources.email = 'clearbit';
        if (result?.phone) sources.phone = 'clearbit';
        if (result?.jobTitle) sources.job_title = 'clearbit';
    }

    if (!result) {
        result = { ...EMPTY_RESULT };
    }

    // 5. Person Data Finder (OSINT — scraping, DNS, social)
    //    Sempre attivo se abbiamo un dominio (zero API cost).
    //    Il flag --deep controlla se eseguire tutte le 7 fasi o solo company intel.
    if (domain) {
        try {
            const personData = await findPersonData({
                firstName,
                lastName,
                domain,
                companyName: opts?.organizationName,
                existingEmail: result.email,
                existingPhone: result.phone,
                existingLinkedinUrl: opts?.linkedinUrl ?? result.linkedinUrl,
            });
            result.deepEnrichment = personData;

            // Merge email from PersonDataFinder if not already found
            if (!result.email && personData.emails.length > 0) {
                const bestEmail = personData.emails.reduce((a, b) => (a.confidence > b.confidence ? a : b));
                result.email = bestEmail.address;
                result.emailConfidence = bestEmail.confidence;
                result.source = 'person_data_finder';
                sources.email = `person_data_finder:${bestEmail.source}`;
            }
            // Merge phone from deep enrichment if not already found
            if (!result.phone && personData.phones.length > 0) {
                const firstPhone = personData.phones[0];
                if (firstPhone) {
                    result.phone = firstPhone.number;
                    sources.phone = `person_data_finder:${firstPhone.source}`;
                }
            }
            // Merge seniority if not already set
            if (!result.seniority && personData.seniority) {
                result.seniority = personData.seniority;
                sources.seniority = 'person_data_finder';
            }
            // Merge industry from company intel
            if (!result.industry && personData.company?.industry) {
                result.industry = personData.company.industry;
                sources.industry = 'person_data_finder:company_intel';
            }
            // Merge job title
            if (!result.jobTitle && personData.jobTitle) {
                result.jobTitle = personData.jobTitle;
                sources.job_title = 'person_data_finder:team_page';
            }
            // Merge company name/domain
            if (!result.companyName && personData.company?.name) {
                result.companyName = personData.company.name;
            }
            if (!result.companyDomain && personData.company?.domain) {
                result.companyDomain = personData.company.domain;
            }
        } catch {
            result.deepEnrichment = null;
        }
    }

    // 6. Web Search Enrichment (DuckDuckGo — zero API cost)
    //    Cerca sul web pubblico dati verificati sulla persona.
    if (firstName && lastName) {
        try {
            const webData = await searchWebForPersonData(
                firstName,
                lastName,
                opts?.organizationName,
                domain || undefined,
            );
            result.webSearchData = webData;

            // Merge email from web search if not already found
            if (!result.email && webData.emails.length > 0) {
                const best = webData.emails.reduce((a, b) => (a.confidence > b.confidence ? a : b));
                result.email = best.value;
                result.emailConfidence = best.confidence;
                result.source = 'person_data_finder'; // web search contributes as verified data
                sources.email = `web_search:${best.sourceUrl}`;
            }
            // Merge phone from web search if not already found
            if (!result.phone && webData.phones.length > 0) {
                const best = webData.phones.reduce((a, b) => (a.confidence > b.confidence ? a : b));
                result.phone = best.value;
                sources.phone = `web_search:${best.sourceUrl}`;
            }
        } catch {
            result.webSearchData = null;
        }
    }

    // ── Classificazione Business Email ──
    // Se l'email trovata è aziendale, la promuoviamo a businessEmail
    if (result.email && isBusinessEmail(result.email)) {
        result.businessEmail = result.email;
        result.businessEmailConfidence = result.emailConfidence;
        if (!sources.business_email) sources.business_email = sources.email || result.source;
    }
    // Se la pipeline ha trovato email via OSINT, controlla anche quelle
    if (!result.businessEmail && result.deepEnrichment?.emails) {
        for (const osintEmail of result.deepEnrichment.emails) {
            if (isBusinessEmail(osintEmail.address)) {
                result.businessEmail = osintEmail.address;
                result.businessEmailConfidence = osintEmail.confidence;
                sources.business_email = `person_data_finder:${osintEmail.source}`;
                break;
            }
        }
    }
    // Web search business email fallback
    if (!result.businessEmail && result.webSearchData?.emails) {
        for (const wsEmail of result.webSearchData.emails) {
            if (isBusinessEmail(wsEmail.value)) {
                result.businessEmail = wsEmail.value;
                result.businessEmailConfidence = wsEmail.confidence;
                sources.business_email = `web_search:${wsEmail.sourceUrl}`;
                break;
            }
        }
    }

    result.enrichmentSources = sources;

    if (result.email && leadId > 0) {
        await logInfo('lead_enricher.email_found', {
            leadId,
            source: result.source,
            confidence: result.emailConfidence,
            isBusinessEmail: !!result.businessEmail,
        });
    }

    return result;
}

/**
 * Helper per enrichment completo con domain discovery automatica.
 *
 * Pipeline dominio:
 *   1. Se il lead ha un website → estrai dominio direttamente
 *   2. Se ha un company_domain già scoperto → riusa
 *   3. Se ha un account_name → Domain Discovery (Clearbit + DNS + heuristic)
 */
export async function enrichLeadAuto(
    lead: {
        id: number;
        first_name?: string | null;
        last_name?: string | null;
        website?: string | null;
        account_name?: string | null;
        linkedin_url?: string | null;
        company_domain?: string | null;
        location?: string | null;
    },
    opts?: { deep?: boolean },
): Promise<EnrichmentResult> {
    const firstName = (lead.first_name || '').trim();
    const lastName = (lead.last_name || '').trim();
    if (!firstName) return EMPTY_RESULT;

    // Solo URL LinkedIn pubblici (/in/...), non SalesNav (/sales/lead/...)
    const rawUrl = (lead.linkedin_url || '').trim();
    const linkedinUrl = rawUrl && !rawUrl.includes('/sales/') ? rawUrl : undefined;
    const organizationName = (lead.account_name || '').trim() || undefined;
    const location = (lead.location || '').trim() || undefined;

    // ── Domain Resolution Pipeline ──
    let domain = '';
    let domainSource: DomainSource | 'website' | null = null;

    // 1. Website (più affidabile)
    const websiteDomain = inferDomain(lead.website);
    if (websiteDomain) {
        domain = websiteDomain;
        domainSource = 'website';
    }

    // 2. Dominio già scoperto in precedenza
    if (!domain && lead.company_domain) {
        domain = lead.company_domain;
        domainSource = 'clearbit_autocomplete'; // best guess
    }

    // 3. Domain Discovery (Clearbit autocomplete + DNS probe + heuristic)
    if (!domain && organizationName) {
        const discovered = await discoverCompanyDomain(organizationName, { location });
        if (discovered) {
            domain = discovered.domain;
            domainSource = discovered.source;
        }
    }

    // Se non abbiamo né dominio, né LinkedIn URL, né Apollo → skip
    if (!domain && !linkedinUrl && !config.apolloApiKey) return EMPTY_RESULT;

    const result = await enrichLead(lead.id, firstName, lastName, domain, {
        linkedinUrl,
        deep: opts?.deep,
        organizationName,
    });
    result.domainSource = domainSource;
    // Assicura che companyDomain sia sempre popolato se abbiamo scoperto un dominio
    if (!result.companyDomain && domain) {
        result.companyDomain = domain;
    }
    return result;
}
