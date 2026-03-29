/**
 * salesnav/bulkSaveHelpers.ts
 * Utility UI/vision per il bulk save orchestrator.
 * Estratto da bulkSaveOrchestrator.ts per ridurre la dimensione del file (112KB → ~90KB).
 */

import type { Locator, Page } from 'playwright';
import { humanDelay } from '../browser';
import {
    ensureVisualCursorOverlay,
    ensureInputBlock,
    pauseInputBlock,
    resumeInputBlock,
    humanMouseMoveToCoords,
    pulseVisualCursorOverlay,
} from '../browser/humanBehavior';
import { visionClick, type VisionRegionClip } from './visionNavigator';

/**
 * Per-Page state: quando true per una data Page, reInjectOverlays skippa tutti gli overlay.
 * WeakMap invece di variabile globale → isolamento per-Page, zero memory leak, multi-account safe.
 */
const _inputBlockSuspendedMap = new WeakMap<Page, boolean>();

export function setInputBlockSuspended(page: Page, value: boolean): void {
    if (value) {
        _inputBlockSuspendedMap.set(page, true);
    } else {
        _inputBlockSuspendedMap.delete(page);
    }
}

export function isInputBlockSuspended(page?: Page): boolean {
    if (!page) return false;
    return _inputBlockSuspendedMap.get(page) === true;
}

export function isPageClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Target page, context or browser has been closed|page\.goto:.*closed/i.test(message);
}

export function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function getSafeMaxSearches(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return Number.MAX_SAFE_INTEGER;
    }
    return Math.max(1, Math.floor(value));
}

export function getSafeSessionLimit(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return null;
    }
    return Math.max(1, Math.floor(value));
}

export function getViewButtonLocator(page: Page, index: number, viewSelector: string): Locator {
    return page.locator(viewSelector).nth(index);
}

export async function hasLocator(locator: Locator): Promise<boolean> {
    try {
        return (await locator.count()) > 0;
    } catch {
        return false;
    }
}

export async function locatorBoundingBox(
    locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
        const box = await locator.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) {
            return null;
        }
        return box;
    } catch {
        return null;
    }
}

export function buildClipFromBox(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
    padding: { top: number; right: number; bottom: number; left: number },
): VisionRegionClip {
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const x = clampNumber(Math.floor(box.x - padding.left), 0, viewport.width);
    const y = clampNumber(Math.floor(box.y - padding.top), 0, viewport.height);
    const maxWidth = viewport.width - x;
    const maxHeight = viewport.height - y;
    const width = clampNumber(Math.floor(box.width + padding.left + padding.right), 1, Math.max(1, maxWidth));
    const height = clampNumber(Math.floor(box.height + padding.top + padding.bottom), 1, Math.max(1, maxHeight));
    return { x, y, width, height };
}

export async function buildClipAroundLocator(
    page: Page,
    locator: Locator,
    padding: { top: number; right: number; bottom: number; left: number },
): Promise<VisionRegionClip | undefined> {
    const box = await locatorBoundingBox(locator);
    if (!box) {
        return undefined;
    }
    return buildClipFromBox(page, box, padding);
}

export async function reInjectOverlays(page: Page): Promise<void> {
    await page
        .evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            if (typeof w.__name === 'undefined') {
                w.__name = (target: unknown, _value: unknown) => target;
            }
            if (typeof w.__defProp === 'undefined') {
                w.__defProp = Object.defineProperty;
            }
        })
        .catch(() => null);
    // Quando suspended (login manuale in corso), NON iniettare nessun overlay —
    // né il cursore visuale (cursor:none nasconde il mouse reale) né l'input block.
    if (_inputBlockSuspendedMap.has(page)) {
        return;
    }
    await ensureVisualCursorOverlay(page);
    await ensureInputBlock(page);
}

/**
 * Click intelligente: usa humanMouseMove + page.mouse.click per sembrare un utente reale.
 */
export async function smartClick(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
): Promise<void> {
    // Jitter proporzionale alla dimensione dell'elemento — mai più del 15% per asse.
    // Elementi piccoli (list item nel dialog, h<40px): zero jitter Y per non cliccare fuori riga.
    const maxJitterX = Math.min(3, box.width * 0.15);
    const maxJitterY = box.height < 40 ? 0 : Math.min(2, box.height * 0.15);
    const targetX = box.x + box.width / 2 + (Math.random() * maxJitterX * 2 - maxJitterX);
    const targetY = box.y + box.height / 2 + (Math.random() * maxJitterY * 2 - maxJitterY);
    await humanMouseMoveToCoords(page, targetX, targetY);
    await pulseVisualCursorOverlay(page);
    await pauseInputBlock(page);
    // 30ms wait per garantire che il browser applichi pointer-events:none
    // prima del click (race condition render loop → click intercettato dall'overlay)
    await page.waitForTimeout(30);
    await page.mouse.click(targetX, targetY, { delay: 40 + Math.floor(Math.random() * 70) });
    await resumeInputBlock(page);
}

