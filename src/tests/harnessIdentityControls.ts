/**
 * harnessIdentityControls.ts — i lanci di CONTROLLO dell'harness identità (C23/C24), fuori dal profilo sotto misura.
 *
 *  - `denyEgress`: lo stesso divieto di rete del runtime C28 applicato a un context lanciato dall'harness;
 *  - `linuxControlSnapshot` (C24): Camoufox `os: 'linux'` in cartella temporanea + LO STESSO init script che il
 *    launcher inietta su Camoufox (`buildStealthInitScript` con `CAMOUFOX_NATIVE_SECTIONS`). Non passa da
 *    `launchBrowser`: C23 impone os = host sul path di produzione (IDENTITY_OS_MISMATCH, voluto). Misura il binario
 *    + lo script su un os diverso dall'host: «Segoe UI» deve ricadere sul fallback come su un vero linux.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BrowserContext, Page, Route } from 'playwright';
import { hostScreenGeometry } from '../browser/browserIdentityRuntime';
import { assertCamoufoxRuntimePinned } from '../browser/camoufoxRuntime';
import { CAMOUFOX_NATIVE_SECTIONS, buildStealthInitScript } from '../browser/stealthScripts';
import { config } from '../config';
import { type Snapshot, snapshotPage } from './harnessIdentitySnapshot';
import { isLocalRequestUrl } from './harnessRuntime';

export interface Egress {
    blocked: number;
    external: number;
}

export function denyEgress(context: BrowserContext, page: Page, egress: Egress): Promise<void> {
    page.on('requestfinished', (req) => {
        if (!isLocalRequestUrl(req.url())) egress.external++;
    });
    return context.route('**/*', (route: Route) => {
        if (isLocalRequestUrl(route.request().url())) return route.continue();
        egress.blocked++;
        return route.abort('blockedbyclient');
    });
}

export async function linuxControlSnapshot(fixtureUrl: string, egress: Egress): Promise<Snapshot> {
    assertCamoufoxRuntimePinned({ pinned: config.camoufoxBinaryVersion });
    const { Camoufox } = await import('camoufox-js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-linux-control-'));
    const context = (await Camoufox({
        user_data_dir: dir,
        os: 'linux',
        headless: true,
        humanize: false,
        geoip: false,
        block_webrtc: true,
        window: hostScreenGeometry(true).window,
        firefox_user_prefs: { 'dom.webdriver.enabled': false },
    })) as BrowserContext;
    try {
        const page = context.pages()[0] ?? (await context.newPage());
        await denyEgress(context, page, egress);
        const userAgent = await page.evaluate(() => navigator.userAgent);
        await context.addInitScript({
            content: buildStealthInitScript({
                locale: config.browserLocale,
                languages: [config.browserLocale],
                isHeadless: true,
                viewportWidth: 1920,
                viewportHeight: 1080,
                userAgent,
                skipSections: new Set(CAMOUFOX_NATIVE_SECTIONS),
            }),
        });
        await page.goto(fixtureUrl);
        return await snapshotPage(page);
    } finally {
        await context.close().catch(() => undefined);
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        } catch (error) {
            console.warn('[HARNESS] cartella del control-case linux non rimossa (innocuo):', error instanceof Error ? error.message : String(error));
        }
    }
}
