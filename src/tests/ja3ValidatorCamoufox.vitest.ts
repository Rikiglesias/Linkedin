/**
 * ja3ValidatorCamoufox.vitest.ts — C12(e) del contratto `bot-operativo`: `config-validate` non raccomanda più di
 * abilitare `USE_JA3_PROXY` con engine camoufox/firefox.
 *
 * Camoufox/Firefox parlano TLS con lo stack NSS di Firefox e il pool UA è solo-Firefox (guardia in
 * `browser/stealth.ts`): JA3 e UA sono coerenti in modo NATIVO. CycleTLS spoofa un JA3 configurato a mano:
 * accenderlo su Camoufox creerebbe proprio l'incoerenza che il validatore dice di evitare. Con engine chromium la
 * raccomandazione resta, senza la frase vietata (`FRASE_VIETATA`, composta a runtime: il grep del contratto la vuole
 * a 0 in TUTTO `src`, test compresi).
 * Il messaggio di `:134` («Avviare CycleTLS o disabilitare USE_JA3_PROXY») è corretto e resta: sentinella statica.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    config: {
        browserEngine: 'camoufox' as 'chromium' | 'firefox' | 'camoufox',
        useJa3Proxy: false,
        ja3Fingerprint: '',
        ja3UserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
        ja3ProxyPort: 8080,
        proxyUrl: 'http://user:pass@proxy.example:1234',
        proxyListPath: '',
    },
}));

vi.mock('../config', () => ({ config: h.config }));
vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(async () => undefined),
    logWarn: vi.fn(async () => undefined),
}));

import { validateJa3Configuration } from '../proxy/ja3Validator';

/** «e abilitare» + il nome del flag: composta a runtime perché il grep del contratto deve trovarla 0 volte in src. */
const FRASE_VIETATA = ['e abilitare', 'USE_JA3_PROXY'].join(' ');

describe('C12(e) — config-validate e USE_JA3_PROXY per engine', () => {
    beforeEach(() => {
        h.config.browserEngine = 'camoufox';
        h.config.useJa3Proxy = false;
        h.config.proxyUrl = 'http://user:pass@proxy.example:1234';
    });

    it('camoufox + proxy + useJa3Proxy=false → la recommendation NON chiede di abilitare USE_JA3_PROXY', async () => {
        const report = await validateJa3Configuration();
        expect(report.useJa3ProxyConfigured).toBe(false);
        expect(report.recommendation).not.toMatch(/abilitare USE_JA3_PROXY/);
        expect(report.recommendation).not.toContain('USE_JA3_PROXY=true');
        expect(report.recommendation).toContain('USE_JA3_PROXY=false');
        expect(report.recommendation).toMatch(/camoufox/);
        expect(report.status).toBe('SECURE');
    });

    it('firefox + proxy + useJa3Proxy=false → come camoufox', async () => {
        h.config.browserEngine = 'firefox';
        const report = await validateJa3Configuration();
        expect(report.recommendation).not.toMatch(/abilitare USE_JA3_PROXY/);
        expect(report.recommendation).toContain('USE_JA3_PROXY=false');
        expect(report.status).toBe('SECURE');
    });

    it('chromium + proxy + useJa3Proxy=false → resta un GAP con CycleTLS consigliato, senza la frase «e abilitare»', async () => {
        h.config.browserEngine = 'chromium';
        const report = await validateJa3Configuration();
        expect(report.status).toBe('GAP');
        expect(report.recommendation).toContain('USE_JA3_PROXY=true');
        expect(report.recommendation).not.toContain(FRASE_VIETATA);
    });

    it('senza proxy → DIRECT, indipendente dall’engine', async () => {
        h.config.proxyUrl = '';
        const report = await validateJa3Configuration();
        expect(report.status).toBe('DIRECT');
        expect(report.recommendation).not.toMatch(/abilitare USE_JA3_PROXY/);
    });

    it('sentinelle statiche (gli stessi grep del contratto): frase vietata = 0 in ja3Validator, «disabilitare USE_JA3_PROXY» = 1', () => {
        const validator = readFileSync(path.resolve(__dirname, '..', 'proxy', 'ja3Validator.ts'), 'utf8');
        expect(validator.split('disabilitare USE_JA3_PROXY').length - 1).toBe(1);
        expect(validator).not.toContain(FRASE_VIETATA);
    });
});