/** Wrapper per visionClick che disabilita l'overlay durante il click. */
export async function safeVisionClick(
    page: Page,
    description: string,
    options?: Parameters<typeof visionClick>[2],
): Promise<void> {
    await pauseInputBlock(page);
    try {
        await visionClick(page, description, options);
    } finally {
        await resumeInputBlock(page);
    }
}

/**
 * Navigazione vision-guided: DOM fast-path → Vision AI fallback.
 */
export async function visionNavigationStep(
    page: Page,
    stepName: string,
    prompt: string,
    verifyFn: () => Promise<boolean>,
    _domFallbackSelectors?: string[],
    dismissFn?: (p: Page) => Promise<void>,
): Promise<boolean> {
    // AI-first: prova Vision AI per prima (più umana, clicca dove vede).
    // Aspetta 2s che la pagina si stabilizzi prima di fare lo screenshot.
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 1_000, 2_000);

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`[AI-NAV] ${stepName}: analizzo screenshot (tentativo ${attempt})...`);
            await visionClick(page, prompt, { retries: 1 });
            await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
            await humanDelay(page, 1_000, 2_000);
            if (dismissFn) await dismissFn(page);

            if (await verifyFn()) {
                console.log(`[AI-NAV] ${stepName}: completato con successo via AI`);
                return true;
            }
            console.log(`[AI-NAV] ${stepName}: click AI eseguito ma verifica fallita, riprovo...`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(`[AI-NAV] ${stepName}: tentativo AI ${attempt} fallito — ${msg}`);
        }
        await humanDelay(page, 500, 1_000);
    }

    return false;
}

/**
 * Cerca nel DOM un elemento visibile il cui testo corrisponde a uno dei pattern.
 */
export async function findVisibleClickTarget(
    page: Page,
    textPatterns: string[],
    containerSelector?: string,
    includeGenericElements: boolean = false,
    strictMatch: boolean = false,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return page.evaluate(
        ({ patterns, container, includeGeneric, strict }) => {
            const root = container ? (document.querySelector(container) ?? document) : document;
            const interactiveSelector =
                'button, a, label, input, [role="button"], [role="checkbox"], [role="menuitem"], [role="option"]';
            const genericSelector = interactiveSelector + ', span, div, li';
            const candidates = root.querySelectorAll(includeGeneric ? genericSelector : interactiveSelector);

            const entries: Array<{ el: HTMLElement; text: string }> = [];
            for (const el of candidates) {
                const htmlEl = el as HTMLElement;
                const text = (htmlEl.innerText || htmlEl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (text.length > 0) entries.push({ el: htmlEl, text });
            }

            for (let pass = 0; pass < (strict ? 3 : 4); pass++) {
                for (const pattern of patterns) {
                    const lower = pattern.toLowerCase().replace(/\s+/g, ' ').trim();
                    for (const { el, text } of entries) {
                        if (pass === 0 && text !== lower) continue;
                        // Pass 1: REVERSE starts-with — il nome completo inizia col testo troncato nel DOM.
                        // Cattura: DOM="eventi eu da 1-50 fr, spa..." vs pattern="eventi eu da 1-50 fr, spa, paesi bassi"
                        if (pass === 1 && (!lower.startsWith(text) || text.length < 10)) continue;
                        if (pass === 2 && (!text.startsWith(lower) || text.length > lower.length + 30)) continue;
                        if (pass === 3 && (!text.includes(lower) || text.length > lower.length * 8)) continue;

                        const rect = el.getBoundingClientRect();
                        if (el.tagName === 'INPUT') {
                            const label = el.closest('label');
                            if (label) {
                                const lr = label.getBoundingClientRect();
                                if (lr.width >= 5 && lr.height >= 5) {
                                    return { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
                                }
                            }
                            if (rect.width < 5 || rect.height < 5) continue;
                        }
                        if (rect.width < 5 || rect.height < 5) continue;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        if (parseFloat(style.opacity) < 0.1) continue;
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                }
            }
            return null;
        },
        {
            patterns: textPatterns,
            container: containerSelector ?? null,
            includeGeneric: includeGenericElements,
            strict: strictMatch,
        },
    );
}
