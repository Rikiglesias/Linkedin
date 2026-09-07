/**
 * fingerprintPersistence.vitest.ts — C23 del contratto `bot-operativo` (blocco A): l'identità del browser è
 * PERSISTITA in `<sessionDir>/.fingerprint.json`, scritta UNA volta, coerente col binario (major UA = major
 * engineBuild) e con l'host (`os`), ed è l'UNICA sorgente di ciò che la pagina vede. Ogni incoerenza → lancio
 * BLOCCATO con il comando che risolve (`identity-init --new-session`), mai rigenerazione silenziosa.
 *
 * I 10 casi del binding, più i check di forma (scrittura atomica, ordine guardia→launch nel launcher).
 * Nessun browser: la regola è pura (`browserIdentity.ts`), il cablaggio (`browserIdentityRuntime.ts`) è
 * esercitato dall'harness `npm run harness:identity` su Camoufox vero.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    BrowserIdentityError,
    IDENTITY_FILE_NAME,
    IDENTITY_FIX_COMMAND,
    createBrowserIdentity,
    ensureBrowserIdentity,
    hostIdentityOs,
    profileHasCookies,
    readBrowserIdentity,
    rewriteVersionStrings,
    uaMajor,
    type GeneratedIdentity,
    type IdentityContext,
} from '../browser/browserIdentity';
import { camoufoxIdentityLaunchOptions, stealthInputsFromIdentity } from '../browser/browserIdentityProjection';
import { runIdentityInitCommand } from '../cli/commands/identityInit';

const UA_135 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
const UA_133 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const BUILD = '135.0.1-beta.24';

const tempDirs: string[] = [];
function tmp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `identity-${prefix}-`));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function ctx(overrides: Partial<IdentityContext> = {}): IdentityContext {
    return {
        engine: 'camoufox',
        engineBuild: BUILD,
        hostOs: hostIdentityOs(),
        isUaCoherentWithEngine: (userAgent) => /Firefox\//.test(userAgent),
        ...overrides,
    };
}

function generated(userAgent = UA_135, extra: Partial<GeneratedIdentity> = {}): GeneratedIdentity {
    return {
        fingerprintId: 'pool:desktop_firefox_win_1',
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
        browserforge: { navigator: { userAgent }, screen: { width: 1920, height: 1080 } },
        ...extra,
    };
}

function countingGenerator(make: () => GeneratedIdentity): { generate: () => Promise<GeneratedIdentity>; calls: () => number } {
    let n = 0;
    return {
        generate: async () => {
            n++;
            return make();
        },
        calls: () => n,
    };
}

async function expectIdentityError(promise: Promise<unknown>, code: string): Promise<BrowserIdentityError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(BrowserIdentityError);
        const typed = error as BrowserIdentityError;
        expect(typed.code).toBe(code);
        expect(typed.message).toContain(IDENTITY_FIX_COMMAND);
        return typed;
    }
    throw new Error(`atteso BrowserIdentityError ${code}, nessun errore`);
}

describe('C23 — identità persistita: scritta una volta, letta sempre', () => {
    it('2× stesso account → file byte-identico e generatore chiamato UNA volta', async () => {
        const dir = tmp('same');
        const gen = countingGenerator(() => generated());
        const first = await ensureBrowserIdentity(dir, 'acc-a', ctx(), gen.generate);
        const bytes1 = fs.readFileSync(path.join(dir, IDENTITY_FILE_NAME));
        const second = await ensureBrowserIdentity(dir, 'acc-a', ctx(), gen.generate);
        const bytes2 = fs.readFileSync(path.join(dir, IDENTITY_FILE_NAME));
        expect(Buffer.compare(bytes1, bytes2)).toBe(0);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(gen.calls()).toBe(1);
        // Scrittura atomica: nessun file temporaneo residuo accanto all'identità.
        expect(fs.readdirSync(dir)).toEqual([IDENTITY_FILE_NAME]);
    });

    it('account diversi → identità diverse', async () => {
        const dirA = tmp('acc-a');
        const dirB = tmp('acc-b');
        await ensureBrowserIdentity(dirA, 'acc-a', ctx(), async () => generated());
        await ensureBrowserIdentity(dirB, 'acc-b', ctx(), async () => generated());
        const a = fs.readFileSync(path.join(dirA, IDENTITY_FILE_NAME), 'utf8');
        const b = fs.readFileSync(path.join(dirB, IDENTITY_FILE_NAME), 'utf8');
        expect(a).not.toBe(b);
        expect(readBrowserIdentity(dirA)?.accountId).toBe('acc-a');
        expect(readBrowserIdentity(dirB)?.accountId).toBe('acc-b');
    });

    it('profilo vergine → file creato 1 volta con os = host mappato', async () => {
        const dir = tmp('virgin');
        const gen = countingGenerator(() => generated());
        const identity = await ensureBrowserIdentity(dir, 'acc-v', ctx(), gen.generate);
        expect(gen.calls()).toBe(1);
        expect(identity.os).toBe(hostIdentityOs());
        expect(hostIdentityOs('win32')).toBe('windows');
        expect(hostIdentityOs('darwin')).toBe('macos');
        expect(hostIdentityOs('linux')).toBe('linux');
        expect(identity.engineBuild).toBe(BUILD);
        expect(identity.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(Number.isInteger(identity.fontsSpacingSeed)).toBe(true);
        expect(identity.fontsSpacingSeed).toBeGreaterThanOrEqual(0);
        expect(identity.fontsSpacingSeed).toBeLessThan(1_073_741_824);
    });

    it('pool cloud mutato (3 voci → 5 in altro ordine) con file invariato → argomenti byte-identici', async () => {
        const dir = tmp('pool');
        let pool = [UA_135, UA_133, UA_CHROME];
        const gen = countingGenerator(() => generated(pool[0]));
        const first = await ensureBrowserIdentity(dir, 'acc-p', ctx(), gen.generate);
        const stealth1 = JSON.stringify(stealthInputsFromIdentity(first));
        const camoufox1 = JSON.stringify(camoufoxIdentityLaunchOptions(first));

        pool = [UA_CHROME, UA_133, UA_135, UA_133, UA_CHROME];
        const second = await ensureBrowserIdentity(dir, 'acc-p', ctx(), gen.generate);
        expect(JSON.stringify(stealthInputsFromIdentity(second))).toBe(stealth1);
        expect(JSON.stringify(camoufoxIdentityLaunchOptions(second))).toBe(camoufox1);
        expect(gen.calls()).toBe(1);
        expect(camoufoxIdentityLaunchOptions(second).config['fonts:spacing_seed']).toBe(first.fontsSpacingSeed);
        expect(camoufoxIdentityLaunchOptions(second).os).toBe(first.os);
    });
});

describe('C23 — ogni incoerenza BLOCCA prima del lancio, mai rigenerazione', () => {
    it('engineBuild ≠ binario → throw (guardia prima di launch nel launcher)', async () => {
        const dir = tmp('build');
        await ensureBrowserIdentity(dir, 'acc-b', ctx(), async () => generated());
        await expectIdentityError(
            ensureBrowserIdentity(dir, 'acc-b', ctx({ engineBuild: '136.0-beta.1' }), async () => generated()),
            'IDENTITY_ENGINE_BUILD_MISMATCH',
        );
        // «0 pagine»: nel launcher la guardia precede OGNI launch (Camoufox e launchPersistentContext).
        const launcher = fs.readFileSync(path.join(process.cwd(), 'src', 'browser', 'launcher.ts'), 'utf8');
        const guardAt = launcher.indexOf('ensureLaunchIdentity(');
        expect(guardAt).toBeGreaterThan(0);
        expect(guardAt).toBeLessThan(launcher.indexOf('await Camoufox({'));
        expect(guardAt).toBeLessThan(launcher.indexOf('.launchPersistentContext('));
    });

    it('file corrotto → throw', async () => {
        const dir = tmp('corrupt');
        fs.writeFileSync(path.join(dir, IDENTITY_FILE_NAME), '{ "schemaVersion": 1, "userAgent": ', 'utf8');
        expect(() => readBrowserIdentity(dir)).toThrow(BrowserIdentityError);
        await expectIdentityError(ensureBrowserIdentity(dir, 'acc-c', ctx(), async () => generated()), 'IDENTITY_CORRUPT');
        // Schema valido ma campi mancanti = corrotto (mai «riempio i buchi»).
        fs.writeFileSync(path.join(dir, IDENTITY_FILE_NAME), JSON.stringify({ schemaVersion: 1, userAgent: UA_135 }), 'utf8');
        await expectIdentityError(ensureBrowserIdentity(dir, 'acc-c', ctx(), async () => generated()), 'IDENTITY_CORRUPT');
    });

    it('profilo con cookie senza file → throw, 0 scritture (layout Gecko e Chromium)', async () => {
        const gecko = tmp('gecko');
        fs.writeFileSync(path.join(gecko, 'cookies.sqlite'), '', 'utf8');
        expect(profileHasCookies(gecko)).toBe(true);
        const gen = countingGenerator(() => generated());
        await expectIdentityError(ensureBrowserIdentity(gecko, 'acc-g', ctx(), gen.generate), 'IDENTITY_MISSING_ON_AUTHENTICATED_PROFILE');
        expect(gen.calls()).toBe(0);
        expect(fs.existsSync(path.join(gecko, IDENTITY_FILE_NAME))).toBe(false);

        const chromium = tmp('chromium');
        fs.mkdirSync(path.join(chromium, 'Default', 'Network'), { recursive: true });
        fs.writeFileSync(path.join(chromium, 'Default', 'Network', 'Cookies'), '', 'utf8');
        expect(profileHasCookies(chromium)).toBe(true);
        await expectIdentityError(ensureBrowserIdentity(chromium, 'acc-k', ctx(), gen.generate), 'IDENTITY_MISSING_ON_AUTHENTICATED_PROFILE');
        expect(gen.calls()).toBe(0);
        expect(profileHasCookies(tmp('empty'))).toBe(false);
    });

    it('file con UA Firefox/133 e binario 135 → throw prima di launch', async () => {
        const dir = tmp('ua133');
        // Alla scrittura: il generatore propone una UA 133 su binario 135 → rifiutata, nessun file.
        await expectIdentityError(ensureBrowserIdentity(dir, 'acc-u', ctx(), async () => generated(UA_133)), 'IDENTITY_UA_MAJOR_MISMATCH');
        expect(fs.existsSync(path.join(dir, IDENTITY_FILE_NAME))).toBe(false);
        // A ogni lancio: file scritto a mano con UA 133 → rifiutato.
        const stale = await createBrowserIdentity(dir, 'acc-u', ctx({ engineBuild: '133.0.2-beta.19' }), generated(UA_133));
        expect(uaMajor(stale.userAgent)).toBe(133);
        await expectIdentityError(ensureBrowserIdentity(dir, 'acc-u', ctx(), async () => generated()), 'IDENTITY_ENGINE_BUILD_MISMATCH');
        const handWritten = tmp('ua133-hand');
        fs.writeFileSync(path.join(handWritten, IDENTITY_FILE_NAME), JSON.stringify({ ...stale, engineBuild: BUILD }), 'utf8');
        await expectIdentityError(ensureBrowserIdentity(handWritten, 'acc-u', ctx(), async () => generated()), 'IDENTITY_UA_MAJOR_MISMATCH');
    });

    it('UA Chrome con BROWSER_ENGINE=camoufox su cartella VERGINE → throw, 0 file, messaggio con identity-init --new-session', async () => {
        const dir = tmp('chrome-on-camoufox');
        const error = await expectIdentityError(
            ensureBrowserIdentity(dir, 'acc-x', ctx(), async () => generated(UA_CHROME)),
            'IDENTITY_UA_ENGINE_INCOHERENT',
        );
        expect(error.message).toContain('identity-init --new-session');
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('os ≠ host → IDENTITY_OS_MISMATCH alla lettura', async () => {
        const dir = tmp('os');
        const other = hostIdentityOs() === 'linux' ? 'windows' : 'linux';
        const identity = await createBrowserIdentity(dir, 'acc-o', ctx({ hostOs: other }), generated());
        expect(identity.os).toBe(other);
        await expectIdentityError(ensureBrowserIdentity(dir, 'acc-o', ctx(), async () => generated()), 'IDENTITY_OS_MISMATCH');
    });
});

describe('C23 — identity-init', () => {
    it('`--os` forzato ≠ host → exit ≠ 0 e nessuna scrittura', async () => {
        const dir = tmp('init-os');
        const other = hostIdentityOs() === 'linux' ? 'windows' : 'linux';
        let created = 0;
        const previousExitCode = process.exitCode;
        process.exitCode = undefined;
        const lines: string[] = [];
        const write = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array) => {
            lines.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
        try {
            await runIdentityInitCommand(['--os', other], {
                resolveTarget: () => ({ sessionDir: dir, accountId: 'default', newSession: false }),
                createIdentity: async () => {
                    created++;
                    throw new Error('non deve essere chiamato');
                },
            });
            expect(process.exitCode).not.toBe(0);
            expect(process.exitCode).not.toBeUndefined();
        } finally {
            process.stdout.write = write;
            process.exitCode = previousExitCode;
        }
        expect(created).toBe(0);
        expect(fs.readdirSync(dir)).toEqual([]);
        const output = JSON.parse(lines.join('')) as { ok: boolean; error?: string };
        expect(output.ok).toBe(false);
        expect(output.error).toContain(other);
    });
});

describe('C23 — helper puri', () => {
    it('uaMajor legge la famiglia giusta; rewriteVersionStrings replica la regola di camoufox-js', () => {
        expect(uaMajor(UA_135)).toBe(135);
        expect(uaMajor(UA_133)).toBe(133);
        expect(uaMajor(UA_CHROME)).toBe(145);
        expect(uaMajor('curl/8.0')).toBeNull();
        const rewritten = rewriteVersionStrings({ navigator: { userAgent: UA_133, oscpu: 'Windows NT 10.0; Win64; x64' }, n: 133 }, 135);
        expect(rewritten).toEqual({ navigator: { userAgent: UA_135, oscpu: 'Windows NT 10.0; Win64; x64' }, n: 133 });
        expect(rewriteVersionStrings('Chrome/131.0.0.0 Safari/537.36', 145)).toBe('Chrome/145.0.0.0 Safari/537.36');
    });

    it('seedRuntime esclude il file identità dal «profilo già visto» con lo STESSO nome (literal, niente import da browser/)', () => {
        const seedRuntime = fs.readFileSync(path.join(process.cwd(), 'src', 'fingerprint', 'seedRuntime.ts'), 'utf8');
        expect(seedRuntime).toContain(`const FILE_IDENTITA = '${IDENTITY_FILE_NAME}';`);
        expect(seedRuntime).toMatch(/some\(\(entry\) => entry !== FILE_IDENTITA\)/);
    });
});
