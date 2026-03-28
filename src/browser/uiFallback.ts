/**
 * browser/uiFallback.ts
 * ─────────────────────────────────────────────────────────────────
 * Wrapper con fallback progressivo per interazioni UI Playwright:
 * click, waitForSelector, type con lista di selettori alternativi.
 * Integra self-healing: dynamic selectors + ranking per confidenza/stabilita'
 * + log persistente dei failure.
 */

import { Page } from 'playwright';
import {
    countOpenSelectorFailuresByActionLabels,
    getDynamicSelectors,
    listDynamicSelectorCandidates,
    recordSelectorFailure,
    recordSelectorFallbackSuccess,
} from '../core/repositories';
import { humanDelay, humanMouseMoveToCoords } from './humanBehavior';
import { computeSessionTypoRate, determineNextKeystroke } from '../ai/typoGenerator';
import { VisionSolver } from '../captcha/solver';

export interface ClickFallbackOptions {
    timeoutPerSelector?: number;
    postClickDelayMs?: number;
    verify?: (page: Page, selectedSelector: string, attemptIndex: number) => Promise<boolean> | boolean;
}

interface InternalSelectorCandidate {
    selector: string;
    source: 'dynamic' | 'static';
    confidence: number;
    successCount: number;
    order: number;
}

export interface RankedSelectorCandidate extends InternalSelectorCandidate {
    score: number;
}

