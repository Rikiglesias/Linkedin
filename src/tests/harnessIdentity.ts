/**
 * harnessIdentity.ts — identità del browser su Camoufox VERO, pagina locale, zero LinkedIn.
 *
 * C28: Camoufox parte, pagina locale servita e contata, egress negato, navigator.userAgent = header User-Agent.
 * C23: TRE lanci dal PATH DI PRODUZIONE (`launchBrowser` → `.fingerprint.json` + guardie + Camoufox dal file) sulla
 * stessa sessionDir isolata: ciò che la pagina vede è identico nei 3 lanci e uguale al file, che non cambia di un
 * byte; CONTROL-CASE con altro `fontsSpacingSeed` in cartella a parte → metriche font DIVERSE.
 * C24: UNA sola identità per pagina (nessuna proprietà propria, API che Firefox non ha assenti, funzioni `[native
 * code]`, larghezze ripetibili, tz stabile, languages = Accept-Language, finestra ≤ screen ≤ monitor); CONTROL-CASE
 * os=linux (`harnessIdentityControls.ts`): «Segoe UI» ricade sul fallback come su un vero linux.
 * NB: `document.fonts.check()` è true per OGNI famiglia senza FontFace da caricare (spec FontFaceSet, misurato
 * 2026-09-07 anche su linux) → la disponibilità di un font si misura con le larghezze, mai con check().
 *
 * Uso:  npm run harness:identity   (= npx ts-node src/tests/harnessIdentity.ts)
 * Exit: 0 = misure nell'atteso, 1 = almeno una fuori atteso, 2 = sonda rotta (vedi harnessRuntime).
 */

// Il runtime va importato per PRIMO: isola env/sessionDir/DB prima che `src/config` venga caricato (C28).
import { runHarness } from './harnessRuntime';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import { FONTS_SPACING_SEED_MAX, IDENTITY_FILE_NAME, readBrowserIdentity } from '../browser/browserIdentity';
import { hostScreenGeometry } from '../browser/browserIdentityRuntime';
import { closeBrowser, launchBrowser } from '../browser/launcher';
import { config } from '../config';
import { type Egress, denyEgress, linuxControlSnapshot } from './harnessIdentityControls';
import { type Snapshot, snapshotPage } from './harnessIdentitySnapshot';

type Measure = { name: string; got: unknown; expected: string; ok: boolean };

const FIXTURE = '<!doctype html><title>identity</title><body><p id="t">identità</p></body>';

/** Lancio DI PRODUZIONE sulla sessionDir data, con lo stesso divieto di egress del runtime C28. */
async function productionLaunch(sessionDir: string, egress: Egress, accountId?: string): Promise<{ page: Page; close(): Promise<void> }> {
    const session = await launchBrowser({ sessionDir, accountId, headless: true, bypassProxy: true, allowDirectIp: true, forceDesktop: true });
    await denyEgress(session.browser, session.page, egress);
    return { page: session.page, close: () => closeBrowser(session) };
}

function platformCoherentWithOs(snapshot: Snapshot, identityOs: string): boolean {
    if (identityOs === 'windows') return snapshot.platform === 'Win32' && (snapshot.oscpu ?? '').startsWith('Windows');
    if (identityOs === 'macos') return snapshot.platform === 'MacIntel';
    return snapshot.platform.startsWith('Linux');
}

