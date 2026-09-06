/**
 * enginePin.vitest.ts — C22 del contratto `bot-operativo` (blocco A): la combinazione collaudata è pinnata ESATTA,
 * la guardia di lancio RIFIUTA (mai scarica) e la sonda `scripts/probe/engine-pin.cjs` fallisce sui due casi
 * negativi del binding (lockfile alterato; identità UA 133 su binario 135).
 *
 * Il verdetto POSITIVO completo della sonda (exit 0) legge `dist/` e la cache Camoufox di questa macchina: è la
 * VERIFY manuale del contratto dopo `npm run build`. Qui si asseriscono i check intrinseci al repo (indipendenti da
 * build e macchina) e i casi negativi con cache/sessione FINTE in una cartella temporanea.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CamoufoxRuntimeError,
    DEFAULT_CAMOUFOX_ADDONS,
    assertCamoufoxRuntimePinned,
    inspectCamoufoxRuntime,
    pinnedCamoufoxAssetUrl,
} from '../browser/camoufoxRuntime';

const ROOT = process.cwd();
const SONDA = path.join(ROOT, 'scripts', 'probe', 'engine-pin.cjs');
const PIN = '135.0.1-beta.24';
const UA_133 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const tempDirs: string[] = [];
function tmp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `engine-pin-${prefix}-`));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Cache Camoufox finta: `version.json` come lo scrive `CamoufoxFetcher.setVersion` + le cartelle degli addon. */
function fakeCache(version = PIN, addons: readonly string[] = DEFAULT_CAMOUFOX_ADDONS): string {
    const dir = tmp('cache');
    const [ver, ...rel] = version.split('-');
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: ver, release: rel.join('-') }));
    fs.writeFileSync(path.join(dir, 'camoufox.exe'), '');
    for (const addon of addons) fs.mkdirSync(path.join(dir, 'addons', addon), { recursive: true });
    return dir;
}

interface SondaCheck {
    ok: boolean;
    expected?: unknown;
    actual?: unknown;
}

interface SondaJson {
    checks: Record<string, SondaCheck>;
    ok: boolean;
}

interface SondaRun {
    status: number | null;
    json: SondaJson;
    stderr: string;
}

function runSonda(env: Record<string, string>): SondaRun {
    const res = spawnSync(process.execPath, [SONDA], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        timeout: 120_000,
    });
    let json: SondaJson | null = null;
    try {
        json = JSON.parse(res.stdout) as SondaJson;
    } catch {
        json = null;
    }
    if (json === null) throw new Error(`sonda senza JSON (exit ${res.status}): ${res.stderr}`);
    return { status: res.status, json, stderr: res.stderr };
}

describe('C22 — pin ESATTO in package.json e lockfile', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

    it('playwright e camoufox-js senza caret, override playwright-core esatto, engines.node >=22', () => {
        expect(pkg.dependencies.playwright).toBe('1.58.2');
        expect(pkg.dependencies['camoufox-js']).toBe('0.9.3');
        expect(pkg.overrides['playwright-core']).toBe('1.58.2');
        expect(pkg.engines.node).toBe('>=22');
    });

    it('il lockfile contiene UNA sola playwright-core = 1.58.2', () => {
        const versions = new Set<string>();
        for (const [key, entry] of Object.entries(lock.packages as Record<string, { version?: string }>)) {
            if (/(^|\/)node_modules\/playwright-core$/.test(key) && entry.version) versions.add(entry.version);
        }
        expect([...versions]).toEqual(['1.58.2']);
    });
});

