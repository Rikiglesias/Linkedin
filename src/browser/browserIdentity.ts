/**
 * browserIdentity.ts — identità PERSISTITA del browser (C23 + C52 del contratto `bot-operativo`).
 *
 * `<sessionDir>/.fingerprint.json` è l'UNICA sorgente di ciò che la pagina vede: scritto UNA volta (atomico ed
 * ESCLUSIVO: temp + hard link, mai sovrascritto — nemmeno nella corsa fra due processi sullo stesso profilo), poi
 * letto a OGNI lancio e validato PRIMA di qualunque `launch`:
 *  - `engine` = engine del lancio (C52: bloccato per la vita del profilo — un lancio Chromium su un profilo Gecko non
 *    ruba il cookie, crea un profilo vergine con un device DIVERSO sotto lo stesso account);
 *  - `accountId` = profilo del lancio (un file copiato da un'altra sessionDir = lo stesso device su due account);
 *  - `engineBuild` = binario installato (Camoufox `version.json` di C22, o la build Playwright);
 *  - `major(userAgent)` = `major(engineBuild)` (camoufox-js riscrive comunque la UA al major installato,
 *    `fingerprints.js:_castToProperties`: un file diverso dalla pagina sarebbero DUE identità);
 *  - UA coerente con la famiglia dell'engine (`isUaTlsCoherentWithEngine`, `stealth.ts`);
 *  - `os` = piattaforma dell'host (font e WebGL del binario sono quelli dell'host: un `os` diverso è rilevabile);
 *  - su Camoufox `browserforge` è OBBLIGATORIO: con `null` camoufox-js ne genererebbe uno NUOVO a ogni lancio
 *    (`utils.js:345`), cioè la rigenerazione silenziosa che questo file esiste per impedire.
 * Qualunque incoerenza, file corrotto o identità ASSENTE su un profilo che ha già cookie ⇒ `BrowserIdentityError`
 * (lancio BLOCCATO, 0 pagine) con il comando che risolve. MAI rigenerazione automatica: un device nuovo sotto un
 * account già visto da LinkedIn è il segnale che questo file esiste per eliminare.
 *
 * Qui SOLO la regola, pura (filesystem a parte): niente `config`, niente browser. L'aritmetica di versione sta in
 * `browserIdentityVersion.ts` (ri-esportata qui per i consumer); il cablaggio con camoufox-js, il pool e la config in
 * `browserIdentityRuntime.ts` (stesso taglio di `fingerprint/accountSeed.ts` ↔ `seedRuntime.ts`); le proiezioni
 * verso launcher/Camoufox in `browserIdentityProjection.ts`.
 */
import fs from 'fs';
import path from 'path';
import { engineBuildMajor, rewriteVersionStrings, uaMajor } from './browserIdentityVersion';

export { engineBuildMajor, rewriteVersionStrings, uaMajor };

export const IDENTITY_FILE_NAME = '.fingerprint.json';
export const IDENTITY_SCHEMA_VERSION = 1 as const;
export const IDENTITY_FIX_COMMAND = '.\\bot.ps1 identity-init --new-session';
/** Stesso intervallo che camoufox-js usa per il seme casuale di default (`utils.js:381`). */
export const FONTS_SPACING_SEED_MAX = 1_073_741_824;

export type IdentityEngine = 'camoufox' | 'firefox' | 'chromium';
export type IdentityOs = 'windows' | 'macos' | 'linux';
const IDENTITY_ENGINES: ReadonlySet<string> = new Set<IdentityEngine>(['camoufox', 'firefox', 'chromium']);
const IDENTITY_OSES: ReadonlySet<string> = new Set<IdentityOs>(['windows', 'macos', 'linux']);