function firstLanguageTag(acceptLanguage: string | undefined): string {
    return (acceptLanguage ?? '').split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
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
        const acceptLanguageHeaders: string[] = [];
        let fileAfterFirst: Buffer | null = null;

        for (let launch = 0; launch < 3; launch++) {
            const launched = await productionLaunch(sessionDir, egress);
            try {
                await launched.page.goto(run.echoHeadersUrl());
                const headers = JSON.parse(await launched.page.locator('body').innerText()) as Record<string, string | undefined>;
                uaHeaders.push(headers['user-agent'] ?? '');
                acceptLanguageHeaders.push(headers['accept-language'] ?? '');
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

        // C24 control-case: profilo di prova os=linux, isolato.
        const linux = await linuxControlSnapshot(fixtureUrl, egress);

        const [first] = snapshots;
        const geometry = hostScreenGeometry(true);
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
                name: 'languages[0] = locale del file = primo tag di Accept-Language (C24: una sola lingua per pagina)',
                got: { languages: first.languages, file: identity.locale, acceptLanguage: acceptLanguageHeaders },
                expected: `«${identity.locale}» in testa e nell'header`,
                ok: first.languages[0] === identity.locale && acceptLanguageHeaders.every((h) => firstLanguageTag(h) === identity.locale.toLowerCase()),
            },
            {
                name: 'platform/oscpu coerenti con os del file; finestra e screen frizzati (identici nei 3 lanci)',
                got: { platform: first.platform, oscpu: first.oscpu, outer: first.outer, inner: first.inner, screen: first.screen, os: identity.os },
                expected: 'platform della piattaforma dichiarata; outer/screen positivi e stabili',
                ok: platformCoherentWithOs(first, identity.os) && first.outer.width > 0 && first.outer.height > 0 && same((s) => s.outer),
            },
            {
                name: 'C24: finestra ≤ screen ≤ monitor (headless: 1920x1080) e inner ≤ outer ≤ screen',
                got: { screen: first.screen, outer: first.outer, inner: first.inner, geometry },
                expected: `screen fra ${geometry.window.join('x')} e ${geometry.monitor.join('x')}; inner ≤ outer ≤ screen`,
                ok:
                    first.screen.width >= geometry.window[0] &&
                    first.screen.height >= geometry.window[1] &&
                    first.screen.width <= geometry.monitor[0] &&
                    first.screen.height <= geometry.monitor[1] &&
                    first.inner.width <= first.outer.width &&
                    first.inner.height <= first.outer.height &&
                    first.outer.width <= first.screen.width &&
                    first.outer.height <= first.screen.height,
            },
            {
                name: 'C24: nessuna proprietà PROPRIA su navigator/screen (lo script non ha definito nulla di nativo)',
                got: first.ownProps,
                expected: '{ navigator: [], screen: [] }',
                ok: first.ownProps.navigator.length === 0 && first.ownProps.screen.length === 0,
            },
            {
                name: 'C24: navigator.deviceMemory e performance.memory assenti (Firefox non le espone)',
                got: { deviceMemory: first.deviceMemory, performanceMemory: first.performanceMemory },
                expected: 'entrambi undefined',
                ok: first.deviceMemory === undefined && first.performanceMemory === undefined,
            },
            {
                name: 'C24: fonts.check, measureText, permissions.query, getter webdriver e innerWidth sono [native code]',
                got: first.natives,
                expected: 'tutti true',
                ok: Object.values(first.natives).every(Boolean),
            },
            {
                name: 'C24: stessa stringa misurata 2× nella pagina → larghezza identica (nessun noise JS su measureText)',
                got: snapshots.map((s) => s.repeatedWidthsEqual),
                expected: 'true nei 3 lanci',
                ok: snapshots.every((s) => s.repeatedWidthsEqual),
            },
            {
                name: 'C24: ciò che le sezioni saltate coprivano resta vero NATIVAMENTE (webdriver false, Notification default, notifications prompt)',
                got: { webdriver: first.webdriver, notificationPermission: first.notificationPermission, notificationsQueryState: first.notificationsQueryState },
                expected: 'false / default / prompt',
                ok: first.webdriver === false && first.notificationPermission === 'default' && first.notificationsQueryState === 'prompt',
            },
            {
                name: 'C24: timezone non vuota e identica nei 3 lanci',
                got: snapshots.map((s) => s.timeZone),
                expected: 'tre stringhe uguali, non vuote',
                ok: first.timeZone.length > 0 && same((s) => s.timeZone),
            },
            {
                name: 'C24 (spec): fonts.check è true anche per una famiglia inesistente; sul profilo windows «Segoe UI» è DISPONIBILE (larghezza ≠ fallback)',
                got: { fontsCheckUnknownFamily: first.fontsCheckUnknownFamily, fontProbe: first.fontProbe },
                expected: 'check true; segoeMono ≠ mono e segoeSans ≠ sans',
                ok: first.fontsCheckUnknownFamily === true && first.fontProbe.segoeMono !== first.fontProbe.mono && first.fontProbe.segoeSans !== first.fontProbe.sans,
            },
            {
                name: 'C24 control-case os=linux (Camoufox + stesso script del launcher): «Segoe UI» ricade sul fallback, platform Linux, zero proprietà proprie, funzioni native',
                got: { fontProbe: linux.fontProbe, platform: linux.platform, ownProps: linux.ownProps, natives: linux.natives },
                expected: 'segoeMono = mono e segoeSans = sans; platform Linux…; ownProps vuote; natives tutti true',
                ok:
                    linux.fontProbe.segoeMono === linux.fontProbe.mono &&
                    linux.fontProbe.segoeSans === linux.fontProbe.sans &&
                    linux.platform.startsWith('Linux') &&
                    linux.ownProps.navigator.length === 0 &&
                    linux.ownProps.screen.length === 0 &&
                    Object.values(linux.natives).every(Boolean),
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
                name: 'egress dai lanci di produzione e dai control-case = 0 (bloccate 0, esterne completate 0)',
                got: egress,
                expected: '{ blocked: 0, external: 0 }',
                ok: egress.blocked === 0 && egress.external === 0,
            },
        ];

        console.log('\n=== IDENTITÀ — Camoufox vero dal path di produzione, 3 lanci + 2 control (seme font, os=linux), pagina locale, egress negato ===\n');
        console.log(`file: ${JSON.stringify({ engine: identity.engine, engineBuild: identity.engineBuild, os: identity.os, seed: identity.fontsSpacingSeed, viewport: identity.viewport })}\n`);
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
