/**
 * ssrfGuard.ts — difesa SSRF per fetch verso URL NON fidati (derivati da dati lead).
 *
 * Vettore (backend-audit SEC4): personDataFinder fetcha `https://${lead.company_domain}` e
 * `/sitemap.xml`, webSearchEnricher fetcha gli URL dei risultati di ricerca. Un lead con
 * website/dominio = IP interno (127.0.0.1, 10.x, 192.168.x), link-local (169.254.169.254 =
 * endpoint metadata cloud AWS/GCP) o hostname che risolve a un IP privato farebbe colpire
 * servizi interni o il metadata endpoint → esfiltrazione credenziali cloud.
 *
 * Uso: opt-in via opzione `blockPrivateHosts` di fetchWithRetryPolicy. NON globale: i fetch
 * legittimi verso host interni (LLM Ollama su localhost, dashboard, telegram) passano dallo
 * stesso chokepoint e non vanno bloccati.
 *
 * Limite noto (TOCTOU/DNS-rebinding): si risolve il DNS e si validano gli indirizzi PRIMA del
 * fetch, ma non si pinna l'IP risolto alla connessione → un resolver malevolo potrebbe
 * rebindare tra check e fetch. Mitigazione completa (pin IP nel dispatcher) = follow-up; questa
 * guardia chiude il vettore realistico (lead con IP/host interno) richiesto dal finding.
 */

import { isIP } from 'net';
import { lookup } from 'dns/promises';

export class SsrfBlockedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SsrfBlockedError';
    }
}

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
    'metadata.goog',
]);

/**
 * true se l'IP (v4 o v6) NON è instradabile pubblicamente: loopback, RFC1918 private,
 * link-local (incl. 169.254.169.254 metadata), CGNAT, unspecified, ULA/link-local IPv6,
 * IPv4-mapped IPv6 (ricontrollato sul v4 estratto).
 */
export function isBlockedIp(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) return isBlockedIpv4(ip);
    if (version === 6) return isBlockedIpv6(ip.toLowerCase());
    return true; // non è un IP valido → blocca per sicurezza
}

function isBlockedIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
    if (a >= 224) return true; // multicast/reserved
    return false;
}

function isBlockedIpv6(ip: string): boolean {
    if (ip === '::' || ip === '::1') return true; // unspecified + loopback
    // IPv4-mapped (::ffff:a.b.c.d) → valida l'IPv4 sottostante
    const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isBlockedIpv4(mapped[1]);
    const head = ip.split(':')[0];
    if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) {
        return true; // fe80::/10 link-local
    }
    if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 ULA
    return false;
}

/**
 * Lancia SsrfBlockedError se l'URL non è sicuro per un fetch verso host non fidato:
 * schema diverso da http/https, hostname in blocklist, IP letterale privato, o hostname
 * che risolve (anche) a un IP privato. Restituisce normalmente se l'URL è pubblico.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new SsrfBlockedError(`SSRF: URL non parsabile: ${rawUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SsrfBlockedError(`SSRF: schema non consentito (${parsed.protocol})`);
    }
    // hostname: rimuove le parentesi quadre dell'IPv6 letterale
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
        throw new SsrfBlockedError(`SSRF: hostname interno bloccato (${host})`);
    }
    if (isIP(host)) {
        if (isBlockedIp(host)) throw new SsrfBlockedError(`SSRF: IP non pubblico bloccato (${host})`);
        return;
    }
    // hostname → risolvi TUTTI gli indirizzi e blocca se anche uno solo è privato
    let addresses: { address: string }[];
    try {
        addresses = await lookup(host, { all: true });
    } catch {
        throw new SsrfBlockedError(`SSRF: risoluzione DNS fallita per ${host}`);
    }
    if (addresses.length === 0) throw new SsrfBlockedError(`SSRF: nessun indirizzo per ${host}`);
    for (const { address } of addresses) {
        if (isBlockedIp(address)) {
            throw new SsrfBlockedError(`SSRF: ${host} risolve a IP non pubblico ${address}`);
        }
    }
}