export type BrowserIdentityErrorCode =
    | 'IDENTITY_CORRUPT'
    | 'IDENTITY_MISSING_ON_AUTHENTICATED_PROFILE'
    | 'IDENTITY_ENGINE_MISMATCH'
    | 'IDENTITY_ACCOUNT_MISMATCH'
    | 'IDENTITY_ENGINE_BUILD_MISMATCH'
    | 'IDENTITY_UA_MAJOR_MISMATCH'
    | 'IDENTITY_UA_ENGINE_INCOHERENT'
    | 'IDENTITY_OS_MISMATCH'
    | 'IDENTITY_ALREADY_EXISTS';

export class BrowserIdentityError extends Error {
    constructor(
        public readonly code: BrowserIdentityErrorCode,
        detail: string,
    ) {
        super(`[IDENTITY] ${detail} → nessuna rigenerazione automatica. Esegui: ${IDENTITY_FIX_COMMAND}`);
        this.name = 'BrowserIdentityError';
    }
}

/** Ciò che il generatore (browserforge su Camoufox, pool sugli altri engine) produce UNA volta per profilo. */
export interface GeneratedIdentity {
    fingerprintId: string;
    userAgent: string;
    locale: string;
    languages: string[];
    timezone?: string;
    viewport: { width: number; height: number };
    isMobile: boolean;
    hasTouch: boolean;
    deviceScaleFactor: number;
    hardwareConcurrency: number;
    /** Firefox non espone `navigator.deviceMemory`: `null` = non iniettare. */
    deviceMemory: number | null;
    colorDepth: number;
    /** Impronta TLS attesa (dal pool o `config.ja3Fingerprint`): il pool la richiede sempre. */
    ja3: string;
    /** Fingerprint browserforge COMPLETO (quello che Camoufox applica nativamente); `null` sugli altri engine. */
    browserforge: unknown | null;
}

export interface PersistedBrowserIdentity extends GeneratedIdentity {
    schemaVersion: typeof IDENTITY_SCHEMA_VERSION;
    accountId: string;
    engine: IdentityEngine;
    engineBuild: string;
    os: IdentityOs;
    fontsSpacingSeed: number;
    createdAt: string;
}

/** Il mondo contro cui l'identità è validata a ogni lancio (e alla creazione). */
export interface IdentityContext {
    engine: IdentityEngine;
    engineBuild: string;
    hostOs: IdentityOs;
    isUaCoherentWithEngine: (userAgent: string) => boolean;
}

export function hostIdentityOs(platform: NodeJS.Platform = process.platform): IdentityOs {
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
}

/** Cookie jar dei DUE layout: Gecko/Camoufox (`cookies.sqlite`) e Chromium (`Default/Network/Cookies`, legacy `Default/Cookies`). */
export function profileHasCookies(sessionDir: string): boolean {
    const candidates = ['cookies.sqlite', path.join('Default', 'Network', 'Cookies'), path.join('Default', 'Cookies'), 'Cookies'];
    return candidates.some((candidate) => fs.existsSync(path.join(sessionDir, candidate)));
}

