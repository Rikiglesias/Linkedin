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
import { dimensioniFinestra } from '../viewport';

// ─── Stato Memoria Mouse ─────────────────────────────────────────────────────

// Mantiene l'ultima posizione nota del mouse per ogni pagina attiva.
// L'uso di WeakMap assicura l'assenza di memory leak quando la Page viene chiusa.
export const pageMouseState = new WeakMap<Page, Point>();

/** Inizializza la posizione mouse per una pagina nuova (centro viewport con varianza).
 *  Evita il pattern rilevabile "mouse entra dal bordo" al primo movimento.
 *
 *  Async dal 2026-08-05 (Fase 4): la posizione va generata dentro la finestra VERA. Con il vecchio
 *  `viewportSize() ?? {1280,800}` la x iniziale non poteva superare 896 px su NESSUNO schermo,
 *  perche' in non-headless (il default) `viewportSize()` e' sempre null. Dimensioni ignote =>
 *  non si registra nulla: `getStartingPoint` sa gia' cosa fare quando lo stato manca. */
export async function initializeMouseState(page: Page): Promise<void> {
    if (pageMouseState.has(page)) return;
    const viewport = await dimensioniFinestra(page);
    if (!viewport) return;
    const initialX = viewport.width * (0.3 + Math.random() * 0.4);
    const initialY = viewport.height * (0.15 + Math.random() * 0.25);
    pageMouseState.set(page, { x: initialX, y: initialY });
}

/**
 * Ottiene l'attuale o genera un nuovo punto di partenza organico (dai bordi o angoli)
 * per il primissimo movimento nella vista.
 *
 * 🔴 Qui il viewport GENERA il bersaglio, non lo valida: `{ x: viewport.width, … }` significa
 * letteralmente «il mouse entra dal bordo destro». Con il default a 1280 su una finestra 1920 quel
 * "bordo destro" cadeva a due terzi dello schermo, e il terzo destro non veniva mai attraversato —
 * un cursore che in migliaia di sessioni non visita mai un terzo della finestra e' una firma.
 *
 * Ritorna `null` quando le dimensioni non si sanno (pagina chiusa, context distrutto): in quello
 * stato il movimento fallirebbe comunque, e inventare un rettangolo qui significherebbe generare
 * punti d'ingresso fuori dalla finestra reale.
 */
export async function getStartingPoint(page: Page): Promise<Point | null> {
    const lastPoint = pageMouseState.get(page);
    if (lastPoint) {
        return { ...lastPoint };
    }

    const viewport = await dimensioniFinestra(page);
    if (!viewport) return null;
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
