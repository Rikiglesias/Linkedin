/**
 * C24 (contratto `bot-operativo`, blocco A) — UNA sola identità per pagina su Camoufox.
 *
 * Camoufox applica il fingerprint a livello C++ (prototipi nativi). Ogni `Object.defineProperty(navigator, …)`
 * dell'init script crea invece una proprietà PROPRIA sull'istanza (`Object.getOwnPropertyNames(navigator)` ≠ []) o
 * sostituisce un getter nativo con una funzione JS (`toString()` senza `[native code]`): due identità sulla stessa
 * pagina, rilevabili con una riga di JS. Regola: su Camoufox lo script NON definisce nulla che il binario fornisce
 * già; il registro di ciò che è nativo è `CAMOUFOX_NATIVE_SECTIONS` (esportato da `stealthScripts.ts`, non più
 * privato del launcher) e ogni voce DEVE avere la sua guardia `_skip.has('<voce>')` nello script.
 *
 * Tre livelli di prova:
 *  1. il set (contratto: `fonts`, `devicememory`, `perfmemory`; superset dichiarato in binding);
 *  2. il sorgente: ogni voce del set ha la guardia; il launcher importa il set e non lo ridefinisce;
 *  3. il comportamento: lo script eseguito su una pagina simulata NON tocca navigator/screen/window/document/
 *     performance con il set di Camoufox, e li tocca (stessa pagina, set vuoto, UA Chrome) sul path Chromium —
 *     così la guardia è il ramo che decide, non «mai» né «sempre» (browser-antiban.md regola 10).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { CAMOUFOX_NATIVE_SECTIONS, buildStealthInitScript } from '../browser/stealthScripts';
import { type ScreenConstraint, assertScreenContainsWindow, generateBrowserforgeWithinHost } from '../browser/browserIdentityRuntime';

const SRC = path.resolve(__dirname, '..');
const stealthSource = fs.readFileSync(path.join(SRC, 'browser', 'stealthScripts.ts'), 'utf8');
const launcherSource = fs.readFileSync(path.join(SRC, 'browser', 'launcher.ts'), 'utf8');

const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/** Le voci che il contratto C24 esige nel set. */
const CONTRACT_SECTIONS = ['fonts', 'devicememory', 'perfmemory'];
/** Le voci aggiunte oltre il contratto (stesso principio: proprietà che Camoufox fornisce nativamente). */
const SUPERSET_SECTIONS = ['window', 'colordepth', 'platform', 'languages', 'language', 'webdriver', 'permissions'];

type Descriptor = PropertyDescriptor | undefined;
const isData = (d: Descriptor): boolean => d !== undefined && 'value' in d && d.get === undefined;
const isAccessor = (d: Descriptor): boolean => d !== undefined && typeof d.get === 'function';

/** Pagina simulata: solo ciò che lo script tocca; i «nativi» sono funzioni distinte per riconoscerne la sostituzione. */
function pagina() {
    const natives = {
        fontsCheck: function check(): boolean {
            return false;
        },
        measureText: function measureText(): { width: number } {
            return { width: 1 };
        },
        permissionsQuery: function query(): Promise<{ state: string }> {
            return Promise.resolve({ state: 'prompt' });
        },
        createElement: function createElement(): Record<string, unknown> {
            return { style: {}, remove() {} };
        },
    };
    const navigatorProto: Record<string, unknown> = { webdriver: false };
    const navigator: Record<string, unknown> = {
        languages: ['it-IT', 'it'],
        language: 'it-IT',
        hardwareConcurrency: 8,
        platform: 'Win32',
        oscpu: 'Windows NT 10.0; Win64; x64',
        userAgent: UA_FIREFOX,
        permissions: { query: natives.permissionsQuery },
        plugins: [],
    };
    Object.setPrototypeOf(navigator, navigatorProto);
    const screen: Record<string, unknown> = { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 };
    const window: Record<string, unknown> = {
        outerWidth: 1920,
        outerHeight: 1050,
        innerWidth: 1920,
        innerHeight: 950,
        screen,
        chrome: undefined,
        dispatchEvent: () => true,
        addEventListener: () => {},
    };
    const document: Record<string, unknown> = {
        fonts: { check: natives.fontsCheck },
        createElement: natives.createElement,
        documentElement: {},
        body: {},
        addEventListener: () => {},
    };
    const performance: Record<string, unknown> = {};
    const Notification: Record<string, unknown> = { permission: 'default' };
    const CanvasRenderingContext2D = { prototype: { measureText: natives.measureText } };
    return {
        natives,
        navigatorProto,
        globals: {
            window,
            navigator,
            screen,
            document,
            performance,
            Notification,
            CanvasRenderingContext2D,
            HTMLCanvasElement: { prototype: { getContext: () => null } },
            AudioBuffer: { prototype: { getChannelData: () => new Float32Array(0) } },
            // `Error` ombreggiato: la sezione 17 riscrive `Error.prepareStackTrace` e non deve toccare quello di Node.
            Error: {} as Record<string, unknown>,
        },
    };
}

