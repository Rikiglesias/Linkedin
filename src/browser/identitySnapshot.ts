/**
 * identitySnapshot.ts — ciò che la PAGINA vede dell'identità (C23 + C24), misurato dentro il browser.
 *
 * Pura rispetto al launcher: prende una `Page` e restituisce uno `Snapshot` serializzabile. Le misure C24 sono
 * quelle che distinguono «una sola identità» (prototipi nativi, nessuna proprietà propria, funzioni `[native code]`)
 * da «due identità» (init script che ridefinisce ciò che Camoufox fornisce già).
 */
import type { Page } from 'playwright';

export interface Snapshot {
    userAgent: string;
    platform: string;
    oscpu: string | undefined;
    hardwareConcurrency: number;
    languages: readonly string[];
    screen: { width: number; height: number; colorDepth: number };
    outer: { width: number; height: number };
    inner: { width: number; height: number };
    /** Larghezze di testo (canvas + layout) per 4 font × 2 stringhe: la traccia del seme font. */
    fontWidths: number[];
    /** C24: la stessa stringa misurata due volte nella stessa pagina dà la stessa larghezza (nessun noise JS). */
    repeatedWidthsEqual: boolean;
    /** C24: Firefox non le espone — devono restare `undefined`. */
    deviceMemory: unknown;
    performanceMemory: unknown;
    /** C24: `toString()` con `[native code]` = nessuna sostituzione JS. */
    natives: { fontsCheck: boolean; measureText: boolean; permissionsQuery: boolean; webdriverGetter: boolean; innerWidthGetter: boolean };
    /** C24: proprietà PROPRIE (non del prototipo) — su un browser reale entrambe le liste sono vuote. */
    ownProps: { navigator: string[]; screen: string[] };
    webdriver: unknown;
    notificationPermission: string;
    notificationsQueryState: string;
    timeZone: string;
    /** C24: `check()` è true per OGNI famiglia senza FontFace da caricare (spec FontFaceSet): NON misura la disponibilità. */
    fontsCheckUnknownFamily: boolean;
    /** C24: disponibilità REALE di un font di Windows — larghezza con «Segoe UI, <fallback>» vs solo «<fallback>»: uguali = font assente/nascosto. */
    fontProbe: { segoeMono: number; mono: number; segoeSans: number; sans: number };
}

export const FONTS = ['16px Arial', '16px "Times New Roman"', '16px "Courier New"', '14px Verdana'];
export const TEXTS = ['The quick brown fox jumps over the lazy dog', 'mmmmmmmmmm iiiiiiiiii 0123456789'];

export async function snapshotPage(page: Page): Promise<Snapshot> {
    return page.evaluate<Snapshot, { fonts: string[]; texts: string[] }>(
        async ({ fonts, texts }) => {
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
            let repeatedWidthsEqual = true;
            if (ctx) {
                ctx.font = fonts[0];
                const a = ctx.measureText(texts[0]).width;
                const b = ctx.measureText(texts[0]).width;
                repeatedWidthsEqual = a === b;
            }
            const probeWidth = (font: string): number => {
                if (!ctx) return -1;
                ctx.font = font;
                return ctx.measureText(texts[0]).width;
            };
            const isNative = (fn: unknown): boolean => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
            const navProto = Object.getPrototypeOf(navigator) as object;
            const webdriverGetter = Object.getOwnPropertyDescriptor(navProto, 'webdriver')?.get;
            const innerWidthGetter = Object.getOwnPropertyDescriptor(window, 'innerWidth')?.get;
            let notificationsQueryState = 'n/a';
            try {
                notificationsQueryState = (await navigator.permissions.query({ name: 'notifications' })).state;
            } catch (error) {
                notificationsQueryState = `error:${error instanceof Error ? error.message : String(error)}`;
            }
            const nav = navigator as Navigator & { oscpu?: string; deviceMemory?: unknown };
            const perf = performance as Performance & { memory?: unknown };
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                oscpu: nav.oscpu,
                hardwareConcurrency: navigator.hardwareConcurrency,
                languages: navigator.languages,
                screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
                outer: { width: window.outerWidth, height: window.outerHeight },
                inner: { width: window.innerWidth, height: window.innerHeight },
                fontWidths: widths,
                repeatedWidthsEqual,
                deviceMemory: nav.deviceMemory,
                performanceMemory: perf.memory,
                natives: {
                    fontsCheck: isNative(document.fonts.check),
                    measureText: isNative(CanvasRenderingContext2D.prototype.measureText),
                    permissionsQuery: isNative(navigator.permissions.query),
                    webdriverGetter: isNative(webdriverGetter),
                    innerWidthGetter: isNative(innerWidthGetter),
                },
                ownProps: { navigator: Object.getOwnPropertyNames(navigator), screen: Object.getOwnPropertyNames(screen) },
                webdriver: navigator.webdriver,
                notificationPermission: typeof Notification === 'undefined' ? 'n/a' : Notification.permission,
                notificationsQueryState,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                fontsCheckUnknownFamily: document.fonts.check('12px "FamigliaInesistenteC24"'),
                fontProbe: {
                    segoeMono: probeWidth('16px "Segoe UI", monospace'),
                    mono: probeWidth('16px monospace'),
                    segoeSans: probeWidth('16px "Segoe UI", sans-serif'),
                    sans: probeWidth('16px sans-serif'),
                },
            };
        },
        { fonts: FONTS, texts: TEXTS },
    );
}