export function identityFilePath(sessionDir: string): string {
    return path.join(sessionDir, IDENTITY_FILE_NAME);
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function assertIdentityShape(raw: unknown, file: string): PersistedBrowserIdentity {
    const bad = (campo: string): never => {
        throw new BrowserIdentityError('IDENTITY_CORRUPT', `${file} non è un'identità valida (campo «${campo}»)`);
    };
    if (!raw || typeof raw !== 'object') bad('root');
    const r = raw as Record<string, unknown>;
    if (r.schemaVersion !== IDENTITY_SCHEMA_VERSION) bad('schemaVersion');
    for (const key of ['accountId', 'engineBuild', 'userAgent', 'locale', 'fingerprintId', 'createdAt'] as const) {
        if (!isString(r[key])) bad(key);
    }
    if (!isString(r.engine) || !IDENTITY_ENGINES.has(r.engine)) bad('engine');
    if (!isString(r.os) || !IDENTITY_OSES.has(r.os)) bad('os');
    const seed = r.fontsSpacingSeed;
    if (!isFiniteNumber(seed) || !Number.isInteger(seed) || seed < 0 || seed >= FONTS_SPACING_SEED_MAX) bad('fontsSpacingSeed');
    for (const key of ['hardwareConcurrency', 'colorDepth', 'deviceScaleFactor'] as const) {
        if (!isFiniteNumber(r[key])) bad(key);
    }
    if (r.deviceMemory !== null && !isFiniteNumber(r.deviceMemory)) bad('deviceMemory');
    const viewport = r.viewport as Record<string, unknown> | undefined;
    if (!viewport || !isFiniteNumber(viewport.width) || !isFiniteNumber(viewport.height)) bad('viewport');
    if (!Array.isArray(r.languages) || !r.languages.every(isString)) bad('languages');
    if (typeof r.isMobile !== 'boolean' || typeof r.hasTouch !== 'boolean') bad('isMobile/hasTouch');
    if (r.timezone !== undefined && !isString(r.timezone)) bad('timezone');
    if (!isString(r.ja3)) bad('ja3');
    if (r.browserforge !== null && (typeof r.browserforge !== 'object' || Array.isArray(r.browserforge))) bad('browserforge');
    // Su Camoufox il fingerprint browserforge È l'identità: senza, camoufox-js ne genera uno nuovo a ogni lancio.
    if (r.engine === 'camoufox' && r.browserforge === null) bad('browserforge');
    return r as unknown as PersistedBrowserIdentity;
}

/** `null` se il file non esiste; `IDENTITY_CORRUPT` se esiste ma non è leggibile o non ha la forma attesa. */
export function readBrowserIdentity(sessionDir: string): PersistedBrowserIdentity | null {
    const file = identityFilePath(sessionDir);
    if (!fs.existsSync(file)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new BrowserIdentityError('IDENTITY_CORRUPT', `${file} illeggibile: ${error instanceof Error ? error.message : String(error)}`);
    }
    return assertIdentityShape(raw, file);
}

export function validateBrowserIdentity(identity: PersistedBrowserIdentity, ctx: IdentityContext): void {
    // C52: PRIMA l'engine — un cambio di engine cambia anche il binario, e l'errore giusto è «engine», non «binario».
    if (identity.engine !== ctx.engine) {
        throw new BrowserIdentityError(
            'IDENTITY_ENGINE_MISMATCH',
            `identità creata su ${identity.engine}, lancio su ${ctx.engine}: l'engine è bloccato per la vita del profilo ` +
                `(BROWSER_ENGINE=${identity.engine}, oppure un profilo NUOVO)`,
        );
    }
    if (identity.engineBuild !== ctx.engineBuild) {
        throw new BrowserIdentityError(
            'IDENTITY_ENGINE_BUILD_MISMATCH',
            `identità creata sul binario ${identity.engineBuild}, installato ${ctx.engineBuild} (engine ${ctx.engine})`,
        );
    }
    // Prima la FAMIGLIA (una UA Chrome su Gecko è l'errore, non «major sbagliato»), poi il major, poi l'host.
    if (!ctx.isUaCoherentWithEngine(identity.userAgent)) {
        throw new BrowserIdentityError('IDENTITY_UA_ENGINE_INCOHERENT', `UA «${identity.userAgent}» incoerente con l'engine ${ctx.engine}`);
    }
    const ua = uaMajor(identity.userAgent);
    const build = engineBuildMajor(ctx.engineBuild);
    if (ua === null || build === null || ua !== build) {
        throw new BrowserIdentityError(
            'IDENTITY_UA_MAJOR_MISMATCH',
            `major della UA (${ua ?? '?'}) ≠ major del binario (${build ?? '?'}): «${identity.userAgent}»`,
        );
    }
    if (identity.os !== ctx.hostOs) {
        throw new BrowserIdentityError('IDENTITY_OS_MISMATCH', `identità dichiarata «${identity.os}», host «${ctx.hostOs}»`);
    }
}

export interface CreateIdentityOptions {
    now?: () => Date;
    random?: () => number;
}

/** Costruisce, valida e scrive l'identità UNA volta (atomico ed esclusivo: temp + hard link; esiste già ⇒ errore, mai overwrite). */
export async function createBrowserIdentity(
    sessionDir: string,
    accountId: string,
    ctx: IdentityContext,
    generated: GeneratedIdentity,
    options: CreateIdentityOptions = {},
): Promise<PersistedBrowserIdentity> {
    const now = options.now ?? (() => new Date());
    const random = options.random ?? Math.random;
    // Ordine delle chiavi FISSO: è l'ordine di serializzazione, e «stesso account ⇒ file byte-identico» passa da qui.
    const identity: PersistedBrowserIdentity = {
        schemaVersion: IDENTITY_SCHEMA_VERSION,
        accountId,
        engine: ctx.engine,
        engineBuild: ctx.engineBuild,
        os: ctx.hostOs,
        userAgent: generated.userAgent,
        locale: generated.locale,
        languages: [...generated.languages],
        timezone: generated.timezone,
        viewport: { width: generated.viewport.width, height: generated.viewport.height },
        isMobile: generated.isMobile,
        hasTouch: generated.hasTouch,
        deviceScaleFactor: generated.deviceScaleFactor,
        hardwareConcurrency: generated.hardwareConcurrency,
        deviceMemory: generated.deviceMemory,
        colorDepth: generated.colorDepth,
        ja3: generated.ja3,
        fingerprintId: generated.fingerprintId,
        fontsSpacingSeed: Math.floor(random() * FONTS_SPACING_SEED_MAX),
        browserforge: generated.browserforge,
        createdAt: now().toISOString(),
    };
    const file = identityFilePath(sessionDir);
    assertIdentityShape(identity, file); // le stesse invarianti della lettura (browserforge su Camoufox incluso)
    validateBrowserIdentity(identity, ctx);

    if (fs.existsSync(file)) {
        throw new BrowserIdentityError('IDENTITY_ALREADY_EXISTS', `${file} esiste già: l'identità si scrive una volta sola`);
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
        // Pubblicazione ESCLUSIVA e atomica: `link(2)` fallisce con EEXIST se il nome esiste già (un altro processo ha
        // vinto la corsa fra il check sopra e questa riga), dove `rename` sovrascriverebbe in silenzio.
        fs.linkSync(temp, file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new BrowserIdentityError(
                'IDENTITY_ALREADY_EXISTS',
                `${file} scritto da un altro processo durante la creazione: l'identità si scrive una volta sola`,
            );
        }
        throw error;
    } finally {
        fs.rmSync(temp, { force: true });
    }
    return identity;
}

/**
 * Il punto d'ingresso del lancio: legge e valida l'identità esistente (che deve appartenere a QUESTO profilo); se manca,
 * la crea SOLO su profilo vergine (nessun cookie jar). `generate` viene chiamato al massimo una volta nella vita del profilo.
 */
export async function ensureBrowserIdentity(
    sessionDir: string,
    accountId: string,
    ctx: IdentityContext,
    generate: () => Promise<GeneratedIdentity>,
    options: CreateIdentityOptions = {},
): Promise<PersistedBrowserIdentity> {
    const existing = readBrowserIdentity(sessionDir);
    if (existing) {
        if (existing.accountId !== accountId) {
            throw new BrowserIdentityError(
                'IDENTITY_ACCOUNT_MISMATCH',
                `${identityFilePath(sessionDir)} appartiene al profilo «${existing.accountId}», lancio per «${accountId}»: ` +
                    `un file copiato fra sessionDir darebbe lo stesso device a due account`,
            );
        }
        validateBrowserIdentity(existing, ctx);
        return existing;
    }
    if (profileHasCookies(sessionDir)) {
        throw new BrowserIdentityError(
            'IDENTITY_MISSING_ON_AUTHENTICATED_PROFILE',
            `${sessionDir} ha già un cookie jar ma nessun ${IDENTITY_FILE_NAME}: LinkedIn ha già visto un dispositivo su questo profilo`,
        );
    }
    return createBrowserIdentity(sessionDir, accountId, ctx, await generate(), options);
}