function esegui(script: string, globals: Record<string, unknown>): void {
    const names = Object.keys(globals);
    const fn = new Function(...names, `"use strict"; ${script}`);
    fn(...names.map((n) => globals[n]));
}

const NAVIGATOR_PROPS = ['languages', 'language', 'platform', 'oscpu', 'hardwareConcurrency'];
const WINDOW_DIMS = ['outerWidth', 'outerHeight', 'innerWidth', 'innerHeight'];

describe('C24 — CAMOUFOX_NATIVE_SECTIONS: il registro di ciò che Camoufox fornisce nativamente', () => {
    it('contiene le 3 sezioni del contratto (fonts, devicememory, perfmemory)', () => {
        for (const key of CONTRACT_SECTIONS) expect(CAMOUFOX_NATIVE_SECTIONS.has(key), key).toBe(true);
    });

    it('contiene le sezioni del superset dichiarato (window, colordepth, platform, languages, language, webdriver, permissions)', () => {
        for (const key of SUPERSET_SECTIONS) expect(CAMOUFOX_NATIVE_SECTIONS.has(key), key).toBe(true);
    });

    it('conserva le 7 sezioni native già note (webrtc, plugins, hwconcurrency, audio, battery, canvas, webgl)', () => {
        for (const key of ['webrtc', 'plugins', 'hwconcurrency', 'audio', 'battery', 'canvas', 'webgl']) {
            expect(CAMOUFOX_NATIVE_SECTIONS.has(key), key).toBe(true);
        }
    });

    it('OGNI voce del set ha la sua guardia `_skip.has(<voce>)` nello script (canvas/webgl vivono nel launcher)', () => {
        for (const key of CAMOUFOX_NATIVE_SECTIONS) {
            if (key === 'canvas' || key === 'webgl') continue;
            expect(stealthSource, `guardia mancante per «${key}»`).toContain(`_skip.has('${key}')`);
        }
    });

    it('il launcher IMPORTA il set da stealthScripts (nessuna copia privata) e lo applica sul ramo Camoufox', () => {
        expect(launcherSource).not.toMatch(/const CAMOUFOX_NATIVE_SECTIONS\b/);
        expect(launcherSource).toMatch(/import \{[^}]*CAMOUFOX_NATIVE_SECTIONS[^}]*\} from '\.\/stealthScripts'/);
        expect(launcherSource).toContain('new Set(CAMOUFOX_NATIVE_SECTIONS)');
    });

    it('il launcher non inietta più `deviceMemory ?? 8`: il valore viene dal file (null su Firefox = niente sezione)', () => {
        expect(launcherSource).not.toContain('stealthInputs.deviceMemory ?? 8');
    });
});

describe('C24 — sul path Camoufox lo script NON definisce nulla di nativo (pagina simulata, set completo, UA Firefox)', () => {
    const p = pagina();
    const { navigator, screen, window, document, performance, Notification, CanvasRenderingContext2D } = p.globals;
    const ownBefore = Object.getOwnPropertyNames(navigator).sort();
    esegui(
        buildStealthInitScript({
            locale: 'it-IT',
            languages: ['it-IT', 'it', 'en-US', 'en'],
            isHeadless: true,
            viewportWidth: 1920,
            viewportHeight: 1080,
            userAgent: UA_FIREFOX,
            skipSections: new Set(CAMOUFOX_NATIVE_SECTIONS),
        }),
        p.globals,
    );

    it('navigator: nessuna proprietà propria nuova (deviceMemory, connection, webdriver, plugins, mimeTypes, getBattery)', () => {
        expect(Object.getOwnPropertyNames(navigator).sort()).toEqual(ownBefore);
        expect(navigator.deviceMemory).toBeUndefined();
        expect(navigator.connection).toBeUndefined();
    });

    it('navigator: languages/language/platform/oscpu/hardwareConcurrency restano proprietà dati intatte (nessun getter JS)', () => {
        for (const key of NAVIGATOR_PROPS) expect(isData(Object.getOwnPropertyDescriptor(navigator, key)), key).toBe(true);
        expect(isData(Object.getOwnPropertyDescriptor(p.navigatorProto, 'webdriver'))).toBe(true);
    });

    it('screen: colorDepth/pixelDepth intatti; window: le 4 dimensioni intatte (nessun mock headless)', () => {
        expect(isData(Object.getOwnPropertyDescriptor(screen, 'colorDepth'))).toBe(true);
        expect(isData(Object.getOwnPropertyDescriptor(screen, 'pixelDepth'))).toBe(true);
        for (const key of WINDOW_DIMS) expect(isData(Object.getOwnPropertyDescriptor(window, key)), key).toBe(true);
        expect(window.outerHeight).toBe(1050);
    });

    it('performance.memory assente; fonts.check, measureText, permissions.query e createElement sono ancora i nativi', () => {
        expect(Object.getOwnPropertyNames(performance)).toEqual([]);
        expect((document.fonts as { check: unknown }).check).toBe(p.natives.fontsCheck);
        expect(CanvasRenderingContext2D.prototype.measureText).toBe(p.natives.measureText);
        expect((navigator.permissions as { query: unknown }).query).toBe(p.natives.permissionsQuery);
        expect(document.createElement).toBe(p.natives.createElement);
        expect(isData(Object.getOwnPropertyDescriptor(Notification, 'permission'))).toBe(true);
        expect(window.chrome).toBeUndefined();
    });
});

