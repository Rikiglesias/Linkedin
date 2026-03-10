/**
 * domainDiscovery.ts — Company Name → Domain Resolution Pipeline
 *
 * Strategia a 3 livelli per scoprire il dominio aziendale da un nome:
 *   1. Clearbit Company Autocomplete (gratuito, no API key, alta affidabilità)
 *   2. DNS Probing (MX + A record su candidati generati, media affidabilità)
 *   3. Pattern Heuristic (slug + .com, bassa affidabilità)
 *
 * Zero costo — nessuna API a pagamento.
 */

import * as dns from 'node:dns';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { logInfo } from '../telemetry/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DomainSource = 'clearbit_autocomplete' | 'dns_probe' | 'pattern_heuristic';

export interface DomainDiscoveryResult {
    domain: string;
    confidence: number; // 0–100
    source: DomainSource;
    companyName?: string; // nome raffinato da Clearbit
}

// ─── Cache (session-scoped) ──────────────────────────────────────────────────

const domainCache = new Map<string, DomainDiscoveryResult | null>();
const mxCache = new Map<string, string | null>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMPANY_SUFFIXES = /\b(srl|s\.r\.l|spa|s\.p\.a|inc|ltd|llc|corp|group|gmbh|bv|b\.v|sa|s\.a|ag|plc|co|pty|pvt|italia|italy|consulting|solutions|services|technologies|tech)\b/gi;

function slugify(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(COMPANY_SUFFIXES, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeKey(name: string): string {
    return slugify(name).replace(/\s+/g, '');
}

/** Similarità Dice-coefficient tra due stringhe (0–1). */
function similarity(a: string, b: string): number {
    const na = a.toLowerCase();
    const nb = b.toLowerCase();
    if (na === nb) return 1;
    if (na.length < 2 || nb.length < 2) return 0;

    const bigrams = (s: string): Set<string> => {
        const set = new Set<string>();
        for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2));
        return set;
    };

    const a2 = bigrams(na);
    const b2 = bigrams(nb);
    let intersection = 0;
    for (const bg of a2) if (b2.has(bg)) intersection++;
    return (2 * intersection) / (a2.size + b2.size);
}

// ─── DNS helpers ─────────────────────────────────────────────────────────────

async function resolveMx(domain: string): Promise<string | null> {
    const cached = mxCache.get(domain);
    if (cached !== undefined) return cached;

    try {
        const records = await dns.promises.resolveMx(domain);
        if (!records || records.length === 0) {
            mxCache.set(domain, null);
            return null;
        }
        records.sort((a, b) => a.priority - b.priority);
        const mx = records[0]?.exchange;
        if (!mx) return null;
        mxCache.set(domain, mx);
        return mx;
    } catch {
        mxCache.set(domain, null);
        return null;
    }
}

async function hasARecord(domain: string): Promise<boolean> {
    try {
        const addrs = await dns.promises.resolve4(domain);
        return addrs.length > 0;
    } catch {
        return false;
    }
}

// ─── Strategy 1: Clearbit Company Autocomplete ──────────────────────────────

interface ClearbitSuggestion {
    name: string;
    domain: string;
    logo: string | null;
}

