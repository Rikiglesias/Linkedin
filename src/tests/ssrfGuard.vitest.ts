import { describe, test, expect } from 'vitest';
import { isBlockedIp, assertSafeOutboundUrl, SsrfBlockedError } from '../security/ssrfGuard';

// backend-audit SEC4: la guardia SSRF deve bloccare host interni/IP privati/metadata sui fetch
// verso URL derivati dal lead (personDataFinder, webSearchEnricher), lasciando passare i pubblici.

describe('ssrfGuard.isBlockedIp', () => {
    test.each([
        ['127.0.0.1', true],
        ['10.0.0.5', true],
        ['172.16.0.1', true],
        ['172.31.255.255', true],
        ['192.168.1.1', true],
        ['169.254.169.254', true], // metadata endpoint cloud
        ['100.64.0.1', true], // CGNAT
        ['0.0.0.0', true],
        ['224.0.0.1', true], // multicast
        ['8.8.8.8', false],
        ['1.1.1.1', false],
        ['172.15.0.1', false], // appena fuori RFC1918
        ['172.32.0.1', false],
        ['::1', true],
        ['::', true],
        ['fe80::1', true], // link-local v6
        ['fc00::1', true], // ULA
        ['fd12:3456::1', true],
        ['::ffff:127.0.0.1', true], // IPv4-mapped loopback
        ['::ffff:8.8.8.8', false], // IPv4-mapped pubblico
        ['2001:4860:4860::8888', false], // Google DNS v6
        ['not-an-ip', true], // input invalido → blocca
    ])('isBlockedIp(%s) === %s', (ip, expected) => {
        expect(isBlockedIp(ip as string)).toBe(expected);
    });
});

describe('ssrfGuard.assertSafeOutboundUrl', () => {
    test('rifiuta schema non http/https', async () => {
        await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
        await expect(assertSafeOutboundUrl('gopher://x')).rejects.toThrow(/schema/);
    });

    test('rifiuta hostname interni', async () => {
        await expect(assertSafeOutboundUrl('http://localhost/x')).rejects.toThrow(/interno/);
        await expect(assertSafeOutboundUrl('http://metadata.google.internal/')).rejects.toThrow(/interno/);
        await expect(assertSafeOutboundUrl('http://foo.localhost/')).rejects.toThrow(/interno/);
    });

    test('rifiuta IP letterali privati / metadata (nessun DNS)', async () => {
        await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
            /IP non pubblico/,
        );
        await expect(assertSafeOutboundUrl('http://127.0.0.1:8080/')).rejects.toThrow(/IP non pubblico/);
        await expect(assertSafeOutboundUrl('http://[::1]/')).rejects.toThrow(/IP non pubblico/);
        await expect(assertSafeOutboundUrl('https://192.168.0.1/admin')).rejects.toThrow(/IP non pubblico/);
    });

    test('accetta IP pubblico letterale senza lookup', async () => {
        await expect(assertSafeOutboundUrl('https://8.8.8.8/')).resolves.toBeUndefined();
    });

    test('URL malformato → SsrfBlockedError', async () => {
        await expect(assertSafeOutboundUrl('http://')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
});

/**
 * 🔴 BYPASS REALE, misurato eseguendo: la guardia riconosceva l'IPv4-mapped SOLO nella forma
 * `::ffff:a.b.c.d`, che NESSUN parser produce — `new URL('http://[::ffff:169.254.169.254]/')`
 * serializza l'hostname come `[::ffff:a9fe:a9fe]` (esadecimale compresso, spec WHATWG) e anche
 * `dns.lookup` restituisce la forma canonica. Quel ramo era quindi codice morto sugli input veri e
 * il metadata endpoint cloud — il vettore che l'header del modulo dichiara di chiudere — passava.
 *
 * Il perimetro qui sotto NON è dedotto: viene da CVE 2025-2026 su librerie che hanno commesso lo
 * stesso errore (ip-address CVE-2026-54272 · is-localhost-ip CVE-2025-9960 · twenty-server
 * GHSA-vrcj-hv2q-c58m per l'IPv4-mapped; MCP Registry CVE-2026-44430 e pydantic-ai
 * GHSA-cg7w-rg45-pc59 per 6to4/NAT64). Ogni meccanismo di transizione IPv6 trasporta un IPv4:
 * chi non lo decodifica ha una blocklist che «dimentica IPv6».
 */
describe('ssrfGuard — IPv6 che trasporta un IPv4 (forme reali del runtime)', () => {
    test.each([
        // IPv4-mapped ::ffff:0:0/96, nelle tre forme che il runtime produce davvero
        ['::ffff:7f00:1', true], // 127.0.0.1 compresso
        ['::ffff:a9fe:a9fe', true], // 169.254.169.254 = metadata cloud AWS/GCP
        ['::ffff:a00:5', true], // 10.0.0.5
        ['::ffff:c0a8:101', true], // 192.168.1.1
        ['::ffff:6440:1', true], // 100.64.0.1 CGNAT
        ['0:0:0:0:0:ffff:7f00:1', true], // stessa cosa, forma non compressa
        // IPv4-compatible ::/96 (deprecato) e site-local (deprecato): difesa in profondità
        ['::7f00:1', true],
        ['fec0::1', true],
        // 6to4 2002::/16 — i 32 bit dopo il prefisso SONO un IPv4
        ['2002:a9fe:a9fe::', true], // → 169.254.169.254
        ['2002:7f00:1::1', true], // → 127.0.0.1
        ['2002:808:808::', false], // → 8.8.8.8, pubblico: deve passare
        // NAT64 RFC 6052/8215
        ['64:ff9b::a9fe:a9fe', true], // → 169.254.169.254
        ['64:ff9b::808:808', false], // → 8.8.8.8, pubblico
        ['64:ff9b:1::1', true], // prefisso local-use: mai un servizio pubblico
        // Non-regressione: gli IPv6 pubblici veri restano raggiungibili
        ['::ffff:808:808', false], // 8.8.8.8
        ['::ffff:8.8.8.8', false], // forma dotted, comportamento invariato
        ['2001:4860:4860::8888', false],
    ])('isBlockedIp(%s) === %s', (ip, expected) => {
        expect(isBlockedIp(ip as string)).toBe(expected);
    });

    test('URL con IPv4-mapped verso il metadata endpoint viene bloccato', async () => {
        await expect(assertSafeOutboundUrl('http://[::ffff:169.254.169.254]/latest/meta-data/')).rejects.toThrow(
            /IP non pubblico/,
        );
        await expect(assertSafeOutboundUrl('http://[::ffff:a9fe:a9fe]/')).rejects.toThrow(/IP non pubblico/);
        await expect(assertSafeOutboundUrl('http://[::ffff:127.0.0.1]:11434/')).rejects.toThrow(/IP non pubblico/);
        await expect(assertSafeOutboundUrl('http://[2002:a9fe:a9fe::]/')).rejects.toThrow(/IP non pubblico/);
    });

    test('un IPv6 non interpretabile viene bloccato, non lasciato passare', () => {
        expect(isBlockedIp('::ffff:zzzz:1')).toBe(true);
        expect(isBlockedIp('1::2::3')).toBe(true);
    });
});
