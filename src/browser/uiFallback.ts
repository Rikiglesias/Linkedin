/**
 * browser/uiFallback.ts
 * ─────────────────────────────────────────────────────────────────
 * Wrapper con fallback progressivo per interazioni UI Playwright:
 * click, waitForSelector, type con lista di selettori alternativi.
 * Ogni fallback logga un WARNING per segnalare degradi di livello.
 */

import { Page } from 'playwright';
import { humanDelay } from './humanBehavior';

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
    for (let i = 0; i < selectors.length; i++) {
        const sel = selectors[i] ?? '';
        try {
            const loc = sel.startsWith('//') ? page.locator(`xpath=${sel}`) : page.locator(sel);
            await loc.first().click({ timeout: timeoutPerSelector });
            if (i > 0) {
                console.warn(`[FALLBACK] clickWithFallback("${label}"): usato selettore livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return;
        } catch {
            if (i < selectors.length - 1) {
                console.warn(`[FALLBACK] clickWithFallback("${label}"): livello ${i} "${sel.substring(0, 60)}" non trovato, tento il prossimo...`);
            }
        }
    }
    throw new Error(`clickWithFallback("${label}"): nessun selettore ha funzionato su ${selectors.length} tentativi.`);
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
    for (let i = 0; i < selectors.length; i++) {
        const sel = selectors[i] ?? '';
        try {
            const playwrightSel = sel.startsWith('//') ? `xpath=${sel}` : sel;
            await page.waitForSelector(playwrightSel, { timeout: timeoutPerSelector });
            if (i > 0) {
                console.warn(`[FALLBACK] waitForSelectorWithFallback("${label}"): comparso su livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return sel;
        } catch {
            if (i < selectors.length - 1) {
                console.warn(`[FALLBACK] waitForSelectorWithFallback("${label}"): livello ${i} timeout, prossimo...`);
            }
        }
    }
    throw new Error(`waitForSelectorWithFallback("${label}"): nessun selettore trovato dopo ${selectors.length} tentativi.`);
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
    for (let i = 0; i < selectors.length; i++) {
        const sel = selectors[i] ?? '';
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

            if (i > 0) {
                console.warn(`[FALLBACK] typeWithFallback("${label}"): livello ${i} → "${sel.substring(0, 80)}"`);
            }
            return;
        } catch {
            if (i < selectors.length - 1) {
                console.warn(`[FALLBACK] typeWithFallback("${label}"): livello ${i} non disponibile, prossimo...`);
            }
        }
    }
    throw new Error(`typeWithFallback("${label}"): nessun selettore ha funzionato su ${selectors.length} tentativi.`);
}
