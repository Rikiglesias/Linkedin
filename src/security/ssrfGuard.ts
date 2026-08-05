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

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'metadata.goog']);

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

/**
 * Espande un IPv6 nei suoi 8 gruppi da 16 bit, `null` se non interpretabile.
 * Serve perché il confronto su STRINGA è inaffidabile: lo stesso indirizzo ha molte scritture
 * legali (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `0:0:0:0:0:ffff:7f00:1`) e i parser non producono
 * quella che il codice si aspetta — è così che nasceva il bypass. Sui numeri l'ambiguità sparisce.
 */
function espandiIpv6(ip: string): number[] | null {
    let resto = ip;
    const codaV4: number[] = [];
    // Forma mista: gli ultimi 32 bit scritti come IPv4 (`::ffff:1.2.3.4`).
    const mista = resto.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mista) {
        const ottetti = mista[2].split('.').map(Number);
        if (ottetti.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        codaV4.push((ottetti[0] << 8) | ottetti[1], (ottetti[2] << 8) | ottetti[3]);
        resto = mista[1].replace(/:$/, '');
    }
    const parti = resto.split('::');
    if (parti.length > 2) return null;
    const aGruppi = (s: string): number[] =>
        s.length === 0 ? [] : s.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    const testa = aGruppi(parti[0]);
    const coda = parti.length === 2 ? aGruppi(parti[1]) : [];
    const noti = [...testa, ...coda, ...codaV4];
    if (noti.some((n) => Number.isNaN(n))) return null;
    if (parti.length === 1) return noti.length === 8 ? noti : null;
    const mancanti = 8 - noti.length;
    if (mancanti < 0) return null;
    return [...testa, ...new Array<number>(mancanti).fill(0), ...coda, ...codaV4];
}

/**
 * IPv4 trasportato da un meccanismo di transizione IPv6, `null` se l'indirizzo non ne trasporta.
 *
 * 🔴 Ogni meccanismo di transizione incapsula un IPv4: chi non lo decodifica ha una blocklist che
 * "dimentica IPv6". È la classe di CVE 2025-2026 di `ip-address` (CVE-2026-54272),
 * `is-localhost-ip` (CVE-2025-9960), twenty-server (GHSA-vrcj-hv2q-c58m) per l'IPv4-mapped, e di
 * MCP Registry (CVE-2026-44430) / pydantic-ai (GHSA-cg7w-rg45-pc59) per 6to4 e NAT64.
 */
function ipv4Incapsulato(g: number[]): string | null {
    const daCoppia = (alto: number, basso: number): string =>
        `${alto >> 8}.${alto & 0xff}.${basso >> 8}.${basso & 0xff}`;
    const primi80Zero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // ::ffff:0:0/96 IPv4-mapped · ::/96 IPv4-compatible (deprecato, difesa in profondità).
    // `::` e `::1` ricadono qui come 0.0.0.0 / 0.0.0.1, entrambi bloccati da isBlockedIpv4.
    if (primi80Zero && (g[5] === 0xffff || g[5] === 0)) return daCoppia(g[6], g[7]);
    // 2002::/16 6to4: i 32 bit dopo il prefisso SONO l'IPv4 (2002:a9fe:a9fe:: = 169.254.169.254).
    if (g[0] === 0x2002) return daCoppia(g[1], g[2]);
    // 64:ff9b::/96 NAT64 well-known (RFC 6052).
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
        return daCoppia(g[6], g[7]);
    }
    return null;
}

function isBlockedIpv6(ip: string): boolean {
    const g = espandiIpv6(ip);
    if (!g) return true; // non interpretabile → blocca per sicurezza, come per l'IPv4 malformato

    const v4 = ipv4Incapsulato(g);
    if (v4 !== null) return isBlockedIpv4(v4);

    // 64:ff9b:1::/48 (RFC 8215) è per definizione local-use: nessun servizio pubblico legittimo
    // ci vive, e la codifica dell'IPv4 varia con la lunghezza del prefisso ⇒ si blocca il blocco.
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) return true;
    // Teredo 2001:0::/32: deprecato, incapsula IPv4 offuscato ⇒ blocco del prefisso.
    if (g[0] === 0x2001 && g[1] === 0x0000) return true;

    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecato)
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