async function discoverViaClearbit(companyName: string): Promise<DomainDiscoveryResult | null> {
    try {
        const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`;
        const res = await fetchWithRetryPolicy(
            url,
            { method: 'GET' },
            {
                integration: 'clearbit.autocomplete',
                circuitKey: 'clearbit.autocomplete',
                timeoutMs: 5_000,
                maxAttempts: 2,
            },
        );

        if (!res.ok) return null;

        const suggestions = (await res.json()) as ClearbitSuggestion[];
        if (!suggestions || suggestions.length === 0) return null;

        // Trova il miglior match
        const normalizedInput = slugify(companyName);
        let bestMatch: ClearbitSuggestion | null = null;
        let bestScore = 0;

        for (const s of suggestions) {
            const normalizedName = slugify(s.name);
            const score = similarity(normalizedInput, normalizedName);

            // Bonus se il nome contiene l'input come sottostringa
            const containsBonus = normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName) ? 0.15 : 0;
            const total = score + containsBonus;

            if (total > bestScore) {
                bestScore = total;
                bestMatch = s;
            }
        }

        if (!bestMatch) return null;

        // Se nessun match è abbastanza buono, usa comunque il primo risultato
        // (Clearbit ordina per rilevanza)
        const chosen = bestScore > 0.4 ? bestMatch : suggestions[0];
        if (!chosen) return null;
        const confidence = bestScore > 0.7 ? 85 : bestScore > 0.4 ? 70 : 55;

        return {
            domain: chosen.domain,
            confidence,
            source: 'clearbit_autocomplete',
            companyName: chosen.name,
        };
    } catch {
        return null;
    }
}

// ─── Strategy 2: DNS Probing ─────────────────────────────────────────────────

const TLDS = ['.com', '.it', '.co.uk', '.de', '.fr', '.nl', '.es', '.io', '.eu', '.ch', '.at', '.be'];

function generateDomainCandidates(companyName: string, location?: string): string[] {
    const slug = slugify(companyName);
    if (!slug) return [];

    const joined = slug.replace(/\s+/g, '');
    const hyphenated = slug.replace(/\s+/g, '-');

    // Priorità TLD basata su location
    const tlds = [...TLDS];
    if (location) {
        const loc = location.toLowerCase();
        if (loc.includes('ital') || loc.includes('roma') || loc.includes('milan')) {
            const idx = tlds.indexOf('.it');
            if (idx > 0) { tlds.splice(idx, 1); tlds.unshift('.it'); }
        } else if (loc.includes('german') || loc.includes('deutsch') || loc.includes('berlin') || loc.includes('munich')) {
            const idx = tlds.indexOf('.de');
            if (idx > 0) { tlds.splice(idx, 1); tlds.unshift('.de'); }
        } else if (loc.includes('franc') || loc.includes('paris')) {
            const idx = tlds.indexOf('.fr');
            if (idx > 0) { tlds.splice(idx, 1); tlds.unshift('.fr'); }
        } else if (loc.includes('netherlands') || loc.includes('dutch') || loc.includes('amsterdam')) {
            const idx = tlds.indexOf('.nl');
            if (idx > 0) { tlds.splice(idx, 1); tlds.unshift('.nl'); }
        }
    }

    const candidates: string[] = [];
    for (const tld of tlds) {
        candidates.push(`${joined}${tld}`);
        if (hyphenated !== joined) {
            candidates.push(`${hyphenated}${tld}`);
        }
    }
    return candidates;
}

async function discoverViaDnsProbe(companyName: string, location?: string): Promise<DomainDiscoveryResult | null> {
    const candidates = generateDomainCandidates(companyName, location);
    if (candidates.length === 0) return null;

    // Check in batch di 4 per velocità
    let bestWithMx: string | null = null;
    let bestWithA: string | null = null;

    for (let i = 0; i < candidates.length; i += 4) {
        const batch = candidates.slice(i, i + 4);
        const results = await Promise.all(
            batch.map(async (domain) => {
                const mx = await resolveMx(domain);
                if (mx) return { domain, hasMx: true, hasA: true };
                const a = await hasARecord(domain);
                return { domain, hasMx: false, hasA: a };
            }),
        );

        for (const r of results) {
            if (r.hasMx && !bestWithMx) bestWithMx = r.domain;
            if (r.hasA && !bestWithA) bestWithA = r.domain;
        }

        // Se troviamo un dominio con MX, stop
        if (bestWithMx) break;
    }

    if (bestWithMx) {
        return { domain: bestWithMx, confidence: 55, source: 'dns_probe' };
    }
    if (bestWithA) {
        return { domain: bestWithA, confidence: 35, source: 'dns_probe' };
    }
    return null;
}

// ─── Strategy 3: Pattern Heuristic ──────────────────────────────────────────

function discoverViaHeuristic(companyName: string): DomainDiscoveryResult | null {
    const slug = slugify(companyName).replace(/\s+/g, '');
    if (!slug || slug.length < 2) return null;
    return { domain: `${slug}.com`, confidence: 20, source: 'pattern_heuristic' };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Scopre il dominio aziendale dato il nome dell'azienda.
 * Pipeline: Clearbit Autocomplete → DNS Probing → Pattern Heuristic.
 * Risultati cachati per sessione.
 */
export async function discoverCompanyDomain(
    companyName: string,
    opts?: { location?: string },
): Promise<DomainDiscoveryResult | null> {
    if (!companyName || companyName.trim().length < 2) return null;

    const key = normalizeKey(companyName);
    const cached = domainCache.get(key);
    if (cached !== undefined) return cached;

    let result: DomainDiscoveryResult | null = null;

    // 1. Clearbit autocomplete (best source)
    result = await discoverViaClearbit(companyName);

    // 2. DNS probing (fallback)
    if (!result) {
        result = await discoverViaDnsProbe(companyName, opts?.location);
    }

    // 3. Pattern heuristic (last resort)
    if (!result) {
        result = discoverViaHeuristic(companyName);
    }

    if (result) {
        void logInfo('domain_discovery.found', {
            companyName,
            domain: result.domain,
            source: result.source,
            confidence: result.confidence,
        });
    }

    domainCache.set(key, result);
    return result;
}

/** Pulisce la cache (utile per test). */
export function clearDomainCache(): void {
    domainCache.clear();
    mxCache.clear();
}
