/**
 * harnessIdentity.ts — identità del browser su Camoufox VERO, pagina locale, zero LinkedIn.
 *
 * C28 (base): Camoufox parte, la pagina locale è servita e contata, l'egress è negato; navigator.userAgent e
 * l'header `User-Agent` ricevuto dal server coincidono (due identità per pagina = rilevabile).
 * C23: TRE lanci DAL PATH DI PRODUZIONE (`launchBrowser`, quindi `.fingerprint.json` + guardie + Camoufox con
 * `fingerprint`/`os`/`fonts:spacing_seed` dal file) sulla STESSA sessionDir isolata: ciò che la pagina vede
 * (navigator, screen, finestra, metriche font) deve essere identico nei 3 lanci e uguale al file; il file non
 * cambia di un byte. CONTROL-CASE: una copia dell'identità con un altro `fontsSpacingSeed` in una cartella a
 * parte deve dare metriche font DIVERSE, altrimenti «il seme viene applicato» non sarebbe misurato.
 *
 * Uso:  npm run harness:identity   (= npx ts-node src/tests/harnessIdentity.ts)
 * Exit: 0 = misure nell'atteso, 1 = almeno una fuori atteso, 2 = sonda rotta (vedi harnessRuntime).
 */

// Il runtime va importato per PRIMO: isola env/sessionDir/DB prima che `src/config` venga caricato (C28).
import { isLocalRequestUrl, runHarness } from './harnessRuntime';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Page, Route } from 'playwright';
import { FONTS_SPACING_SEED_MAX, IDENTITY_FILE_NAME, readBrowserIdentity } from '../browser/browserIdentity';
import { identityWindow } from '../browser/browserIdentityRuntime';
import { closeBrowser, launchBrowser } from '../browser/launcher';
import { config } from '../config';

type Measure = { name: string; got: unknown; expected: string; ok: boolean };

interface Snapshot {
    userAgent: string;
    platform: string;
    oscpu: string | undefined;
    hardwareConcurrency: number;
    languages: readonly string[];
    screen: { width: number; height: number; colorDepth: number };
    outer: { width: number; height: number };
    /** Larghezze di testo (canvas + layout) per 4 font × 2 stringhe: la traccia del seme font. */
    fontWidths: number[];
}

const FIXTURE = '<!doctype html><title>identity</title><body><p id="t">identità</p></body>';
const FONTS = ['16px Arial', '16px "Times New Roman"', '16px "Courier New"', '14px Verdana'];
const TEXTS = ['The quick brown fox jumps over the lazy dog', 'mmmmmmmmmm iiiiiiiiii 0123456789'];

async function snapshotPage(page: Page): Promise<Snapshot> {
    return page.evaluate<Snapshot, { fonts: string[]; texts: string[] }>(
        ({ fonts, texts }) => {
            const widths: number[] = [];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            for (const font of fonts) {
                for (const text of texts) {
                    if (ctx) {
                        ctx.font = font;
                        widths.push(ctx.measureText(text).width);
                    }
                    const span = document.createElement('span');
                    span.style.font = font;
                    span.style.whiteSpace = 'pre';
                    span.textContent = text;
                    document.body.appendChild(span);
                    widths.push(span.getBoundingClientRect().width);
                    span.remove();
                }
            }
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                oscpu: (navigator as Navigator & { oscpu?: string }).oscpu,
                hardwareConcurrency: navigator.hardwareConcurrency,
                languages: navigator.languages,
                screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
                outer: { width: window.outerWidth, height: window.outerHeight },
                fontWidths: widths,
            };
        },
        { fonts: FONTS, texts: TEXTS },
    );
}

interface Egress {
    blocked: number;
    external: number;
}

/** Lancio DI PRODUZIONE sulla sessionDir data, con lo stesso divieto di egress del runtime C28. */
async function productionLaunch(sessionDir: string, egress: Egress, accountId?: string): Promise<{ page: Page; close(): Promise<void> }> {
    const session = await launchBrowser({ sessionDir, accountId, headless: true, bypassProxy: true, allowDirectIp: true, forceDesktop: true });
    await session.browser.route('**/*', (route: Route) => {
        if (isLocalRequestUrl(route.request().url())) return route.continue();
        egress.blocked++;
        return route.abort('blockedbyclient');
    });
    session.page.on('requestfinished', (req) => {
        if (!isLocalRequestUrl(req.url())) egress.external++;
    });
    return { page: session.page, close: () => closeBrowser(session) };
}

