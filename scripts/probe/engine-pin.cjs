#!/usr/bin/env node
'use strict';
/**
 * Sonda C22 (goal `bot-operativo`, blocco A) — la combinazione COLLAUDATA è pinnata ESATTA e installata.
 *
 * Read-only. Legge: `package.json`, `package-lock.json`, `npm ls playwright-core --json --all`,
 * `process.versions.node`, `config/bot-settings.conf` (SOLO la chiave `CAMOUFOX_BINARY_VERSION`), la cache di
 * Camoufox (`%LOCALAPPDATA%\camoufox\camoufox\Cache\version.json`), `<sessionDir>/.fingerprint.json` SE esiste, e la
 * guardia COMPILATA `dist/browser/camoufoxRuntime.js` per misurare il comportamento «rifiuta, non scarica» su una
 * cache vuota (prerequisito: `npm run build` recente, come per `probe-deps.cjs`). Stampa SOLO versioni, booleani e
 * path: mai segreti.
 *
 * EXPECT (binding C22): ogni `checks.<nome>.ok === true` → exit 0; qualunque scostamento → exit 1; errore interno → 2.
 * Override SOLO per i casi negativi di `enginePin.vitest.ts`: `ENGINE_PIN_ROOT` (package.json, lock, conf, cwd di
 * `npm ls`), `ENGINE_PIN_CAMOUFOX_CACHE` (cartella con `version.json`), `ENGINE_PIN_SESSION_DIR` (cartella con
 * `.fingerprint.json`). Uso: `node scripts/probe/engine-pin.cjs`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const pinRoot = process.env.ENGINE_PIN_ROOT ? path.resolve(process.env.ENGINE_PIN_ROOT) : repoRoot;

/** La combinazione collaudata (binding C22). Cambiarla = rinegoziare il contratto, non ritoccare qui in silenzio. */
const EXPECTED = Object.freeze({
    playwright: '1.58.2',
    playwrightCore: '1.58.2',
    camoufoxJs: '0.9.3',
    enginesNode: '>=22',
    nodeMajorMin: 22,
    binary: '135.0.1-beta.24',
});

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function check(checks, name, ok, expected, actual) {
    checks[name] = { ok: Boolean(ok), expected, actual };
}

/** Versioni di `pkgName` nel lockfile (ogni profondità di `node_modules`): attese UNA sola. */
function lockVersionsOf(lock, pkgName) {
    const suffix = `node_modules/${pkgName}`;
    const versions = new Set();
    for (const [key, entry] of Object.entries(lock.packages || {})) {
        if (key === suffix || key.endsWith(`/${suffix}`)) versions.add(entry.version);
    }
    return [...versions].sort();
}

function walkNpmLs(node, pkgName, out) {
    for (const [name, child] of Object.entries((node && node.dependencies) || {})) {
        if (name === pkgName && child && child.version) out.add(child.version);
        walkNpmLs(child, pkgName, out);
    }
}

/** Versioni di `pkgName` viste da npm nell'albero installato (`npm ls` esce ≠ 0 con problemi ma stampa il JSON). */
function npmLsVersionsOf(cwd, pkgName) {
    const res = spawnSync(`npm ls ${pkgName} --json --all`, { cwd, encoding: 'utf8', shell: true, timeout: 60_000 });
    const out = new Set();
    try {
        walkNpmLs(JSON.parse(res.stdout || '{}'), pkgName, out);
    } catch (err) {
        // stdout non JSON: nessuna versione trovata → il check fallisce con actual=[]; il motivo resta visibile su stderr
        process.stderr.write(`engine-pin: output di npm ls non parsabile (${String(err && err.message).slice(0, 120)})\n`);
    }
    return [...out].sort();
}

/** Legge UNA chiave da un file `KEY=VALUE` (commenti `#`), senza toccare il resto. */
function readConfKey(confPath, key) {
    if (!fs.existsSync(confPath)) return null;
    for (const line of fs.readFileSync(confPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, '');
    }
    return null;
}

/** Stessa risoluzione di camoufox-js `userCacheDir('camoufox')` (`pkgman.js:262-270`, basata su `os.homedir()`). */
function defaultCacheDir() {
    if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache');
    }
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'camoufox');
    return path.join(os.homedir(), '.cache', 'camoufox');
}

function installedVersion(cacheDir) {
    const file = path.join(cacheDir, 'version.json');
    if (!fs.existsSync(file)) return null;
    const { version, release } = readJson(file);
    return release ? `${version}-${release}` : String(version);
}

/** `sessionDir` dell'account runtime, come `probe-deps.cjs` (config REALE da `dist/`); null se `dist/` manca. */
function resolveSessionDir() {
    if (process.env.ENGINE_PIN_SESSION_DIR) return path.resolve(process.env.ENGINE_PIN_SESSION_DIR);
    const accountManager = path.join(repoRoot, 'dist', 'accountManager.js');
    if (!fs.existsSync(accountManager)) return null;
    process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET ?? 'true';
    const originalLog = console.log;
    console.log = () => {};
    try {
        const { getRuntimeAccountProfiles } = require(accountManager);
        const profiles = getRuntimeAccountProfiles();
        return profiles.length > 0 ? profiles[0].sessionDir : null;
    } catch {
        return null;
    } finally {
        console.log = originalLog;
    }
}

function readIdentity(sessionDir) {
    if (!sessionDir) return { present: null };
    const file = path.join(sessionDir, '.fingerprint.json');
    if (!fs.existsSync(file)) return { present: false, file };
    const identity = readJson(file);
    const userAgent = String(identity.userAgent || '');
    const match = userAgent.match(/Firefox\/(\d+)/);
    return { present: true, file, uaMajor: match ? Number(match[1]) : null, engineBuild: identity.engineBuild ?? null };
}

