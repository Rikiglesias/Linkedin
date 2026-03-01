/**
 * browser/uiFallback.ts
 * ─────────────────────────────────────────────────────────────────
 * Wrapper con fallback progressivo per interazioni UI Playwright:
 * click, waitForSelector, type con lista di selettori alternativi.
 * Integra self-healing: dynamic selectors + log persistente dei failure.
 */

import { Page } from 'playwright';
import { getDynamicSelectors, recordSelectorFailure, recordSelectorFallbackSuccess } from '../core/repositories';
import { humanDelay } from './humanBehavior';

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

async function resolveSelectorChain(
    selectors: readonly string[],
    label: string
): Promise<string[]> {
    const dynamic = await getDynamicSelectors(label).catch(() => []);
    const merged = [...dynamic, ...selectors];
    const unique = dedupeSelectors(merged);
    if (unique.length === 0) {
        throw new Error(`resolveSelectorChain("${label}"): selettori vuoti.`);
    }
    return unique;
}

async function trackSelectorSuccess(page: Page, label: string, selector: string): Promise<void> {
    await recordSelectorFallbackSuccess(label, selector, page.url()).catch(() => null);
}

async function trackSelectorFailure(
    page: Page,
    label: string,
    selectors: readonly string[],
    message: string
): Promise<void> {
    await recordSelectorFailure(label, page.url(), selectors, message).catch(() => null);
}

/**
 * Prova ogni selettore in ordine fino al primo che funziona.
 * Lancia eccezione solo se tutti i selettori falliscono.
 */
export async function clickWithFallback(
    page: Page,
    selectors: readonly string[],
    label: string,
    timeoutPerSelector: number = 5000
): Promise<void> {
    const selectorChain = await resolveSelectorChain(selectors, label);
    for (let i = 0; i < selectorChain.length; i++) {
        const sel = selectorChain[i] ?? '';
        try {
            const loc = sel.startsWith('//') ? page.locator(`xpath=${sel}`) : page.locator(sel);
            await loc.first().click({ timeout: timeoutPerSelector });
            await trackSelectorSuccess(page, label, sel);
            if (i > 0) {
                console.warn(`[FALLBACK] clickWithFallback("${label}"): usato selettore livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return;
        } catch {
            if (i < selectorChain.length - 1) {
                console.warn(`[FALLBACK] clickWithFallback("${label}"): livello ${i} "${sel.substring(0, 60)}" non trovato, tento il prossimo...`);
            }
        }
    }
    const errorMessage = `clickWithFallback("${label}"): nessun selettore ha funzionato su ${selectorChain.length} tentativi.`;
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
    timeoutPerSelector: number = 7000
): Promise<string> {
    const selectorChain = await resolveSelectorChain(selectors, label);
    for (let i = 0; i < selectorChain.length; i++) {
        const sel = selectorChain[i] ?? '';
        try {
            const playwrightSel = sel.startsWith('//') ? `xpath=${sel}` : sel;
            await page.waitForSelector(playwrightSel, { timeout: timeoutPerSelector });
            await trackSelectorSuccess(page, label, sel);
            if (i > 0) {
                console.warn(`[FALLBACK] waitForSelectorWithFallback("${label}"): comparso su livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return sel;
        } catch {
            if (i < selectorChain.length - 1) {
                console.warn(`[FALLBACK] waitForSelectorWithFallback("${label}"): livello ${i} timeout, prossimo...`);
            }
        }
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
    timeoutPerSelector: number = 5000
): Promise<void> {
    const selectorChain = await resolveSelectorChain(selectors, label);
    for (let i = 0; i < selectorChain.length; i++) {
        const sel = selectorChain[i] ?? '';
        try {
            const playwrightSel = sel.startsWith('//') ? `xpath=${sel}` : sel;
            const loc = page.locator(playwrightSel);
            await loc.first().waitFor({ state: 'visible', timeout: timeoutPerSelector });
            await loc.first().click();
            await humanDelay(page, 200, 500);

            for (let j = 0; j < text.length; j++) {
                if (Math.random() < 0.03 && text.length > 3) {
                    const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
                    await loc.first().pressSequentially(wrongChar, { delay: Math.floor(Math.random() * 130) + 40 });
                    await page.waitForTimeout(280 + Math.random() * 420);
                    await loc.first().press('Backspace');
                    await page.waitForTimeout(180 + Math.random() * 250);
                }
                await loc.first().pressSequentially(text[j] ?? '', { delay: Math.floor(Math.random() * 150) + 40 });
                if (Math.random() < 0.04) await humanDelay(page, 400, 1100);
            }
            await trackSelectorSuccess(page, label, sel);
            if (i > 0) {
                console.warn(`[FALLBACK] typeWithFallback("${label}"): livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return;
        } catch {
            if (i < selectorChain.length - 1) {
                console.warn(`[FALLBACK] typeWithFallback("${label}"): livello ${i} non disponibile, prossimo...`);
            }
        }
    }
    const errorMessage = `typeWithFallback("${label}"): nessun selettore ha funzionato su ${selectorChain.length} tentativi.`;
    await trackSelectorFailure(page, label, selectorChain, errorMessage);
    throw new Error(errorMessage);
}
