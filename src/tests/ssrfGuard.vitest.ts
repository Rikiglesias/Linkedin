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
        await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/IP non pubblico/);
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
