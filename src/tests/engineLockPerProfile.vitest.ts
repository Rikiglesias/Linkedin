/**
 * engineLockPerProfile.vitest.ts — C52 del contratto `bot-operativo` (blocco A): l'engine è bloccato per la vita del
 * profilo. `.fingerprint.json` registra `engine`; engine effettivo ≠ engine del file → lancio BLOCCATO prima di
 * qualunque `launch` (stesso errore/comando di C23, mai auto-adattamento) — per ENTRAMBI i layout di cookie jar;
 * `preflight-env` fallisce CHIUSO se `BROWSER_ENGINE` è assente o `chromium` su un profilo con cookie; il preset
 * starter non propone più `chromium`.
 *
 * Decisione (chat #38, superset del criterio): il file è la sorgente, quindi engine ≠ file blocca ANCHE senza cookie
 * (fail-closed: un'identità browserforge non ha senso su Chromium e viceversa); il preflight rispecchia il launcher.
 *
 * Include i fix accolti dal critico indipendente di fine-C23 (chat #38): fingerprint browserforge OBBLIGATORIO su
 * Camoufox (con `null` camoufox-js ne genererebbe uno nuovo a ogni lancio, `utils.js:345`), pubblicazione ESCLUSIVA
 * del file (rename sovrascriveva nella corsa fra due processi), `accountId` del file validato contro il profilo del
 * lancio, `identity-init --account <sconosciuto>` rifiutato, e la prova di FORMA che gli argomenti dello stealth
 * script vengono SOLO dalla proiezione dell'identità (il test C23 «pool mutato» era tautologico).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserIdentityError,
    IDENTITY_FILE_NAME,
    IDENTITY_FIX_COMMAND,
    createBrowserIdentity,
    ensureBrowserIdentity,
    hostIdentityOs,
    readBrowserIdentity,
    type GeneratedIdentity,
    type IdentityContext,
} from '../browser/browserIdentity';
import { checkEngineLockPerProfile } from '../cli/commands/preflightEngineLock';
import { resolveIdentityInitTarget, runIdentityInitCommand } from '../cli/commands/identityInit';

const UA_FF = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const ROOT = path.resolve(__dirname, '..', '..');

const tempDirs: string[] = [];
function tmp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `engine-lock-${prefix}-`));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const camoufoxCtx = (over: Partial<IdentityContext> = {}): IdentityContext => ({
    engine: 'camoufox',
    engineBuild: '135.0.1-beta.24',
    hostOs: hostIdentityOs(),
    isUaCoherentWithEngine: (ua) => /Firefox\//.test(ua),
    ...over,
});
const chromiumCtx = (): IdentityContext =>
    camoufoxCtx({ engine: 'chromium', engineBuild: '145.0.7632.5', isUaCoherentWithEngine: (ua) => /Chrome\//.test(ua) });

function generated(userAgent: string, extra: Partial<GeneratedIdentity> = {}): GeneratedIdentity {
    return {
        fingerprintId: 'test',
        userAgent,
        locale: 'it-IT',
        languages: ['it-IT', 'it', 'en-US', 'en'],
        timezone: undefined,
        viewport: { width: 1920, height: 1080 },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        hardwareConcurrency: 8,
        deviceMemory: null,
        colorDepth: 24,
        ja3: 'test-ja3',
        browserforge: /Firefox\//.test(userAgent) ? { navigator: { userAgent }, screen: { width: 1920, height: 1080 } } : null,
        ...extra,
    };
}
const geckoCookies = (dir: string): void => fs.writeFileSync(path.join(dir, 'cookies.sqlite'), '', 'utf8');
const chromiumCookies = (dir: string): void => {
    fs.mkdirSync(path.join(dir, 'Default', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Default', 'Network', 'Cookies'), '', 'utf8');
};
function counting(make: () => GeneratedIdentity): { generate: () => Promise<GeneratedIdentity>; calls: () => number } {
    let n = 0;
    return { generate: async () => (n++, make()), calls: () => n };
}
async function expectCode(promise: Promise<unknown>, code: string): Promise<BrowserIdentityError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(BrowserIdentityError);
        expect((error as BrowserIdentityError).code).toBe(code);
        expect((error as Error).message).toContain(IDENTITY_FIX_COMMAND);
        return error as BrowserIdentityError;
    }
    throw new Error(`atteso BrowserIdentityError ${code}, nessun errore`);
}

describe('C52 — engine bloccato per la vita del profilo (regola pura, prima di qualunque launch)', () => {
    it('cookie Gecko + file engine=camoufox + lancio chromium → IDENTITY_ENGINE_MISMATCH, generatore mai chiamato, file intatto', async () => {
        const dir = tmp('gecko');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        geckoCookies(dir);
        const before = fs.readFileSync(path.join(dir, IDENTITY_FILE_NAME));
        const gen = counting(() => generated(UA_CHROME));
        // Il binario differisce SEMPRE fra engine: l'errore deve dire «engine», non «binario» (engine è la prima guardia).
        const error = await expectCode(ensureBrowserIdentity(dir, 'default', chromiumCtx(), gen.generate), 'IDENTITY_ENGINE_MISMATCH');
        expect(error.message).toContain('camoufox');
        expect(error.message).toContain('chromium');
        expect(gen.calls()).toBe(0);
        expect(Buffer.compare(before, fs.readFileSync(path.join(dir, IDENTITY_FILE_NAME)))).toBe(0);
    });

    it('cookie Chromium (Default/Network/Cookies) + file engine=chromium + lancio camoufox → throw', async () => {
        const dir = tmp('chromium');
        await createBrowserIdentity(dir, 'default', chromiumCtx(), generated(UA_CHROME));
        chromiumCookies(dir);
        const gen = counting(() => generated(UA_FF));
        await expectCode(ensureBrowserIdentity(dir, 'default', camoufoxCtx(), gen.generate), 'IDENTITY_ENGINE_MISMATCH');
        expect(gen.calls()).toBe(0);
    });

    it('profilo vergine → consentito, `engine` scritto nel file', async () => {
        const dir = tmp('virgin');
        const identity = await ensureBrowserIdentity(dir, 'default', chromiumCtx(), async () => generated(UA_CHROME));
        expect(identity.engine).toBe('chromium');
        expect(readBrowserIdentity(dir)?.engine).toBe('chromium');
    });

    it('file engine ≠ lancio SENZA cookie → comunque bloccato (fail-closed, superset del criterio)', async () => {
        const dir = tmp('nocookie');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        await expectCode(ensureBrowserIdentity(dir, 'default', chromiumCtx(), async () => generated(UA_CHROME)), 'IDENTITY_ENGINE_MISMATCH');
    });
});

describe('C52 — preflight-env fail-closed sul profilo autenticato', () => {
    const run = (sessionDir: string, raw: string | undefined, configured: 'camoufox' | 'firefox' | 'chromium') =>
        checkEngineLockPerProfile({ accountId: 'default', sessionDir, rawBrowserEngine: raw, configuredEngine: configured });

    it('cookie + BROWSER_ENGINE assente (default chromium) + file camoufox → FAIL con la riga BROWSER_ENGINE=camoufox', async () => {
        const dir = tmp('pf-absent');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        geckoCookies(dir);
        const check = run(dir, undefined, 'chromium');
        expect(check.status).toBe('FAIL');
        expect(check.detail).toContain('BROWSER_ENGINE=camoufox');
        expect(check.detail).toContain('non impostato');
    });

    it('cookie + BROWSER_ENGINE=chromium + file chromium → FAIL (chromium rifiutato su profilo autenticato)', async () => {
        const dir = tmp('pf-chromium');
        await createBrowserIdentity(dir, 'default', chromiumCtx(), generated(UA_CHROME));
        chromiumCookies(dir);
        const check = run(dir, 'chromium', 'chromium');
        expect(check.status).toBe('FAIL');
        expect(check.detail).toContain('BROWSER_ENGINE=camoufox');
        expect(check.detail).toContain(IDENTITY_FIX_COMMAND);
    });

    it('cookie + nessun file identità (profilo pre-C23) → FAIL con il comando che risolve e BROWSER_ENGINE=camoufox', () => {
        const dir = tmp('pf-nofile');
        geckoCookies(dir);
        const check = run(dir, undefined, 'chromium');
        expect(check.status).toBe('FAIL');
        expect(check.detail).toContain(IDENTITY_FIX_COMMAND);
        expect(check.detail).toContain('BROWSER_ENGINE=camoufox');
    });

    it('cookie + BROWSER_ENGINE=camoufox + file camoufox → OK', async () => {
        const dir = tmp('pf-ok');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        geckoCookies(dir);
        expect(run(dir, 'camoufox', 'camoufox').status).toBe('OK');
    });

    it('senza cookie: nessun file → OK; file camoufox con BROWSER_ENGINE risolto chromium → FAIL (rispecchia il launcher)', async () => {
        expect(run(tmp('pf-virgin'), undefined, 'chromium').status).toBe('OK');
        const dir = tmp('pf-mismatch');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        const check = run(dir, 'chromium', 'chromium');
        expect(check.status).toBe('FAIL');
        expect(check.detail).toContain('BROWSER_ENGINE=camoufox');
    });

    it('file corrotto → FAIL che lo dice', () => {
        const dir = tmp('pf-corrupt');
        fs.writeFileSync(path.join(dir, IDENTITY_FILE_NAME), '{not json', 'utf8');
        const check = run(dir, 'camoufox', 'camoufox');
        expect(check.status).toBe('FAIL');
        expect(check.detail).toMatch(/illeggibile|non è un'identità valida/);
    });

    it('cablaggio: preflightEnv.ts chiama il check per ogni account con env RAW e engine risolto', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'commands', 'preflightEnv.ts'), 'utf8');
        expect(src).toContain('checkEngineLockPerProfile({');
        expect(src).toContain('rawBrowserEngine: process.env.BROWSER_ENGINE');
        expect(src).toContain('configuredEngine: config.browserEngine');
    });

    it('preset starter non propone più chromium; gli altri preset restano camoufox', () => {
        const preset = (name: string): string => fs.readFileSync(path.join(ROOT, 'presets', name), 'utf8');
        expect(preset('starter.env.example')).not.toMatch(/^BROWSER_ENGINE=chromium/m);
        expect(preset('starter.env.example')).toMatch(/^BROWSER_ENGINE=camoufox/m);
        for (const name of ['pro.env.example', 'scale.env.example', 'max-stealth.env.example']) {
            expect(preset(name)).toMatch(/^BROWSER_ENGINE=camoufox/m);
        }
    });
});

describe('Critico C23 (chat #38) — fix accolti', () => {
    it('identità Camoufox con browserforge=null → IDENTITY_CORRUPT alla creazione (0 file) e alla lettura', async () => {
        const dir = tmp('bf-null');
        await expectCode(createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF, { browserforge: null })), 'IDENTITY_CORRUPT');
        expect(fs.existsSync(path.join(dir, IDENTITY_FILE_NAME))).toBe(false);
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF));
        const file = path.join(dir, IDENTITY_FILE_NAME);
        fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), browserforge: null }), 'utf8');
        expect(() => readBrowserIdentity(dir)).toThrow(/browserforge/);
    });

    it('corsa fra due processi: il secondo NON sovrascrive (pubblicazione esclusiva), nessun temporaneo residuo', async () => {
        const dir = tmp('race');
        await createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF), { random: () => 0.1 });
        const file = path.join(dir, IDENTITY_FILE_NAME);
        const before = fs.readFileSync(file);
        // Simula la finestra check-then-act: il secondo processo ha letto «assente» un istante prima del primo rename.
        vi.spyOn(fs, 'existsSync').mockImplementationOnce(() => false);
        await expectCode(createBrowserIdentity(dir, 'default', camoufoxCtx(), generated(UA_FF), { random: () => 0.9 }), 'IDENTITY_ALREADY_EXISTS');
        expect(Buffer.compare(before, fs.readFileSync(file))).toBe(0);
        expect(fs.readdirSync(dir)).toEqual([IDENTITY_FILE_NAME]);
    });

    it('file di un altro account copiato nella sessionDir → IDENTITY_ACCOUNT_MISMATCH, 0 rigenerazioni', async () => {
        const dir = tmp('account');
        await createBrowserIdentity(dir, 'acc-a', camoufoxCtx(), generated(UA_FF));
        const gen = counting(() => generated(UA_FF));
        await expectCode(ensureBrowserIdentity(dir, 'acc-b', camoufoxCtx(), gen.generate), 'IDENTITY_ACCOUNT_MISMATCH');
        expect(gen.calls()).toBe(0);
        expect((await ensureBrowserIdentity(dir, 'acc-a', camoufoxCtx(), gen.generate)).accountId).toBe('acc-a');
        expect(gen.calls()).toBe(0);
    });

    it('identity-init --account <sconosciuto> → exit ≠ 0, codice IDENTITY_ACCOUNT_UNKNOWN, nessuna creazione', async () => {
        expect(() => resolveIdentityInitTarget(['--account', 'profilo-che-non-esiste'])).toThrow(/profilo-che-non-esiste/);
        let created = 0;
        const previousExitCode = process.exitCode;
        process.exitCode = undefined;
        const lines: string[] = [];
        const write = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
        try {
            await runIdentityInitCommand(['--account', 'profilo-che-non-esiste'], {
                resolveTarget: (args) => resolveIdentityInitTarget(args),
                createIdentity: async () => {
                    created++;
                    throw new Error('non deve essere chiamato');
                },
            });
            expect(process.exitCode).toBe(1);
        } finally {
            process.stdout.write = write;
            process.exitCode = previousExitCode;
        }
        expect(created).toBe(0);
        const out = JSON.parse(lines.join('')) as { ok: boolean; code?: string };
        expect(out.ok).toBe(false);
        expect(out.code).toBe('IDENTITY_ACCOUNT_UNKNOWN');
    });

    it('forma: gli argomenti di buildStealthInitScript nel launcher vengono SOLO dalla proiezione dell’identità', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'browser', 'launcher.ts'), 'utf8');
        const start = src.indexOf('buildStealthInitScript({');
        expect(start).toBeGreaterThan(0);
        const block = src.slice(start, src.indexOf('});', start));
        for (const key of ['locale', 'languages', 'hardwareConcurrency', 'colorDepth', 'userAgent']) {
            expect(block).toMatch(new RegExp(`${key}: stealthInputs\\.${key}`));
        }
        // C24: il mock finestra (solo headless, solo engine non-Camoufox) dice ciò che il context rende DAVVERO — il
        // viewport headless forzato — e ricade sul file quando il context non ne impone uno. Mai il pool.
        expect(block).toContain('viewportWidth: viewport?.width ?? stealthInputs.viewportWidth');
        expect(block).toContain('viewportHeight: viewport?.height ?? stealthInputs.viewportHeight');
        expect(block).not.toMatch(/fingerprint\.|pickDesktopFingerprint|pickMobileFingerprint|cloudFingerprints/);
        // La proiezione stessa nasce dal file, mai dal pool: `stealthInputsFromIdentity(identity)` subito dopo la guardia.
        expect(src.indexOf('ensureLaunchIdentity({')).toBeLessThan(src.indexOf('stealthInputsFromIdentity(identity)'));
    });
});