describe('C24 — sul path Chromium (set vuoto, UA Chrome, headless) le stesse sezioni GIRANO: la guardia è il ramo che decide', () => {
    const p = pagina();
    const { navigator, screen, window, document, performance, Notification, CanvasRenderingContext2D } = p.globals;
    navigator.userAgent = UA_CHROME;
    esegui(
        buildStealthInitScript({
            locale: 'it-IT',
            languages: ['it-IT', 'it', 'en-US', 'en'],
            isHeadless: true,
            viewportWidth: 1600,
            viewportHeight: 900,
            deviceMemory: 16,
            colorDepth: 30,
            userAgent: UA_CHROME,
            skipSections: new Set<string>(),
        }),
        p.globals,
    );

    it('navigator riceve deviceMemory/connection/languages/platform via getter (come prima di C24)', () => {
        expect(navigator.deviceMemory).toBe(16);
        expect(navigator.connection).toBeDefined();
        expect(isAccessor(Object.getOwnPropertyDescriptor(navigator, 'languages'))).toBe(true);
        expect(navigator.languages).toEqual(['it-IT', 'it', 'en-US', 'en']);
        expect(isAccessor(Object.getOwnPropertyDescriptor(navigator, 'platform'))).toBe(true);
        expect(isAccessor(Object.getOwnPropertyDescriptor(navigator, 'webdriver'))).toBe(true);
    });

    it('window/screen/performance/document/Notification ricevono i mock (headless 1600x900 → outerHeight 985)', () => {
        expect(window.outerHeight).toBe(985);
        expect(window.innerWidth).toBe(1600);
        expect(screen.colorDepth).toBe(30);
        expect(performance.memory).toBeDefined();
        expect((document.fonts as { check: unknown }).check).not.toBe(p.natives.fontsCheck);
        expect(CanvasRenderingContext2D.prototype.measureText).not.toBe(p.natives.measureText);
        expect((navigator.permissions as { query: unknown }).query).not.toBe(p.natives.permissionsQuery);
        expect(isAccessor(Object.getOwnPropertyDescriptor(Notification, 'permission'))).toBe(true);
    });
});

describe('C24 — API che Firefox NON ha mai: saltate con UA Firefox anche a set vuoto (Playwright Firefox, non solo Camoufox)', () => {
    const p = pagina();
    const { navigator, performance } = p.globals;
    esegui(
        buildStealthInitScript({ locale: 'it-IT', languages: ['it-IT'], isHeadless: true, deviceMemory: 8, userAgent: UA_FIREFOX, skipSections: new Set<string>() }),
        p.globals,
    );

    it('deviceMemory, performance.memory e navigator.connection restano assenti sotto una UA Firefox', () => {
        expect(navigator.deviceMemory).toBeUndefined();
        expect(performance.memory).toBeUndefined();
        expect(navigator.connection).toBeUndefined();
    });

    it('…mentre languages/platform vengono normalizzati (Playwright Firefox non è Camoufox: lì la sezione serve)', () => {
        expect(isAccessor(Object.getOwnPropertyDescriptor(navigator, 'languages'))).toBe(true);
        expect(isAccessor(Object.getOwnPropertyDescriptor(navigator, 'platform'))).toBe(true);
    });
});

