import { describe, test, expect } from 'vitest';
import { classifyAsnOrg, computeQualityScore, type ProxyIpType } from '../proxy/proxyQualityChecker';
import { detectBrowserFamily, detectJa3BrowserFamily, isUaJa3Coherent } from '../proxy/ja3Validator';

// ─── ASN Classification ──────────────────────────────────────────────────────

describe('Proxy Quality — ASN Classification', () => {
    test('classifica AWS come datacenter', () => {
        expect(classifyAsnOrg('Amazon.com, Inc.')).toBe('datacenter');
        expect(classifyAsnOrg('Amazon Web Services')).toBe('datacenter');
    });

    test('classifica Google Cloud come datacenter', () => {
        expect(classifyAsnOrg('Google LLC')).toBe('datacenter');
    });

    test('classifica Hetzner come datacenter', () => {
        expect(classifyAsnOrg('Hetzner Online GmbH')).toBe('datacenter');
    });

    test('classifica OVH come datacenter', () => {
        expect(classifyAsnOrg('OVH SAS')).toBe('datacenter');
    });

    test('classifica DigitalOcean come datacenter', () => {
        expect(classifyAsnOrg('DigitalOcean, LLC')).toBe('datacenter');
    });

    test('classifica Vodafone come mobile', () => {
        expect(classifyAsnOrg('Vodafone Italia S.p.A.')).toBe('mobile');
    });

    test('classifica TIM come mobile', () => {
        expect(classifyAsnOrg('TIM S.p.A.')).toBe('mobile');
    });

    test('classifica Wind/Tre come mobile', () => {
        expect(classifyAsnOrg('Wind Tre S.p.A.')).toBe('mobile');
    });

    test('classifica Iliad come mobile', () => {
        expect(classifyAsnOrg('Iliad Italia S.p.A.')).toBe('mobile');
    });

    test('classifica ISP residenziale come residential', () => {
        expect(classifyAsnOrg('Telecom Italia')).toBe('residential');
        expect(classifyAsnOrg('Fastweb')).toBe('residential');
        expect(classifyAsnOrg('Tiscali S.p.A.')).toBe('residential');
    });

    test('stringa vuota ritorna unknown', () => {
        expect(classifyAsnOrg('')).toBe('unknown');
    });

    test('case insensitive', () => {
        expect(classifyAsnOrg('AMAZON WEB SERVICES')).toBe('datacenter');
        expect(classifyAsnOrg('vodafone italia')).toBe('mobile');
    });
});

// ─── Quality Score ───────────────────────────────────────────────────────────

describe('Proxy Quality — Score Computation', () => {
    test('mobile con bassa latenza → score alto', () => {
        const score = computeQualityScore('mobile', 200);
        expect(score).toBe(100); // 90 + 10
    });

    test('residential con latenza media → score buono', () => {
        const score = computeQualityScore('residential', 700);
        expect(score).toBe(70); // 70 + 0
    });

    test('datacenter con alta latenza → score molto basso', () => {
        const score = computeQualityScore('datacenter', 2500);
        expect(score).toBe(0); // 20 - 20 = 0, clamped
    });

    test('datacenter con bassa latenza → score comunque basso', () => {
        const score = computeQualityScore('datacenter', 100);
        expect(score).toBe(30); // 20 + 10
    });

    test('unknown con latenza media → score medio-basso', () => {
        const score = computeQualityScore('unknown', 800);
        expect(score).toBe(40); // 40 + 0
    });

    test('score clamped tra 0 e 100', () => {
        expect(computeQualityScore('mobile', 50)).toBeLessThanOrEqual(100);
        expect(computeQualityScore('datacenter', 5000)).toBeGreaterThanOrEqual(0);
    });

    const types: ProxyIpType[] = ['mobile', 'residential', 'datacenter', 'unknown'];
    for (const type of types) {
        test(`${type}: score sempre nel range [0, 100]`, () => {
            for (const latency of [0, 100, 500, 1000, 2000, 5000, -1]) {
                const s = computeQualityScore(type, latency);
                expect(s).toBeGreaterThanOrEqual(0);
                expect(s).toBeLessThanOrEqual(100);
            }
        });
    }
});