const STABLE_SELECTOR_RE = /(data-test|data-testid|data-control-name|aria-label|role=|#[a-z0-9_-]+)/i;
const FRAGILE_SELECTOR_RE = /(nth-child|nth-of-type|:nth\(|:has-text\(|contains\(\.)/i;
const CONTEXT_CACHE_MAX_ENTRIES = 300;
const CONTEXT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CONTEXT_CACHE_SELECTORS_PER_KEY = 6;

interface ContextCacheEntry {
    selectors: string[];
    updatedAt: number;
}

const selectorContextCache = new Map<string, ContextCacheEntry>();

function dedupeSelectors(selectors: readonly string[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const selector of selectors) {
        const normalized = selector.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        ordered.push(normalized);
    }
    return ordered;
}

function scoreSelectorCandidate(candidate: InternalSelectorCandidate): number {
    const selector = candidate.selector;
    const isXPath = selector.startsWith('//') || selector.startsWith('xpath=');
    const depthPenalty = Math.max(0, (selector.match(/\s+/g)?.length ?? 0) - 2) * 0.06;

    let score = 0;
    score += candidate.source === 'dynamic' ? 2 : 1;
    score += Math.max(0, Math.min(1, candidate.confidence)) * 2.2;
    score += Math.min(1.8, Math.max(0, candidate.successCount) / 10);
    score += Math.max(0, 0.35 - candidate.order * 0.03);

    if (STABLE_SELECTOR_RE.test(selector)) score += 0.45;
    if (isXPath) score -= 0.2;
    else score += 0.1;

    if (FRAGILE_SELECTOR_RE.test(selector)) score -= 0.35;
    if (selector.length > 140) score -= 0.2;
    score -= depthPenalty;
    return Number.parseFloat(score.toFixed(4));
}

export function rankSelectorCandidates(candidates: readonly InternalSelectorCandidate[]): RankedSelectorCandidate[] {
    const ranked = candidates.map((candidate) => ({
        ...candidate,
        score: scoreSelectorCandidate(candidate),
    }));

    return ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.source !== b.source) return a.source === 'dynamic' ? -1 : 1;
        if (a.order !== b.order) return a.order - b.order;
        return a.selector.localeCompare(b.selector);
    });
}

function getUrlContext(url: string): string {
    if (!url || !url.trim()) return 'unknown';
    try {
        const parsed = new URL(url);
        const segments = parsed.pathname
            .split('/')
            .filter((segment) => segment.length > 0)
            .slice(0, 3);
        return `${parsed.origin}/${segments.join('/')}`;
    } catch {
        return url.trim().slice(0, 120);
    }
}

export function buildSelectorContextKey(url: string, label: string): string {
    const safeLabel = label.trim() || 'unknown';
    return `${safeLabel}|${getUrlContext(url)}`;
}

export function resetSelectorContextCacheForTests(): void {
    selectorContextCache.clear();
}

function getCachedSelectorsForContext(contextKey: string): string[] {
    const entry = selectorContextCache.get(contextKey);
    if (!entry) return [];
    if (Date.now() - entry.updatedAt > CONTEXT_CACHE_TTL_MS) {
        selectorContextCache.delete(contextKey);
        return [];
    }
    return entry.selectors.slice(0, CONTEXT_CACHE_SELECTORS_PER_KEY);
}

function rememberSelectorForContext(contextKey: string, selector: string): void {
    const normalized = selector.trim();
    if (!normalized) return;
    const existing = getCachedSelectorsForContext(contextKey);
    const merged = dedupeSelectors([normalized, ...existing]).slice(0, CONTEXT_CACHE_SELECTORS_PER_KEY);
    selectorContextCache.set(contextKey, {
        selectors: merged,
        updatedAt: Date.now(),
    });

    // Best-effort bounded cache size to avoid unbounded growth in long-running workers.
    if (selectorContextCache.size > CONTEXT_CACHE_MAX_ENTRIES) {
        const staleEntries = [...selectorContextCache.entries()]
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
            .slice(0, selectorContextCache.size - CONTEXT_CACHE_MAX_ENTRIES);
        for (const [key] of staleEntries) {
            selectorContextCache.delete(key);
        }
    }
}

async function resolveSelectorChain(
    page: Page,
    selectors: readonly string[],
    label: string,
): Promise<{ ranked: RankedSelectorCandidate[]; contextKey: string; cacheHit: boolean }> {
    const contextKey = buildSelectorContextKey(page.url(), label);
    const cachedContextSelectors = getCachedSelectorsForContext(contextKey);
    const [dynamicDetailed, dynamicFallback] = await Promise.all([
        listDynamicSelectorCandidates(label, 12).catch(() => []),
        getDynamicSelectors(label).catch(() => []),
    ]);
    const staticDeduped = dedupeSelectors(selectors);

    const bySelector = new Map<string, InternalSelectorCandidate>();
    for (let i = 0; i < cachedContextSelectors.length; i++) {
        const selector = cachedContextSelectors[i];
        bySelector.set(selector, {
            selector,
            source: 'dynamic',
            confidence: 0.98,
            successCount: 50 - i,
            order: i,
        });
    }

    const dynamicOffset = bySelector.size;
    for (let i = 0; i < dynamicDetailed.length; i++) {
        const row = dynamicDetailed[i];
        const selector = row?.selector?.trim() ?? '';
        if (!selector) continue;
        bySelector.set(selector, {
            selector,
            source: 'dynamic',
            confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
            successCount: Number.isFinite(row.success_count) ? row.success_count : 0,
            order: dynamicOffset + i,
        });
    }

    // Backward-compatible fallback: se il DB non espone i dettagli, usa solo la lista semplice.
    for (let i = 0; i < dynamicFallback.length; i++) {
        const selector = dynamicFallback[i]?.trim() ?? '';
        if (!selector || bySelector.has(selector)) continue;
        bySelector.set(selector, {
            selector,
            source: 'dynamic',
            confidence: 0.5,
            successCount: Math.max(0, 12 - i),
            order: i,
        });
    }

    const staticOffset = bySelector.size;
    for (let i = 0; i < staticDeduped.length; i++) {
        const selector = staticDeduped[i];
        const existing = bySelector.get(selector);
        if (existing) {
            existing.order = Math.min(existing.order, i);
            continue;
        }
        bySelector.set(selector, {
            selector,
            source: 'static',
            confidence: 0.35,
            successCount: 0,
            order: staticOffset + i,
        });
    }

    const merged = Array.from(bySelector.values());
    if (merged.length === 0) {
        throw new Error(`resolveSelectorChain("${label}"): selettori vuoti.`);
    }
    return {
        ranked: rankSelectorCandidates(merged),
        contextKey,
        cacheHit: cachedContextSelectors.length > 0,
    };
}

async function trackSelectorSuccess(page: Page, label: string, selector: string): Promise<void> {
    await recordSelectorFallbackSuccess(label, selector, page.url()).catch(() => null);
}

async function trackSelectorFailure(
    page: Page,
    label: string,
    selectors: readonly string[],
    message: string,
): Promise<void> {
    // D-1: Distinguere "selector not found" da "page didn't load".
    // Su proxy lenti, la pagina potrebbe non aver caricato il DOM → qualsiasi selettore
    // fallirebbe. Registrare come selector failure inflaziona selectorFailureRate
    // nel risk engine → quarantine ingiusta. Verifichiamo che la pagina abbia contenuto.
    try {
        const bodyLength = await page.evaluate(() => (document.body?.innerText ?? '').length).catch(() => 0);
        if (bodyLength < 200) {
            // Pagina non caricata — problema di connettività, non del selettore
            return;
        }
    } catch {
        // Se non riusciamo nemmeno a valutare il body, la pagina è probabilmente chiusa
        return;
    }
    await recordSelectorFailure(label, page.url(), selectors, message).catch(() => null);
}

function normalizeClickOptions(
    input: number | ClickFallbackOptions | undefined,
): Required<Omit<ClickFallbackOptions, 'verify'>> & Pick<ClickFallbackOptions, 'verify'> {
    if (typeof input === 'number') {
        return {
            timeoutPerSelector: input,
            postClickDelayMs: 0,
            verify: undefined,
        };
    }
    return {
        timeoutPerSelector: Math.max(1, input?.timeoutPerSelector ?? 5000),
        postClickDelayMs: Math.max(0, input?.postClickDelayMs ?? 0),
        verify: input?.verify,
    };
}

/**
 * Prova ogni selettore in ordine fino al primo che funziona.
 * Lancia eccezione solo se tutti i selettori falliscono.
 */
export async function clickWithFallback(
    page: Page,
    selectors: readonly string[],
    label: string,
    timeoutOrOptions: number | ClickFallbackOptions = 5000,
): Promise<void> {
    const options = normalizeClickOptions(timeoutOrOptions);
    const resolution = await resolveSelectorChain(page, selectors, label);
    const rankedChain = resolution.ranked;
    const selectorChain = rankedChain.map((candidate) => candidate.selector);
    const errors: string[] = [];

    if (resolution.cacheHit) {
        console.info(
            `[FALLBACK] clickWithFallback("${label}"): context cache hit (${selectorChain.length} candidati).`,
        );
    }

    for (let i = 0; i < rankedChain.length; i++) {
        const candidate = rankedChain[i];
        const sel = candidate.selector;
        try {
            const loc = sel.startsWith('//') ? page.locator(`xpath=${sel}`) : page.locator(sel);
            // Mouse move umano prima del click per evitare pattern bot
            const box = await loc.first().boundingBox().catch(() => null);
            if (box) {
                await humanMouseMoveToCoords(page, box.x + box.width / 2 + (Math.random() * 6 - 3), box.y + box.height / 2 + (Math.random() * 6 - 3));
            }
            await loc.first().click({ timeout: options.timeoutPerSelector, delay: 20 + Math.floor(Math.random() * 60) });
            if (options.postClickDelayMs > 0) {
                await page.waitForTimeout(options.postClickDelayMs);
            }
            if (options.verify) {
                const verified = await Promise.resolve(options.verify(page, sel, i)).catch(() => false);
                if (!verified) {
                    throw new Error('post_action_verification_failed');
                }
            }
            await trackSelectorSuccess(page, label, sel);
            rememberSelectorForContext(resolution.contextKey, sel);
            if (i > 0) {
                // H20: Log fallback success so it's observable (DB record is also persisted via trackSelectorSuccess)
                console.warn(
                    `[FALLBACK] clickWithFallback("${label}"): usato selettore livello ${i} (score=${candidate.score.toFixed(2)}) -> "${sel.substring(0, 80)}"`,
                );
                console.info(`[FALLBACK] ui_fallback.success label="${label}" selector="${sel.substring(0, 80)}" fallbackLevel=${i}`);
            }
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'selector_click_failed';
            errors.push(`${sel.substring(0, 80)} => ${message}`);
            if (i < rankedChain.length - 1) {
                console.warn(
                    `[FALLBACK] clickWithFallback("${label}"): livello ${i} "${sel.substring(0, 60)}" fallito (${message}), tento il prossimo...`,
                );
            }
        }
    }

    // P3-06: Layer Z Extremo (Vision Fallback) - Se falliscono i selettori, usiamo LLaVA
    console.warn(`[FALLBACK-VISION] clickWithFallback("${label}"): CSS/XPath esausti. Attivazione VisionSolver...`);
    try {
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
        const base64Image = screenshotBuffer.toString('base64');
        const solver = new VisionSolver();
        const coords = await solver.findObjectCoordinates(base64Image, label);
        const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };

        if (coords && coords.x > 0 && coords.y > 0 && coords.x <= viewport.width && coords.y <= viewport.height) {
            console.log(`[FALLBACK-VISION] Coordinate ottenute da LLaVA per "${label}": X:${coords.x}, Y:${coords.y}`);
            await humanMouseMoveToCoords(page, coords.x, coords.y);
            await page.mouse.click(coords.x, coords.y);
            if (options.postClickDelayMs > 0) {
                await page.waitForTimeout(options.postClickDelayMs);
            }
            if (options.verify) {
                const verified = await Promise.resolve(options.verify(page, 'vision-layer-z', 999)).catch(() => false);
                if (!verified) throw new Error('vision_post_action_verification_failed');
            }
            await trackSelectorSuccess(page, label, 'vision-layer-z');
            return;
        } else {
            console.warn(`[FALLBACK-VISION] VisionSolver non è riuscito a localizzare "${label}".`);
        }
    } catch (visionError) {
        console.error(`[FALLBACK-VISION] Errore critico durante inferenza visiva per "${label}":`, visionError);
    }

    const diagnostic = errors.length > 0 ? ` dettagli=${errors.slice(0, 4).join(' | ')}` : '';
    const errorMessage = `clickWithFallback("${label}"): nessun selettore ha funzionato su ${selectorChain.length} tentativi, VisionFallback fallito.${diagnostic}`;
    await trackSelectorFailure(page, label, selectorChain, errorMessage);
    throw new Error(errorMessage);
}

