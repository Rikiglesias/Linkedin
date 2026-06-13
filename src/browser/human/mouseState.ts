/**
 * browser/human/mouseState.ts
 * ─────────────────────────────────────────────────────────────────
 * Stato condiviso della posizione del mouse per pagina + helper di base.
 * Estratto da humanBehavior.ts (A13 split, regression-safe: codice verbatim).
 * NON contiene formule di timing/varianza — solo gestione dello stato posizione.
 */

import { Page } from 'playwright';
import { Point } from '../../ml/mouseGenerator';
import { randomElement } from '../../utils/random';

// ─── Stato Memoria Mouse ─────────────────────────────────────────────────────

// Mantiene l'ultima posizione nota del mouse per ogni pagina attiva.
// L'uso di WeakMap assicura l'assenza di memory leak quando la Page viene chiusa.
export const pageMouseState = new WeakMap<Page, Point>();

/** Inizializza la posizione mouse per una pagina nuova (centro viewport con varianza).
 *  Evita il pattern rilevabile "mouse entra dal bordo" al primo movimento. */
export function initializeMouseState(page: Page): void {
    if (pageMouseState.has(page)) return;
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const initialX = viewport.width * (0.3 + Math.random() * 0.4);
    const initialY = viewport.height * (0.15 + Math.random() * 0.25);
    pageMouseState.set(page, { x: initialX, y: initialY });
}

/**
 * Ottiene l'attuale o genera un nuovo punto di partenza organico (dai bordi o angoli)
 * per il primissimo movimento nella vista.
 */
export function getStartingPoint(page: Page): Point {
    const lastPoint = pageMouseState.get(page);
    if (lastPoint) {
        return { ...lastPoint };
    }

    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    // Ingresso predefinito fluido: parte da uno dei margini
    const entryPoints: Point[] = [
        { x: Math.random() * viewport.width, y: 0 }, // top
        { x: 0, y: Math.random() * viewport.height }, // left
        { x: viewport.width, y: Math.random() * viewport.height }, // right
        { x: Math.random() * (viewport.width * 0.4), y: Math.random() * (viewport.height * 0.4) }, // top-left area
    ];
    return randomElement(entryPoints);
}

export function updateMouseState(page: Page, point: Point): void {
    pageMouseState.set(page, { x: point.x, y: point.y });
}

/**
 * Funzione di rilascio cursore (no-op dopo rimozione ClipCursor).
 * Mantenuta per retrocompatibilità — chiamata da awaitManualLogin, closeBrowser, SIGINT.
 */
export function releaseMouseConfinement(): void {
    // No-op: il confinamento ClipCursor è stato rimosso.
    // L'isolamento mouse è gestito interamente via CSS overlay nel browser.
}
