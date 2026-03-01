/**
 * leadEnricher.ts — Lead Enrichment via Hunter.io e Clearbit
 *
 * Tenta di trovare l'email aziendale e i dati addizionali di un lead.
 * Strategia: prova Hunter.io prima (più economico), poi Clearbit come fallback.
 *
 * Entrambe le API sono opzionali. Se le chiavi non sono configurate,
 * ritorna un risultato vuoto senza errori.
 *
 * Env:
 *   HUNTER_API_KEY   — Hunter.io API key
 *   CLEARBIT_API_KEY — Clearbit Secret Key
 */

import { config } from '../config';
import { logInfo } from '../telemetry/logger';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface EnrichmentResult {
    email: string | null;
    emailConfidence: number;    // 0–100
    phone: string | null;
    jobTitle: string | null;
    companyDomain: string | null;
    source: 'hunter' | 'clearbit' | 'none';
}

const EMPTY_RESULT: EnrichmentResult = {
    email: null, emailConfidence: 0, phone: null,
    jobTitle: null, companyDomain: null, source: 'none'
};

// ─── Hunter.io ────────────────────────────────────────────────────────────────

async function enrichViaHunter(firstName: string, lastName: string, domain: string): Promise<EnrichmentResult | null> {
    if (!config.hunterApiKey || !domain) return null;

    try {
        const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${config.hunterApiKey}`;
        const res = await fetchWithRetryPolicy(url, {
            method: 'GET',
        }, {
            integration: 'hunter.email_finder',
            circuitKey: 'hunter.api',
            timeoutMs: 8_000,
        });

        if (!res.ok) return null;

        const data = await res.json() as {
            data?: { email?: string; confidence?: number; position?: string }
        };

        const email = data.data?.email || null;
        if (!email) return null;

        return {
            email,
            emailConfidence: data.data?.confidence ?? 0,
            phone: null,
            jobTitle: data.data?.position ?? null,
            companyDomain: domain,
            source: 'hunter',
        };
    } catch {
        return null;
    }
}

// ─── Clearbit ─────────────────────────────────────────────────────────────────

async function enrichViaClearbit(firstName: string, lastName: string, domain: string): Promise<EnrichmentResult | null> {
    if (!config.clearbitApiKey || !domain) return null;

    try {
        const url = `https://prospector.clearbit.com/v2/people/find?domain=${encodeURIComponent(domain)}&name=${encodeURIComponent(`${firstName} ${lastName}`)}`;
        const auth = Buffer.from(`${config.clearbitApiKey}:`).toString('base64');
        const res = await fetchWithRetryPolicy(url, {
            headers: { 'Authorization': `Basic ${auth}` },
            method: 'GET',
        }, {
            integration: 'clearbit.person_lookup',
            circuitKey: 'clearbit.api',
            timeoutMs: 8_000,
        });

        if (!res.ok) return null;

        const data = await res.json() as {
            email?: string;
            phone?: string;
            title?: string;
        };

        const email = data.email || null;
        if (!email) return null;

        return {
            email,
            emailConfidence: 75, // Clearbit non espone confidence esplicita
            phone: data.phone || null,
            jobTitle: data.title || null,
            companyDomain: domain,
            source: 'clearbit',
        };
    } catch {
        return null;
    }
}

// ─── Domain Extraction ────────────────────────────────────────────────────────

/** Estrae il dominio da website, con fallback euristico dal nome azienda. */
function inferDomain(website?: string | null, companyName?: string | null): string {
    const rawWebsite = (website ?? '').trim();
    if (rawWebsite) {
        try {
            const parsed = rawWebsite.startsWith('http://') || rawWebsite.startsWith('https://')
                ? new URL(rawWebsite)
                : new URL(`https://${rawWebsite}`);
            return parsed.hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            const fallbackWebsite = rawWebsite
                .replace(/^https?:\/\//i, '')
                .replace(/^www\./i, '')
                .split('/')[0]
                ?.trim()
                .toLowerCase();
            if (fallbackWebsite) {
                return fallbackWebsite;
            }
        }
    }

    if (companyName) {
        // Euristica: "Acme Corp" → "acme.com"
        const slug = companyName.toLowerCase()
            .replace(/\b(srl|spa|inc|ltd|corp|group|italia|italy)\b/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
        return slug ? `${slug}.com` : '';
    }
    return '';
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
    domain: string
): Promise<EnrichmentResult> {
    if (!firstName || !lastName) return EMPTY_RESULT;

    let result: EnrichmentResult | null = null;

    // 1. Hunter.io (priorità)
    result = await enrichViaHunter(firstName, lastName, domain);

    // 2. Clearbit (fallback)
    if (!result) {
        result = await enrichViaClearbit(firstName, lastName, domain);
    }

    if (!result) {
        return EMPTY_RESULT;
    }

    if (result.email && leadId > 0) {
        await logInfo('lead_enricher.email_found', {
            leadId,
            source: result.source,
            confidence: result.emailConfidence,
        });
    }

    return result;
}

/**
 * Helper rapido per enrichment dato un lead completo con inferenza del dominio.
 */
export async function enrichLeadAuto(lead: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    website?: string | null;
    account_name?: string | null;
}): Promise<EnrichmentResult> {
    const firstName = (lead.first_name || '').trim();
    const lastName = (lead.last_name || '').trim();
    const domain = inferDomain(lead.website, lead.account_name);

    if (!domain || !firstName) return EMPTY_RESULT;
    return enrichLead(lead.id, firstName, lastName, domain);
}