/**
 * Aspetta che compaia almeno uno degli elementi. Ritorna il selettore riuscito.
 */
export async function waitForSelectorWithFallback(
    page: Page,
    selectors: readonly string[],
    label: string,
    timeoutPerSelector: number = 7000,
): Promise<string> {
    const resolution = await resolveSelectorChain(page, selectors, label);
    const rankedChain = resolution.ranked;
    const selectorChain = rankedChain.map((candidate) => candidate.selector);
    for (let i = 0; i < rankedChain.length; i++) {
        const candidate = rankedChain[i];
        const sel = candidate.selector;
        try {
            const playwrightSel = sel.startsWith('//') ? `xpath=${sel}` : sel;
            await page.waitForSelector(playwrightSel, { timeout: timeoutPerSelector });
            await trackSelectorSuccess(page, label, sel);
            rememberSelectorForContext(resolution.contextKey, sel);
            if (i > 0) {
                console.warn(
                    `[FALLBACK] waitForSelectorWithFallback("${label}"): comparso su livello ${i} (score=${candidate.score.toFixed(2)}) -> "${sel.substring(0, 80)}"`,
                );
            }
            return sel;
        } catch {
            if (i < selectorChain.length - 1) {
                console.warn(`[FALLBACK] waitForSelectorWithFallback("${label}"): livello ${i} timeout, prossimo...`);
            }
        }
    }

    // P3-06: Layer Z Extremo per waitForSelector
    console.warn(`[FALLBACK-VISION] waitForSelectorWithFallback("${label}"): CSS/XPath timeout. Provo VisionSolver...`);
    try {
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
        const base64Image = screenshotBuffer.toString('base64');
        const solver = new VisionSolver();
        const coords = await solver.findObjectCoordinates(base64Image, label);
        const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };

        if (coords && coords.x > 0 && coords.y > 0 && coords.x <= viewport.width && coords.y <= viewport.height) {
            console.log(
                `[FALLBACK-VISION] Elemento trovato visivamente per "${label}" a (X:${coords.x}, Y:${coords.y})`,
            );
            await trackSelectorSuccess(page, label, 'vision-layer-z');
            return 'vision-layer-z';
        }
    } catch (visionError) {
        console.error(
            `[FALLBACK-VISION] Errore critico durante inferenza visiva per waitForSelector "${label}":`,
            visionError,
        );
    }

    const errorMessage = `waitForSelectorWithFallback("${label}"): nessun selettore trovato dopo ${selectorChain.length} tentativi.`;
    await trackSelectorFailure(page, label, selectorChain, errorMessage);
    throw new Error(errorMessage);
}

