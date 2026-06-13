/**
 * browser/human/humanDelay.ts
 * ─────────────────────────────────────────────────────────────────
 * Primitive di timing umano PURE (foglia del DAG, zero dipendenze interne):
 * humanDelay (pausa log-normale asimmetrica), ensureViewportDwell (dwell time
 * pre-click), contextualReadingPause (pausa ∝ lunghezza testo).
 * Estratto da humanBehavior.ts (A13, split SRP). TIMING-CORE — formule copiate
 * VERBATIM (distribuzione log-normale asimmetrica, clamp, ratio): un drift numerico
 * = mutazione del fingerprint temporale = detection. NON riscrivere, solo spostare.
 */

import { Page } from 'playwright';
import { config } from '../../config';
import { getPageDeviceProfile } from '../deviceProfile';
import { calculateContextualDelay } from '../../ml/timingModel';

/**
 * Pausa con distribuzione log-normale asimmetrica (Cronometria Disfasica):
 * modella il timing umano con picchi veloci e occasionali distrazioni (long-tail).
 */
export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const rawDelay = calculateContextualDelay({
        actionType: 'read',
        baseMin: min,
        baseMax: max,
        profileMultiplier: getPageDeviceProfile(page).profileMultiplier,
    });

    // Smooth asymmetric application
    const asymmetricDelay = Math.random() < 0.15 ? rawDelay * (1.5 + Math.random()) : rawDelay;
    const delay = Math.round(Math.max(min, Math.min(max * 2.5, asymmetricDelay)));
    await page.waitForTimeout(delay);
}

/**
 * Viewport Dwell Time (3.3): assicura che un elemento sia nel viewport da
 * almeno minMs prima di procedere con il click. LinkedIn usa IntersectionObserver
 * per tracciare quanto tempo un elemento è visibile prima di un'interazione.
 * Click <500ms dopo apparizione = segnale bot.
 *
 * Se l'elemento non è nel viewport, lo scrolla in vista e aspetta.
 * Se è già visibile, aspetta il dwell time rimanente.
 * Fallback silenzioso su errore — non blocca il flusso.
 */
export async function ensureViewportDwell(
    page: Page,
    selector: string,
    minMs: number = 800,
    maxMs: number = 2000,
): Promise<void> {
    try {
        const locator = page.locator(selector).first();
        const isVisible = await locator.isVisible().catch(() => false);

        if (!isVisible) {
            // Scrolla l'elemento in vista
            await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => null);
        }

        // Attendi un tempo realistico nel viewport (dwell time)
        const dwellMs = minMs + Math.floor(Math.random() * (maxMs - minMs));
        await page.waitForTimeout(dwellMs);
    } catch {
        // Best-effort: se l'elemento non esiste o la pagina è chiusa, skip
    }
}

export async function contextualReadingPause(page: Page): Promise<void> {
    try {
        const textLength = await page.evaluate(() => {
            const bodyText = document.body?.innerText ?? '';
            return bodyText.replace(/\s+/g, ' ').trim().length;
        });

        const minMs = Math.max(200, config.contextualPauseMinMs);
        const maxMs = Math.max(minMs, config.contextualPauseMaxMs);
        const normalizedLength = Math.min(8000, Math.max(0, textLength));
        const ratio = normalizedLength / 8000;
        const delayMs = Math.round(minMs + (maxMs - minMs) * ratio);
        await page.waitForTimeout(delayMs);
    } catch {
        // Best-effort pause; ignore extraction errors.
    }
}