// ─── JA3 Validator — Browser Family Detection ────────────────────────────────

describe('JA3 Validator — Browser Family Detection', () => {
    test('rileva Chrome da User-Agent', () => {
        expect(
            detectBrowserFamily(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            ),
        ).toBe('chrome');
    });

    test('rileva Firefox da User-Agent', () => {
        expect(
            detectBrowserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0'),
        ).toBe('firefox');
    });

    test('rileva Edge da User-Agent', () => {
        expect(
            detectBrowserFamily(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
            ),
        ).toBe('edge');
    });

    test('rileva Safari da User-Agent', () => {
        expect(
            detectBrowserFamily(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
            ),
        ).toBe('safari');
    });

    test('Chrome iOS (CriOS) → chrome', () => {
        expect(
            detectBrowserFamily(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/132.0.0.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('chrome');
    });

    test('stringa vuota → unknown', () => {
        expect(detectBrowserFamily('')).toBe('unknown');
    });
});

// ─── JA3 Validator — JA3 Fingerprint → Browser ──────────────────────────────

describe('JA3 Validator — JA3 Fingerprint Detection', () => {
    const JA3_CHROME =
        '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
    const JA3_FIREFOX =
        '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0';
    const JA3_SAFARI =
        '771,4865-4866-4867-49196-49195-52393-49200-49199-52392-49162-49161-49172-49171-157-156-53-47,0-23-65281-10-11-16-5-13-18-51-45-43-27-17513-21,29-23-24-25,0';

    test('rileva Chrome JA3', () => {
        expect(detectJa3BrowserFamily(JA3_CHROME)).toBe('chrome');
    });

    test('rileva Firefox JA3', () => {
        expect(detectJa3BrowserFamily(JA3_FIREFOX)).toBe('firefox');
    });

    test('rileva Safari JA3', () => {
        expect(detectJa3BrowserFamily(JA3_SAFARI)).toBe('safari');
    });

    test('stringa vuota → unknown', () => {
        expect(detectJa3BrowserFamily('')).toBe('unknown');
    });

    test('JA3 malformato → unknown', () => {
        expect(detectJa3BrowserFamily('invalid')).toBe('unknown');
    });
});

// ─── JA3 Validator — UA ↔ JA3 Coherence ─────────────────────────────────────

describe('JA3 Validator — UA ↔ JA3 Coherence', () => {
    test('Chrome UA + Chrome JA3 → coerente', () => {
        expect(isUaJa3Coherent('chrome', 'chrome')).toBe(true);
    });

    test('Firefox UA + Firefox JA3 → coerente', () => {
        expect(isUaJa3Coherent('firefox', 'firefox')).toBe(true);
    });

    test('Edge UA + Chrome JA3 → coerente (stesso stack TLS)', () => {
        expect(isUaJa3Coherent('edge', 'chrome')).toBe(true);
    });

    test('Chrome UA + Firefox JA3 → incoerente', () => {
        expect(isUaJa3Coherent('chrome', 'firefox')).toBe(false);
    });

    test('Firefox UA + Chrome JA3 → incoerente', () => {
        expect(isUaJa3Coherent('firefox', 'chrome')).toBe(false);
    });

    test('Safari UA + Chrome JA3 → incoerente', () => {
        expect(isUaJa3Coherent('safari', 'chrome')).toBe(false);
    });

    test('unknown UA → sempre coerente (non determinabile)', () => {
        expect(isUaJa3Coherent('unknown', 'chrome')).toBe(true);
        expect(isUaJa3Coherent('unknown', 'firefox')).toBe(true);
    });

    test('unknown JA3 → sempre coerente (non determinabile)', () => {
        expect(isUaJa3Coherent('chrome', 'unknown')).toBe(true);
        expect(isUaJa3Coherent('firefox', 'unknown')).toBe(true);
    });
});