/**
 * Digita in modo umano sul primo selettore funzionante.
 * Wrapper di humanType con fallback progressivo.
 */
export async function typeWithFallback(
    page: Page,
    selectors: readonly string[],
    text: string,
    label: string,
    timeoutPerSelector: number = 5000,
): Promise<void> {
    const resolution = await resolveSelectorChain(page, selectors, label);
    const rankedChain = resolution.ranked;
    const selectorChain = rankedChain.map((candidate) => candidate.selector);
    for (let i = 0; i < rankedChain.length; i++) {
        const candidate = rankedChain[i];
        const sel = candidate.selector;
        try {
            const playwrightSel = sel.startsWith('//') ? `xpath=${sel}` : sel;
            const loc = page.locator(playwrightSel);
            await loc.first().waitFor({ state: 'visible', timeout: timeoutPerSelector });
            // Mouse move umano prima del click su input
            const inputBox = await loc.first().boundingBox().catch(() => null);
            if (inputBox) {
                await humanMouseMoveToCoords(page, inputBox.x + inputBox.width / 2 + (Math.random() * 6 - 3), inputBox.y + inputBox.height / 2 + (Math.random() * 6 - 3));
            }
            await loc.first().click();
            await humanDelay(page, 200, 500);

            const typoRate = computeSessionTypoRate();
            for (let j = 0; j < text.length; j++) {
                const originalChar = text[j] ?? '';
                const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, typoRate);
                if (isTypo && text.length > 3) {
                    await loc.first().pressSequentially(typedChar, { delay: Math.floor(Math.random() * 130) + 40 });
                    await page.waitForTimeout(280 + Math.random() * 420);
                    await loc.first().press('Backspace');
                    await page.waitForTimeout(180 + Math.random() * 250);
                }
                await loc.first().pressSequentially(originalChar, { delay: Math.floor(Math.random() * 150) + 40 });
                if (Math.random() < 0.04) await humanDelay(page, 400, 1100);
            }
            await trackSelectorSuccess(page, label, sel);
            rememberSelectorForContext(resolution.contextKey, sel);
            if (i > 0) {
                console.warn(
                    `[FALLBACK] typeWithFallback("${label}"): livello ${i} (score=${candidate.score.toFixed(2)}) -> "${sel.substring(0, 80)}"`,
                );
            }
            return;
        } catch {
            if (i < selectorChain.length - 1) {
                console.warn(`[FALLBACK] typeWithFallback("${label}"): livello ${i} non disponibile, prossimo...`);
            }
        }
    }

    // P3-06: Layer Z Extremo per typeWithFallback
    console.warn(`[FALLBACK-VISION] typeWithFallback("${label}"): CSS/XPath falliti. Attivazione VisionSolver...`);
    try {
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
        const base64Image = screenshotBuffer.toString('base64');
        const solver = new VisionSolver();
        const coords = await solver.findObjectCoordinates(base64Image, label);
        const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };

        if (coords && coords.x > 0 && coords.y > 0 && coords.x <= viewport.width && coords.y <= viewport.height) {
            console.log(
                `[FALLBACK-VISION] Coordinate ottenute da LLaVA per digitazione "${label}": X:${coords.x}, Y:${coords.y}`,
            );
            await humanMouseMoveToCoords(page, coords.x, coords.y);
            await page.mouse.click(coords.x, coords.y);
            await humanDelay(page, 200, 500);

            for (let j = 0; j < text.length; j++) {
                if (Math.random() < 0.03 && text.length > 3) {
                    const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
                    await page.keyboard.type(wrongChar, { delay: Math.floor(Math.random() * 130) + 40 });
                    await page.waitForTimeout(280 + Math.random() * 420);
                    await page.keyboard.press('Backspace');
                    await page.waitForTimeout(180 + Math.random() * 250);
                }
                await page.keyboard.type(text[j] ?? '', { delay: Math.floor(Math.random() * 150) + 40 });
                if (Math.random() < 0.04) await humanDelay(page, 400, 1100);
            }
            await trackSelectorSuccess(page, label, 'vision-layer-z');
            return;
        } else {
            console.warn(`[FALLBACK-VISION] VisionSolver non ha trovato l'input "${label}".`);
        }
    } catch (visionError) {
        console.error(`[FALLBACK-VISION] Errore critico in typeWithFallback per "${label}":`, visionError);
    }

    const errorMessage = `typeWithFallback("${label}"): nessun selettore ha funzionato su ${selectorChain.length} tentativi.`;
    await trackSelectorFailure(page, label, selectorChain, errorMessage);
    throw new Error(errorMessage);
}

