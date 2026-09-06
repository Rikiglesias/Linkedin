/**
 * camoufoxRuntime.ts — binario Camoufox PINNATO, presente e coerente PRIMA del lancio (C22, contratto `bot-operativo`).
 *
 * Perché esiste: camoufox-js 0.9.3 risolve la cache a OGNI lancio con `camoufoxPath(downloadIfMissing = true)`
 * (`pkgman.js:276-295`, raggiunta da `launchPath()` e da `getPath()` per fontconfig/properties.json): cache vuota o
 * versione fuori dai vincoli della libreria ⇒ `new CamoufoxFetcher().install()` fire-and-forget dell'ULTIMA release
 * su GitHub — non della nostra — mentre il lancio prosegue. Gli addon di default (uBO) seguono la stessa regola
 * (`addons.js:54-72`). Un binario diverso è un fingerprint diverso a livello C++: il device cambia sotto l'account.
 *
 * Contratto: `assertCamoufoxRuntimePinned` legge SOLO il filesystem (mai rete) e LANCIA `CamoufoxRuntimeError` con il
 * comando che risolve; lo scarico del TAG ESATTO vive in `installPinnedCamoufox`, usato SOLO da `bot.ps1 camoufox-fetch`.
 * NON si usa `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`: silenzierebbe uBO invece di fermare il lancio (fail-open).
 * Verdetto anti-ban 2026-09-07: SICURO (nessun cambio a timing/navigazione/volumi; rimuove un auto-download).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Addon che camoufox-js aggiunge di default a ogni lancio (`DefaultAddons`, `addons.js:8-11`). */
export const DEFAULT_CAMOUFOX_ADDONS: readonly string[] = ['UBO'];

const GITHUB_RELEASES = 'https://github.com/daijro/camoufox/releases/download';
/** Stesse mappe di camoufox-js (`pkgman.js:12-36`): nome OS e architettura nel nome dell'asset. */
const OS_NAME: Partial<Record<NodeJS.Platform, string>> = { win32: 'win', darwin: 'mac', linux: 'lin' };
const ARCH_NAME: Record<string, string> = { x64: 'x86_64', ia32: 'i686', arm64: 'arm64', arm: 'arm64' };

export interface CamoufoxRuntimeOptions {
    /** Versione dichiarata in `config/bot-settings.conf` (`CAMOUFOX_BINARY_VERSION`), es. `135.0.1-beta.24`. */
    pinned: string;
    /** Cache di camoufox-js; default = la stessa risoluzione della libreria. Override SOLO nei test e nella sonda. */
    cacheDir?: string;
    addons?: readonly string[];
}

export interface CamoufoxRuntimeStatus {
    cacheDir: string;
    pinned: string;
    /** `${version}-${release}` da `version.json`, null se il binario non è installato. */
    installed: string | null;
    addonsMissing: string[];
    problems: string[];
    ok: boolean;
}

export class CamoufoxRuntimeError extends Error {
    readonly code = 'CAMOUFOX_RUNTIME_NOT_PINNED';

    constructor(readonly status: CamoufoxRuntimeStatus) {
        super(
            `Camoufox non pronto al lancio: ${status.problems.join('; ')}. ` +
                `Risolvi con: .\\bot.ps1 camoufox-fetch (installa SOLO ${status.pinned || 'la versione dichiarata'}, mai «latest»)`,
        );
        this.name = 'CamoufoxRuntimeError';
    }
}

/** Stessa risoluzione di camoufox-js `userCacheDir('camoufox')` (`pkgman.js:262-270`, basata su `os.homedir()`). */
export function defaultCamoufoxCacheDir(): string {
    if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache');
    }
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'camoufox');
    return path.join(os.homedir(), '.cache', 'camoufox');
}

/** `version.json` come lo scrive `CamoufoxFetcher.setVersion` (`pkgman.js:212`): `{ version, release }`. */
export function readInstalledCamoufoxVersion(cacheDir: string): string | null {
    const file = path.join(cacheDir, 'version.json');
    if (!fs.existsSync(file)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string; release?: string };
        if (!parsed.version) return null;
        return parsed.release ? `${parsed.version}-${parsed.release}` : parsed.version;
    } catch {
        return null;
    }
}