function platformCoherentWithOs(snapshot: Snapshot, identityOs: string): boolean {
    if (identityOs === 'windows') return snapshot.platform === 'Win32' && (snapshot.oscpu ?? '').startsWith('Windows');
    if (identityOs === 'macos') return snapshot.platform === 'MacIntel';
    return snapshot.platform.startsWith('Linux');
}

async function main(): Promise<void> {
    await runHarness('identity', 'camoufox', async (run) => {
        const sessionDir = path.resolve(config.sessionDir);
        if (!sessionDir.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase())) {
            throw new Error(`sessionDir non isolata: ${sessionDir} (il runtime deve dirottarla sotto tmpdir)`);
        }
        const egress: Egress = { blocked: 0, external: 0 };
        const fixtureUrl = run.serve(FIXTURE);
        const snapshots: Snapshot[] = [];
        const uaHeaders: string[] = [];
        let fileAfterFirst: Buffer | null = null;

        for (let launch = 0; launch < 3; launch++) {
            const launched = await productionLaunch(sessionDir, egress);
            try {
                await launched.page.goto(run.echoHeadersUrl());
                const headers = JSON.parse(await launched.page.locator('body').innerText()) as Record<string, string | undefined>;
                uaHeaders.push(headers['user-agent'] ?? '');
                await launched.page.goto(fixtureUrl);
                snapshots.push(await snapshotPage(launched.page));
            } finally {
                await launched.close();
            }
            if (launch === 0) fileAfterFirst = fs.readFileSync(path.join(sessionDir, IDENTITY_FILE_NAME));
        }
        const fileAfterThird = fs.readFileSync(path.join(sessionDir, IDENTITY_FILE_NAME));
        const identity = readBrowserIdentity(sessionDir);
        if (!identity) throw new Error('identità assente dopo 3 lanci di produzione');

        // control-case: stessa identità, altro seme font, cartella a parte (mai sul profilo sotto misura).
        const controlDir = `${sessionDir}-control`;
        fs.mkdirSync(controlDir, { recursive: true });
        const controlSeed = (identity.fontsSpacingSeed + 123_456_789) % FONTS_SPACING_SEED_MAX;
        fs.writeFileSync(path.join(controlDir, IDENTITY_FILE_NAME), `${JSON.stringify({ ...identity, fontsSpacingSeed: controlSeed }, null, 2)}\n`, 'utf8');
        // C52: la cartella di controllo non è un profilo configurato → si dichiara l'account, altrimenti il file copiato
        // (accountId «default») verrebbe rifiutato come identità di un altro profilo (IDENTITY_ACCOUNT_MISMATCH: voluto).
        const control = await productionLaunch(controlDir, egress, identity.accountId);
        let controlSnapshot: Snapshot;
        try {
            await control.page.goto(fixtureUrl);
            controlSnapshot = await snapshotPage(control.page);
        } finally {
            await control.close();
        }

        const [first] = snapshots;
        const same = (pick: (s: Snapshot) => unknown): boolean => snapshots.every((s) => JSON.stringify(pick(s)) === JSON.stringify(pick(first)));
        const measures: Measure[] = [
            {
                name: '3 lanci di produzione → navigator/screen/finestra/metriche font IDENTICI',
                got: snapshots.map((s) => ({ ua: s.userAgent, hw: s.hardwareConcurrency, screen: s.screen, outer: s.outer, fontWidths: s.fontWidths })),
                expected: 'tre snapshot uguali byte a byte',
                ok: same((s) => s),
            },
            {
                name: 'navigator.userAgent = header User-Agent = userAgent del file, in ogni lancio',
                got: { uaJs: snapshots.map((s) => s.userAgent), uaHeader: uaHeaders, file: identity.userAgent },
                expected: 'tre stringhe identiche per lancio, uguali al file',
                ok: snapshots.every((s, i) => s.userAgent === uaHeaders[i] && s.userAgent === identity.userAgent && s.userAgent.length > 0),
            },
            {
                name: 'hardwareConcurrency, screen e colorDepth = file',
                got: { hw: first.hardwareConcurrency, screen: first.screen, file: { hw: identity.hardwareConcurrency, viewport: identity.viewport, colorDepth: identity.colorDepth } },
                expected: 'valori del file',
                ok:
                    first.hardwareConcurrency === identity.hardwareConcurrency &&
                    first.screen.width === identity.viewport.width &&
                    first.screen.height === identity.viewport.height &&
                    first.screen.colorDepth === identity.colorDepth,
            },
            {
                name: 'languages[0] = locale del file',
                got: { languages: first.languages, file: identity.locale },
                expected: `«${identity.locale}» in testa`,
                ok: first.languages[0] === identity.locale,
            },
            {
                name: 'platform/oscpu coerenti con os del file; finestra e screen frizzati (identici nei 3 lanci)',
                got: { platform: first.platform, oscpu: first.oscpu, outer: first.outer, screen: first.screen, os: identity.os, window: identityWindow(true) },
                // Con un `fingerprint` custom camoufox-js ignora `window` (entra solo in generateFingerprint) e la
                // finestra riportata viene dai dati screen di browserforge (misurato: 1920x1165 e 2752x1237 su due
                // identità diverse): NON è «= identityWindow». Ciò che deve reggere: piattaforma dell'host e
                // finestra/screen identici a ogni lancio (misura 1). Il vincolo screen ≤ monitor reale è tracciato
                // per C24 (`improvements-proposed.md`).
                expected: 'platform della piattaforma dichiarata; outer/screen positivi e stabili',
                ok: platformCoherentWithOs(first, identity.os) && first.outer.width > 0 && first.outer.height > 0 && same((s) => s.outer),
            },
            {
                name: 'control-case: altro fontsSpacingSeed → metriche font DIVERSE (il seme del file è applicato)',
                got: { profilo: first.fontWidths, control: controlSnapshot.fontWidths, seeds: [identity.fontsSpacingSeed, controlSeed] },
                expected: 'almeno una larghezza diversa',
                ok: JSON.stringify(controlSnapshot.fontWidths) !== JSON.stringify(first.fontWidths),
            },
            {
                name: 'control-case: tutto il resto identico (cambia SOLO il seme)',
                got: { ua: controlSnapshot.userAgent === first.userAgent, screen: controlSnapshot.screen, hw: controlSnapshot.hardwareConcurrency },
                expected: 'userAgent/screen/hardwareConcurrency uguali al profilo',
                ok: controlSnapshot.userAgent === first.userAgent && JSON.stringify(controlSnapshot.screen) === JSON.stringify(first.screen) && controlSnapshot.hardwareConcurrency === first.hardwareConcurrency,
            },
            {
                name: '.fingerprint.json scritto UNA volta (byte-identico dopo il 1° e il 3° lancio)',
                got: { bytes: fileAfterThird.length, createdAt: identity.createdAt },
                expected: 'stesso contenuto',
                ok: fileAfterFirst !== null && Buffer.compare(fileAfterFirst, fileAfterThird) === 0,
            },
            {
                name: 'egress dai lanci di produzione = 0 (bloccate 0, esterne completate 0)',
                got: egress,
                expected: '{ blocked: 0, external: 0 }',
                ok: egress.blocked === 0 && egress.external === 0,
            },
        ];

        console.log('\n=== IDENTITÀ — Camoufox vero dal path di produzione, 3 lanci + control, pagina locale, egress negato ===\n');
        console.log(`file: ${JSON.stringify({ engine: identity.engine, engineBuild: identity.engineBuild, os: identity.os, seed: identity.fontsSpacingSeed })}\n`);
        let failed = 0;
        for (const m of measures) {
            if (!m.ok) failed++;
            console.log(`[${m.ok ? 'OK  ' : 'FAIL'}] ${m.name}`);
            console.log(`       atteso  : ${m.expected}`);
            console.log(`       misurato: ${JSON.stringify(m.got)}\n`);
        }
        console.log(failed === 0 ? 'Tutte le misure nell atteso.' : `${failed} misure fuori atteso.`);
        return failed;
    });
}

void main();