// ─── Shadow DOM Penetration ──────────────────────────────────────────────────

/**
 * Cerca un elemento attraverso Shadow DOM chiusi usando page.evaluate con
 * ricorsione su shadowRoot. LinkedIn usa Web Components in messaging e notifiche.
 * Ritorna le coordinate del primo elemento trovato, o null.
 */
export async function findInShadowDom(
    page: Page,
    cssSelector: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return page.evaluate((sel) => {
        function deepQuerySelector(root: Document | ShadowRoot, selector: string, maxDepth = 10): Element | null {
            if (maxDepth <= 0) return null;
            const found = root.querySelector(selector);
            if (found) return found;
            const allElements = root.querySelectorAll('*');
            for (const el of allElements) {
                if (el.shadowRoot) {
                    const inner = deepQuerySelector(el.shadowRoot, selector, maxDepth - 1);
                    if (inner) return inner;
                }
            }
            return null;
        }
        const el = deepQuerySelector(document, sel);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
    }, cssSelector);
}

/**
 * Click con fallback Shadow DOM: se il locator standard fallisce,
 * prova a trovare l'elemento dentro Shadow DOM e clicca via coordinate.
 */
export async function clickWithShadowFallback(
    page: Page,
    selectors: readonly string[],
    label: string,
    options?: ClickFallbackOptions,
): Promise<void> {
    try {
        await clickWithFallback(page, selectors, label, options ?? 5000);
    } catch {
        for (const sel of selectors) {
            const coords = await findInShadowDom(page, sel);
            if (coords) {
                console.warn(`[FALLBACK-SHADOW] clickWithShadowFallback("${label}"): trovato in Shadow DOM via "${sel.substring(0, 60)}"`);
                await humanMouseMoveToCoords(page, coords.x, coords.y);
                await page.mouse.click(coords.x, coords.y);
                await trackSelectorSuccess(page, label, `shadow:${sel}`);
                return;
            }
        }
        throw new Error(`clickWithShadowFallback("${label}"): non trovato né in DOM regolare né in Shadow DOM`);
    }
}