export function inspectCamoufoxRuntime(options: CamoufoxRuntimeOptions): CamoufoxRuntimeStatus {
    const cacheDir = options.cacheDir ?? defaultCamoufoxCacheDir();
    const addons = options.addons ?? DEFAULT_CAMOUFOX_ADDONS;
    const pinned = options.pinned.trim();
    const installed = readInstalledCamoufoxVersion(cacheDir);
    const problems: string[] = [];
    if (!pinned) problems.push('CAMOUFOX_BINARY_VERSION non dichiarata in config/bot-settings.conf');
    if (installed === null) problems.push(`binario assente in ${cacheDir} (nessun version.json)`);
    else if (pinned && installed !== pinned) problems.push(`binario installato ${installed} ≠ pin ${pinned}`);
    const addonsMissing = addons.filter((name) => !fs.existsSync(path.join(cacheDir, 'addons', name)));
    if (addonsMissing.length > 0) {
        problems.push(`addon di default assenti (il lancio li scaricherebbe): ${addonsMissing.join(', ')}`);
    }
    return { cacheDir, pinned, installed, addonsMissing, problems, ok: problems.length === 0 };
}

/** Da chiamare PRIMA di `Camoufox()`: rifiuta il lancio (mai scarica) se binario o addon non sono quelli collaudati. */
export function assertCamoufoxRuntimePinned(options: CamoufoxRuntimeOptions): CamoufoxRuntimeStatus {
    const status = inspectCamoufoxRuntime(options);
    if (!status.ok) throw new CamoufoxRuntimeError(status);
    return status;
}

/** Asset del TAG ESATTO su GitHub (`camoufox-<ver>-<os>.<arch>.zip`: pattern di `CamoufoxFetcher`, `pkgman.js:159`). */
export function pinnedCamoufoxAssetUrl(
    pinned: string,
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): string {
    const osName = OS_NAME[platform];
    const archName = ARCH_NAME[arch];
    if (!osName || !archName) throw new Error(`Piattaforma non supportata da Camoufox: ${platform}/${arch}`);
    return `${GITHUB_RELEASES}/v${pinned}/camoufox-${pinned}-${osName}.${archName}.zip`;
}

/**
 * Scarica e installa il TAG ESATTO nella cache della libreria (mai «latest»), poi gli addon di default e il DB GeoIP
 * come farebbe `npx camoufox-js fetch`, riusando i primitivi di camoufox-js (`webdl`, `unzip`, `addDefaultAddons`,
 * `downloadMMDB`). Ordine: prima il download in memoria, POI la rimozione della cache — un guasto di rete non
 * distrugge l'installazione esistente. Mai con un browser Camoufox aperto. La chiama SOLO `bot.ps1 camoufox-fetch`.
 */
export async function installPinnedCamoufox(options: CamoufoxRuntimeOptions): Promise<CamoufoxRuntimeStatus> {
    const pinned = options.pinned.trim();
    if (!pinned) throw new CamoufoxRuntimeError(inspectCamoufoxRuntime(options));
    const [version, ...releaseParts] = pinned.split('-');
    const cacheDir = options.cacheDir ?? defaultCamoufoxCacheDir();

    const pkgman = await import('camoufox-js/dist/pkgman.js');
    const zip = await pkgman.webdl(pinnedCamoufoxAssetUrl(pinned), `Camoufox ${pinned}`, true);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    await pkgman.unzip(zip, cacheDir, `Estrazione Camoufox ${pinned}`, true);
    fs.writeFileSync(path.join(cacheDir, 'version.json'), JSON.stringify({ version, release: releaseParts.join('-') }));

    // Addon di default nella cache della libreria (scarica SOLO quelli assenti, `addons.js:54-72`).
    const addons = await import('camoufox-js/dist/addons.js');
    await addons.addDefaultAddons([]);
    try {
        const locale = await import('camoufox-js/dist/locale.js');
        await locale.downloadMMDB();
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`GeoIP DB non scaricato (serve solo con CAMOUFOX_GEOIP e proxy): ${reason}\n`);
    }
    return inspectCamoufoxRuntime({ ...options, cacheDir });
}
