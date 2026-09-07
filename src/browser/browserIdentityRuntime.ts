/**
 * browserIdentityRuntime.ts — cablaggio IMPURO dell'identità persistita (C23 del contratto `bot-operativo`).
 *
 * `browserIdentity.ts` è la regola (pura); qui c'è ciò che tocca il mondo: la config, il binario installato,
 * browserforge (via camoufox-js) e il pool. È l'unico punto in cui un'identità NASCE:
 *  - engine `camoufox` → fingerprint browserforge (è l'oggetto che Camoufox applica nativamente, `utils.js:358`),
 *    generato con l'`os` dell'host e la finestra reale, poi riscritto al major del binario ESATTAMENTE come farà
 *    camoufox-js al lancio (`fingerprints.js:_castToProperties`), così file e pagina coincidono;
 *  - engine `chromium`/`firefox` → pool deterministico (C12), UA riscritta al major del binario Playwright
 *    (`playwright-core/browsers.json`): una UA Chrome/131 su Chromium 145 è incoerente coi Client Hints reali.
 * Il seme (`accountId`) resta quello di `fingerprint/seedRuntime.ts`; il file lo registra e lo congela.
 */
import crypto from 'node:crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import { config } from '../config';
import { profiloIdDellaSessione } from '../fingerprint/seedRuntime';
import { defaultCamoufoxCacheDir, readInstalledCamoufoxVersion } from './camoufoxRuntime';
import { type CloudFingerprint, isUaTlsCoherentWithEngine, pickDesktopFingerprint, pickMobileFingerprint } from './stealth';
import {
    type GeneratedIdentity,
    type IdentityContext,
    type IdentityEngine,
    type IdentityOs,
    type PersistedBrowserIdentity,
    engineBuildMajor,
    ensureBrowserIdentity,
    hostIdentityOs,
    rewriteVersionStrings,
} from './browserIdentity';

/** Build Playwright degli engine non-Camoufox: la stessa che `npx playwright install` scarica. */
function playwrightBrowserVersion(name: 'chromium' | 'firefox'): string {
    const file = require.resolve('playwright-core/browsers.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { browsers: Array<{ name: string; browserVersion?: string }> };
    const entry = parsed.browsers.find((browser) => browser.name === name);
    if (!entry?.browserVersion) throw new Error(`[IDENTITY] build Playwright di ${name} non trovata in ${file}`);
    return entry.browserVersion;
}

/** Il binario contro cui l'identità è (e resta) valida: Camoufox `version.json` (C22) o la build Playwright. */
export function resolveEngineBuild(engine: IdentityEngine): string {
    if (engine === 'camoufox') {
        const installed = readInstalledCamoufoxVersion(defaultCamoufoxCacheDir());
        if (!installed) {
            throw new Error(
                '[IDENTITY] binario Camoufox non installato (nessun version.json): esegui .\\bot.ps1 camoufox-fetch prima di creare l\'identità',
            );
        }
        return installed;
    }
    return playwrightBrowserVersion(engine);
}

/**
 * Finestra con cui l'identità NASCE: Camoufox ne deriva screen/outer size (`fingerprints.js:handleWindowSize`) e
 * la riapplica a ogni lancio. Headless = il viewport headless del launcher; altrimenti la WorkingArea reale.
 */
export function identityWindow(headless: boolean): [number, number] {
    if (headless) return [1920, 1080];
    if (process.platform === 'win32') {
        try {
            const out = execSync(
                'powershell -NoProfile -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea | Format-List Width,Height"',
                { encoding: 'utf8', timeout: 5000 },
            );
            const width = out.match(/Width\s*:\s*(\d+)/);
            const height = out.match(/Height\s*:\s*(\d+)/);
            if (width && height) return [parseInt(width[1], 10), parseInt(height[1], 10)];
        } catch (error) {
            console.warn('[IDENTITY] WorkingArea non leggibile, finestra di fallback 1366x768:', error instanceof Error ? error.message : String(error));
        }
    }
    return [1366, 768];
}

function languagesFor(locale: string): string[] {
    return [locale, locale.split('-')[0] ?? 'it', 'en-US', 'en'];
}

/** Hardware coerente con la classe del device, derivato dall'id: la regola che il launcher applicava a ogni lancio. */
function deriveCoherentHardware(fingerprintId: string, isMobile: boolean): Pick<GeneratedIdentity, 'hardwareConcurrency' | 'deviceMemory' | 'colorDepth'> {
    const fpHash = fingerprintId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) >>> 0;
    const hwOptions = isMobile ? [4, 6, 8] : [4, 8, 12, 16];
    const memOptions = isMobile ? [2, 3, 4, 6] : [4, 8, 16];
    return {
        hardwareConcurrency: hwOptions[fpHash % hwOptions.length],
        deviceMemory: memOptions[(fpHash >> 4) % memOptions.length],
        colorDepth: isMobile ? 32 : 24,
    };
}