// ─── Post-Action Verification ────────────────────────────────────────────────

/**
 * Verifica generica post-azione: controlla che un elemento atteso sia apparso
 * dopo un click (es. modale nota dopo click Connect, textbox dopo click Message).
 * Ritorna true se l'elemento è apparso entro il timeout.
 */
export async function verifyPostAction(
    page: Page,
    expectedSelector: string | readonly string[],
    timeoutMs: number = 3000,
): Promise<boolean> {
    const selectors = typeof expectedSelector === 'string' ? [expectedSelector] : expectedSelector;
    for (const sel of selectors) {
        try {
            await page.locator(sel).first().waitFor({ state: 'visible', timeout: timeoutMs });
            return true;
        } catch {
            continue;
        }
    }
    return false;
}

// ─── Selector Drift Metrics ─────────────────────────────────────────────────

export interface SelectorDriftReport {
    label: string;
    currentFailures: number;
    previousFailures: number;
    driftRate: number;
    drifting: boolean;
}

/**
 * Calcola il "selector drift" per un insieme di label: quanto i selettori stanno
 * diventando instabili confrontando failure count attuale vs periodo precedente.
 * Un drift rate > 0.5 indica che LinkedIn probabilmente ha cambiato i class name.
 */
export async function measureSelectorDrift(
    labels: string[],
    currentWindowDays: number = 3,
    previousWindowDays: number = 7,
): Promise<SelectorDriftReport[]> {
    const reports: SelectorDriftReport[] = [];

    for (const label of labels) {
        try {
            const [currentCount, previousCount] = await Promise.all([
                countOpenSelectorFailuresByActionLabels([label], currentWindowDays).catch(() => 0),
                countOpenSelectorFailuresByActionLabels([label], previousWindowDays).catch(() => 0),
            ]);

            const previousOnly = Math.max(0, previousCount - currentCount);
            const baseline = Math.max(1, previousOnly);
            const driftRate = currentCount / baseline;

            reports.push({
                label,
                currentFailures: currentCount,
                previousFailures: previousOnly,
                driftRate: Number.parseFloat(driftRate.toFixed(3)),
                drifting: driftRate > 1.5 && currentCount >= 3,
            });
        } catch {
            reports.push({
                label,
                currentFailures: 0,
                previousFailures: 0,
                driftRate: 0,
                drifting: false,
            });
        }
    }

    return reports;
}