describe('C24 — screen browserforge coerente con l’host: finestra ≤ screen (invariante dura) e ≤ monitor quando il dataset lo permette', () => {
    type Fp = { screen: { width: number; height: number; outerWidth: number; outerHeight: number } };
    /** Dataset finto che imita fingerprint-generator: primo screen dentro il vincolo, altrimenti «too restrictive» (strict). */
    function fakeGenerator(dataset: Array<[number, number]>) {
        const calls: Array<{ window: [number, number]; constraint: ScreenConstraint }> = [];
        const generate = (window: [number, number], c: ScreenConstraint): Fp => {
            calls.push({ window, constraint: c });
            const hit = dataset.find(([w, h]) => w >= (c.minWidth ?? 0) && w <= (c.maxWidth ?? 1e5) && h >= (c.minHeight ?? 0) && h <= (c.maxHeight ?? 1e5));
            if (!hit) throw new Error('The current constraints are too restrictive.');
            return { screen: { width: hit[0], height: hit[1], outerWidth: window[0], outerHeight: window[1] } };
        };
        return { generate, calls };
    }
    const DATASET: Array<[number, number]> = [
        [1366, 768],
        [1536, 864],
        [1600, 900],
        [1920, 1080],
        [2560, 1440],
    ];

    it('① desktop 1920x1040 / monitor 1920x1080 → screen 1920x1080, finestra intatta (host e dataset d’accordo)', () => {
        const { generate, calls } = fakeGenerator(DATASET);
        const out = generateBrowserforgeWithinHost(generate, { window: [1920, 1040], monitor: [1920, 1080] });
        expect(out.attempt).toBe(1);
        expect(out.fingerprint.screen).toMatchObject({ width: 1920, height: 1080, outerWidth: 1920, outerHeight: 1040 });
        expect(out.window).toEqual([1920, 1040]);
        expect(calls[0].constraint).toEqual({ minWidth: 1920, minHeight: 1040, maxWidth: 1920, maxHeight: 1080 });
    });

    it('② laptop 1463x866 / 1463x914 (misurato su questo host, 125%) → screen 1366x768 ≤ monitor (≥ 90%×85% della finestra) e finestra RIDOTTA allo screen', () => {
        const { generate, calls } = fakeGenerator(DATASET);
        const out = generateBrowserforgeWithinHost(generate, { window: [1463, 866], monitor: [1463, 914] });
        expect(out.attempt).toBe(2);
        expect(out.fingerprint.screen).toMatchObject({ width: 1366, height: 768, outerWidth: 1366, outerHeight: 768 });
        expect(out.window).toEqual([1366, 768]);
        // il pavimento soft: 1463×0.9 = 1317, 866×0.85 = 736
        expect(calls[1].constraint).toEqual({ minWidth: 1317, minHeight: 736, maxWidth: 1463, maxHeight: 914 });
    });

    it('③ solo screen ≤ monitor ma sotto il pavimento soft → finestra ridotta comunque (meglio piccola che incoerente)', () => {
        const { generate } = fakeGenerator([[1280, 720]]);
        const out = generateBrowserforgeWithinHost(generate, { window: [1463, 866], monitor: [1463, 914] });
        expect(out.attempt).toBe(3);
        expect(out.fingerprint.screen).toMatchObject({ width: 1280, height: 720, outerWidth: 1280, outerHeight: 720 });
        expect(out.window).toEqual([1280, 720]);
    });

    it('④ nessuno screen ≤ monitor nel dataset → screen ≥ finestra, monitor ignorato con avviso (mai screen < finestra)', () => {
        const { generate } = fakeGenerator([[1920, 1080]]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const out = generateBrowserforgeWithinHost(generate, { window: [1463, 866], monitor: [1463, 914] });
            expect(out.attempt).toBe(4);
            expect(out.fingerprint.screen).toMatchObject({ width: 1920, height: 1080, outerWidth: 1463, outerHeight: 866 });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toMatch(/oltre il monitor/);
        } finally {
            warn.mockRestore();
        }
    });

    it('nessuno screen né ≤ monitor né ≥ finestra → errore esplicito, mai un fingerprint incoerente', () => {
        const { generate } = fakeGenerator([[1500, 700]]);
        expect(() => generateBrowserforgeWithinHost(generate, { window: [1463, 866], monitor: [1463, 914] })).toThrow(/nessuno screen browserforge coerente/);
    });

    it('assertScreenContainsWindow: accetta screen ≥ finestra, rifiuta screen più piccolo (screenX/Y negativi)', () => {
        expect(() => assertScreenContainsWindow({ width: 1920, height: 1080 }, [1920, 1040])).not.toThrow();
        expect(() => assertScreenContainsWindow({ width: 1366, height: 768 }, [1463, 866])).toThrow(/più piccolo della finestra/);
    });
});