interface BrowserforgeShape {
    navigator?: { userAgent?: unknown; hardwareConcurrency?: unknown };
    screen?: { width?: unknown; height?: unknown; colorDepth?: unknown };
}

async function generateCamoufoxIdentity(os: IdentityOs, major: number, headless: boolean): Promise<GeneratedIdentity> {
    const { generateFingerprint } = await import('camoufox-js/dist/fingerprints.js');
    const raw: unknown = generateFingerprint(identityWindow(headless), { operatingSystems: [os] });
    const bf = rewriteVersionStrings(raw, major) as BrowserforgeShape;
    const userAgent = bf.navigator?.userAgent;
    const hardwareConcurrency = bf.navigator?.hardwareConcurrency;
    const width = bf.screen?.width;
    const height = bf.screen?.height;
    const colorDepth = bf.screen?.colorDepth;
    if (
        typeof userAgent !== 'string' ||
        typeof hardwareConcurrency !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        typeof colorDepth !== 'number'
    ) {
        throw new Error('[IDENTITY] browserforge ha restituito un fingerprint senza navigator/screen attesi');
    }
    const locale = config.browserLocale;
    return {
        fingerprintId: `browserforge:${crypto.createHash('sha256').update(JSON.stringify(bf)).digest('hex').slice(0, 16)}`,
        userAgent,
        locale,
        languages: languagesFor(locale),
        timezone: undefined, // Camoufox la deriva dal geoip del proxy (launcher.ts, H30+GAP7)
        viewport: { width, height },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        hardwareConcurrency,
        deviceMemory: null, // Firefox non espone navigator.deviceMemory
        colorDepth,
        ja3: config.ja3Fingerprint,
        browserforge: bf,
    };
}

function generatePoolIdentity(seme: string, isMobile: boolean, major: number, cloud: ReadonlyArray<CloudFingerprint>): GeneratedIdentity {
    const fp = isMobile ? pickMobileFingerprint(cloud, seme) : pickDesktopFingerprint(cloud, seme);
    const mobile = fp.isMobile === true;
    const locale = fp.locale ?? config.browserLocale;
    return {
        fingerprintId: fp.id,
        userAgent: rewriteVersionStrings(fp.userAgent, major),
        locale,
        languages: languagesFor(locale),
        timezone: fp.timezone ?? config.timezone,
        viewport: { ...fp.viewport },
        isMobile: mobile,
        hasTouch: fp.hasTouch === true || mobile,
        deviceScaleFactor: fp.deviceScaleFactor ?? (mobile ? 2.5 : 1),
        ...deriveCoherentHardware(fp.id, mobile),
        ja3: fp.ja3,
        browserforge: null,
    };
}

export function identityContextFromConfig(): IdentityContext {
    const engine = config.browserEngine;
    return { engine, engineBuild: resolveEngineBuild(engine), hostOs: hostIdentityOs(), isUaCoherentWithEngine: isUaTlsCoherentWithEngine };
}

export interface LaunchIdentityParams {
    sessionDir: string;
    /**
     * Id del profilo se il chiamante lo conosce; altrimenti si risolve dalla sessionDir configurata
     * (`profiloIdDellaSessione`) e, per i profili che la config non conosce, ricade sul seme. È ciò che il file
     * registra come `accountId` e che ogni lancio valida (`IDENTITY_ACCOUNT_MISMATCH`).
     */
    accountId?: string;
    /** Il seme già congelato da `congelaSemeFingerprint`: decide SOLO quale voce del pool alla creazione. */
    poolSeed: string;
    /** Solo per il pool (Camoufox è desktop: ignorato su quell'engine). */
    isMobile: boolean;
    headless: boolean;
    /** Chiamato SOLO se un'identità va creata su un engine da pool: su Camoufox non serve rete. */
    loadCloudFingerprints: () => Promise<ReadonlyArray<CloudFingerprint>>;
}

/** Legge (e valida) o crea l'identità del profilo: la guardia che nel launcher precede OGNI `launch`. */
export async function ensureLaunchIdentity(params: LaunchIdentityParams): Promise<PersistedBrowserIdentity> {
    const ctx = identityContextFromConfig();
    const major = engineBuildMajor(ctx.engineBuild);
    if (major === null) throw new Error(`[IDENTITY] build «${ctx.engineBuild}» senza major leggibile`);
    const accountId = profiloIdDellaSessione(params.sessionDir, params.accountId) ?? params.poolSeed;
    return ensureBrowserIdentity(params.sessionDir, accountId, ctx, async () =>
        ctx.engine === 'camoufox'
            ? generateCamoufoxIdentity(ctx.hostOs, major, params.headless)
            : generatePoolIdentity(params.poolSeed, params.isMobile, major, await params.loadCloudFingerprints()),
    );
}