describe('C22 — guardia di lancio: presente e = pin, altrimenti RIFIUTA senza scaricare', () => {
    it('cache completa e = pin → ok, nessun problema', () => {
        const status = inspectCamoufoxRuntime({ pinned: PIN, cacheDir: fakeCache() });
        expect(status.ok).toBe(true);
        expect(status.installed).toBe(PIN);
        expect(status.problems).toEqual([]);
        expect(() => assertCamoufoxRuntimePinned({ pinned: PIN, cacheDir: status.cacheDir })).not.toThrow();
    });

    it('cache vuota → CamoufoxRuntimeError con il comando che risolve, e fetch MAI chiamata', () => {
        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            throw new Error('rete vietata nel test');
        }) as typeof fetch;
        try {
            const cacheDir = tmp('empty');
            expect(() => assertCamoufoxRuntimePinned({ pinned: PIN, cacheDir })).toThrow(CamoufoxRuntimeError);
            let caught: unknown = null;
            try {
                assertCamoufoxRuntimePinned({ pinned: PIN, cacheDir });
            } catch (err) {
                caught = err;
            }
            expect((caught as CamoufoxRuntimeError).code).toBe('CAMOUFOX_RUNTIME_NOT_PINNED');
            expect((caught as Error).message).toContain('camoufox-fetch');
            expect(fetchCalls).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('versione installata ≠ pin → rifiuto che nomina entrambe le versioni', () => {
        const cacheDir = fakeCache('136.0-beta.1');
        const status = inspectCamoufoxRuntime({ pinned: PIN, cacheDir });
        expect(status.ok).toBe(false);
        expect(status.problems.join(' ')).toContain('136.0-beta.1');
        expect(status.problems.join(' ')).toContain(PIN);
        expect(() => assertCamoufoxRuntimePinned({ pinned: PIN, cacheDir })).toThrow(/136\.0-beta\.1/);
    });

    it('addon di default assente → rifiuto che nomina l’addon (il lancio lo scaricherebbe)', () => {
        const status = inspectCamoufoxRuntime({ pinned: PIN, cacheDir: fakeCache(PIN, []) });
        expect(status.ok).toBe(false);
        expect(status.addonsMissing).toEqual([...DEFAULT_CAMOUFOX_ADDONS]);
        expect(status.problems.join(' ')).toContain('UBO');
    });

    it('pin vuoto → rifiuto: il pin va dichiarato in config/bot-settings.conf', () => {
        expect(() => assertCamoufoxRuntimePinned({ pinned: '', cacheDir: fakeCache() })).toThrow(/CAMOUFOX_BINARY_VERSION/);
    });

    it('URL dell’asset = tag ESATTO su GitHub, mai «latest»', () => {
        expect(pinnedCamoufoxAssetUrl(PIN, 'win32', 'x64')).toBe(
            'https://github.com/daijro/camoufox/releases/download/v135.0.1-beta.24/camoufox-135.0.1-beta.24-win.x86_64.zip',
        );
        expect(pinnedCamoufoxAssetUrl(PIN, 'linux', 'arm64')).toContain('-lin.arm64.zip');
    });
});

describe('C22 — il launcher chiama la guardia PRIMA di Camoufox() (sentinella di forma)', () => {
    it('import per simbolo da ./camoufoxRuntime e chiamata dentro il ramo camoufox, prima di `await Camoufox({`', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src', 'browser', 'launcher.ts'), 'utf8');
        expect(source).toMatch(/import \{[^}]*\bassertCamoufoxRuntimePinned\b[^}]*\} from '\.\/camoufoxRuntime'/);
        const branchAt = source.indexOf('if (useCamoufox) {');
        const guardAt = source.indexOf('assertCamoufoxRuntimePinned(', branchAt);
        const launchAt = source.indexOf('await Camoufox({', branchAt);
        expect(branchAt).toBeGreaterThan(-1);
        expect(guardAt).toBeGreaterThan(branchAt);
        expect(launchAt).toBeGreaterThan(guardAt);
    });
});

describe('C22 — sonda engine-pin.cjs', () => {
    const INTRINSIC = [
        'playwright',
        'camoufoxJs',
        'overridePlaywrightCore',
        'enginesNode',
        'nodeRuntime',
        'lockPlaywrightCore',
        'npmLsPlaywrightCore',
        'binary',
    ];

    it('sul repo reale i check intrinseci sono verdi (pin, lock, npm ls, engines, node)', () => {
        const run = runSonda({ ENGINE_PIN_CAMOUFOX_CACHE: fakeCache(), ENGINE_PIN_SESSION_DIR: tmp('session') });
        const checks = run.json.checks;
        for (const name of INTRINSIC) {
            expect(checks[name]?.ok, `${name}: ${JSON.stringify(checks[name])}`).toBe(true);
        }
        expect(checks.identityUaMajor.ok).toBe(true);
    });

    it('caso negativo 1: lockfile alterato in un tmp → exit 1 e lockPlaywrightCore rosso', () => {
        const root = tmp('root');
        fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
        const altered = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
        altered.packages['node_modules/playwright-core'].version = '9.9.9';
        fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(altered));
        fs.mkdirSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'config', 'bot-settings.conf'), `CAMOUFOX_BINARY_VERSION=${PIN}\n`);

        const run = runSonda({
            ENGINE_PIN_ROOT: root,
            ENGINE_PIN_CAMOUFOX_CACHE: fakeCache(),
            ENGINE_PIN_SESSION_DIR: tmp('session'),
        });
        expect(run.status).toBe(1);
        expect(run.json.ok).toBe(false);
        expect(run.json.checks.lockPlaywrightCore.ok).toBe(false);
        expect(run.json.checks.lockPlaywrightCore.actual).toEqual(['9.9.9']);
        expect(run.json.checks.playwright.ok).toBe(true);
        expect(run.json.checks.confPin.ok).toBe(true);
    });

    it('caso negativo 2: identità con UA Firefox/133 e binario 135 → exit 1 e identityUaMajor rosso', () => {
        const session = tmp('session');
        fs.writeFileSync(path.join(session, '.fingerprint.json'), JSON.stringify({ userAgent: UA_133, engineBuild: PIN }));
        const run = runSonda({ ENGINE_PIN_CAMOUFOX_CACHE: fakeCache(), ENGINE_PIN_SESSION_DIR: session });
        expect(run.status).toBe(1);
        expect(run.json.checks.identityUaMajor.ok).toBe(false);
        expect(run.json.checks.identityUaMajor.actual).toBe(133);
        expect(run.json.checks.identityUaMajor.expected).toBe(135);
        expect(run.json.checks.binary.ok).toBe(true);
    });
});