/**
 * «Nessun auto-download al lancio», misurato: la guardia compilata, su una cache VUOTA, deve RIFIUTARE (errore
 * `CAMOUFOX_RUNTIME_NOT_PINNED`) senza mai chiamare `fetch`; e nel launcher compilato la guardia precede `Camoufox(`.
 */
function probeGuard(pinned) {
    const guardFile = path.join(repoRoot, 'dist', 'browser', 'camoufoxRuntime.js');
    const guardSrc = path.join(repoRoot, 'src', 'browser', 'camoufoxRuntime.ts');
    const launcherFile = path.join(repoRoot, 'dist', 'browser', 'launcher.js');
    if (!fs.existsSync(guardFile) || !fs.existsSync(launcherFile)) {
        return { ok: false, reason: 'dist/browser/{camoufoxRuntime,launcher}.js assente: npm run build' };
    }
    if (fs.existsSync(guardSrc) && fs.statSync(guardSrc).mtimeMs > fs.statSync(guardFile).mtimeMs) {
        return { ok: false, reason: 'dist stale rispetto a src/browser/camoufoxRuntime.ts: npm run build' };
    }
    const guard = require(guardFile);
    const emptyCache = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-pin-empty-'));
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('rete vietata nella sonda');
    };
    let refusedWith = null;
    try {
        guard.assertCamoufoxRuntimePinned({ pinned, cacheDir: emptyCache });
    } catch (err) {
        refusedWith = (err && err.code) || 'errore-senza-codice';
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(emptyCache, { recursive: true, force: true });
    }
    const launcher = fs.readFileSync(launcherFile, 'utf8');
    const guardAt = launcher.search(/assertCamoufoxRuntimePinned\)?\(/);
    const launchAt = launcher.indexOf('Camoufox({');
    const guardBeforeLaunch = guardAt !== -1 && launchAt !== -1 && guardAt < launchAt;
    const ok = refusedWith === 'CAMOUFOX_RUNTIME_NOT_PINNED' && fetchCalls === 0 && guardBeforeLaunch;
    return ok
        ? { ok: true }
        : { ok: false, reason: `refusedWith=${refusedWith} fetchCalls=${fetchCalls} guardBeforeLaunch=${guardBeforeLaunch}` };
}

(async () => {
    const checks = {};
    const pkg = readJson(path.join(pinRoot, 'package.json'));
    const lock = readJson(path.join(pinRoot, 'package-lock.json'));
    const deps = pkg.dependencies || {};

    check(checks, 'playwright', deps.playwright === EXPECTED.playwright, EXPECTED.playwright, deps.playwright ?? null);
    check(checks, 'camoufoxJs', deps['camoufox-js'] === EXPECTED.camoufoxJs, EXPECTED.camoufoxJs, deps['camoufox-js'] ?? null);
    const override = (pkg.overrides || {})['playwright-core'] ?? null;
    check(checks, 'overridePlaywrightCore', override === EXPECTED.playwrightCore, EXPECTED.playwrightCore, override);
    const enginesNode = (pkg.engines || {}).node ?? null;
    check(checks, 'enginesNode', enginesNode === EXPECTED.enginesNode, EXPECTED.enginesNode, enginesNode);
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    check(checks, 'nodeRuntime', nodeMajor >= EXPECTED.nodeMajorMin, `>=${EXPECTED.nodeMajorMin}`, process.versions.node);

    const lockVersions = lockVersionsOf(lock, 'playwright-core');
    check(
        checks,
        'lockPlaywrightCore',
        lockVersions.length === 1 && lockVersions[0] === EXPECTED.playwrightCore,
        [EXPECTED.playwrightCore],
        lockVersions,
    );
    const lsVersions = npmLsVersionsOf(pinRoot, 'playwright-core');
    check(
        checks,
        'npmLsPlaywrightCore',
        lsVersions.length === 1 && lsVersions[0] === EXPECTED.playwrightCore,
        [EXPECTED.playwrightCore],
        lsVersions,
    );

    const confPin = readConfKey(path.join(pinRoot, 'config', 'bot-settings.conf'), 'CAMOUFOX_BINARY_VERSION');
    check(checks, 'confPin', confPin === EXPECTED.binary, EXPECTED.binary, confPin);

    const cacheDir = process.env.ENGINE_PIN_CAMOUFOX_CACHE
        ? path.resolve(process.env.ENGINE_PIN_CAMOUFOX_CACHE)
        : defaultCacheDir();
    const installed = installedVersion(cacheDir);
    check(checks, 'binary', installed === EXPECTED.binary, EXPECTED.binary, installed);

    const guard = probeGuard(EXPECTED.binary);
    check(checks, 'autoFetch', guard.ok, false, guard.ok ? false : guard.reason);

    const sessionDir = resolveSessionDir();
    const identity = readIdentity(sessionDir);
    const binaryMajor = installed ? Number(installed.split('.')[0]) : null;
    if (identity.present) {
        check(checks, 'identityUaMajor', identity.uaMajor === binaryMajor, binaryMajor, identity.uaMajor);
    } else {
        checks.identityUaMajor = {
            ok: true,
            skipped: identity.present === null ? 'sessionDir non risolto (dist assente)' : 'file identità assente (lo crea C23)',
            file: identity.file ?? null,
        };
    }

    const ok = Object.values(checks).every((c) => c.ok);
    const result = { expected: EXPECTED, root: pinRoot, cacheDir, sessionDir, node: process.versions.node, checks, ok };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(ok ? 0 : 1);
})().catch((err) => {
    process.stderr.write(`engine-pin: ${String(err && err.message).slice(0, 300)}\n`);
    process.exit(2);
});
