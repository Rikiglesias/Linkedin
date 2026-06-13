/**
 * browser/human/cursorOverlay.ts
 * ─────────────────────────────────────────────────────────────────
 * Overlay DOM del cursore visuale (pallino verde di debug) + rimozione di TUTTI
 * gli overlay iniettati dal bot. Estratto da humanBehavior.ts (A13, split SRP).
 * NON-timing: sola manipolazione DOM, zero formule anti-ban. Codice VERBATIM.
 */

import { Page } from 'playwright';
import { config } from '../../config';
import { isMobilePage } from '../deviceProfile';
import { Point } from '../../ml/mouseGenerator';
import { pageMouseState } from './mouseState';
import {
    VISUAL_CURSOR_STYLE_ID,
    VISUAL_CURSOR_ELEMENT_ID,
    VISUAL_CURSOR_ROOT_CLASS,
    INPUT_BLOCK_TOAST_ID,
    INPUT_BLOCK_OVERLAY_ID,
} from './overlayIds';

export async function ensureVisualCursorOverlay(page: Page): Promise<void> {
    if (page.isClosed() || isMobilePage(page)) {
        return;
    }
    // Camoufox ha il suo cursore nativo — il nostro overlay DOM crea un doppio cursore confuso.
    if (config.browserEngine === 'camoufox') {
        return;
    }

    try {
        await page.evaluate(
            ({ styleId, cursorId, rootClass }) => {
                if (!document.getElementById(styleId)) {
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.textContent = `
html.${rootClass}, html.${rootClass} * {
    cursor: none !important;
}
#${cursorId} {
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.95);
    background: rgba(16, 185, 129, 0.95);
    box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.22), 0 4px 18px rgba(0, 0, 0, 0.28);
    transform: translate(-50%, -50%);
    transition: left 22ms linear, top 22ms linear, width 80ms ease, height 80ms ease, box-shadow 80ms ease;
    pointer-events: none;
    z-index: 2147483647;
    opacity: 0.96;
}
#${cursorId}[data-clicking="true"] {
    width: 11px;
    height: 11px;
    box-shadow: 0 0 0 10px rgba(16, 185, 129, 0.18), 0 0 0 2px rgba(255, 255, 255, 0.8);
}`;
                    document.documentElement.appendChild(style);
                }

                document.documentElement.classList.add(rootClass);

                if (!document.getElementById(cursorId)) {
                    const cursor = document.createElement('div');
                    cursor.id = cursorId;
                    cursor.setAttribute('aria-hidden', 'true');
                    document.documentElement.appendChild(cursor);
                }
            },
            {
                styleId: VISUAL_CURSOR_STYLE_ID,
                cursorId: VISUAL_CURSOR_ELEMENT_ID,
                rootClass: VISUAL_CURSOR_ROOT_CLASS,
            },
        );
    } catch {
        // Overlay best effort.
    }
}

export async function syncVisualCursorOverlay(page: Page, point: Point, clicking: boolean = false): Promise<void> {
    if (page.isClosed() || isMobilePage(page) || config.browserEngine === 'camoufox') {
        return;
    }

    await ensureVisualCursorOverlay(page);

    try {
        await page.evaluate(
            ({ cursorId, x, y, clickingNow }) => {
                const cursor = document.getElementById(cursorId);
                if (!cursor) {
                    return;
                }
                cursor.style.left = `${Math.round(x)}px`;
                cursor.style.top = `${Math.round(y)}px`;
                if (clickingNow) {
                    cursor.setAttribute('data-clicking', 'true');
                } else {
                    cursor.removeAttribute('data-clicking');
                }
            },
            {
                cursorId: VISUAL_CURSOR_ELEMENT_ID,
                x: point.x,
                y: point.y,
                clickingNow: clicking,
            },
        );
    } catch {
        // Overlay best effort.
    }
}

export async function enableVisualCursorOverlay(page: Page): Promise<void> {
    await ensureVisualCursorOverlay(page);
}

/**
 * Rimuove TUTTI gli overlay iniettati dal bot (cursore visuale, input block, toast, stile cursor:none).
 * Usato da waitForManualLogin per restituire il controllo completo all'utente.
 * Conosce gli ID dinamici generati da crypto.randomBytes — a differenza di ID hardcoded.
 */
export async function removeAllOverlays(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate(
            ({ styleId, cursorId, rootClass, overlayId, toastId }) => {
                // Rimuovi la regola CSS cursor:none dal documento
                const style = document.getElementById(styleId);
                if (style) style.remove();
                // Rimuovi la classe root che attiva cursor:none
                document.documentElement.classList.remove(rootClass);
                // Rimuovi il cursore visuale (pallino verde)
                const cursor = document.getElementById(cursorId);
                if (cursor) cursor.remove();
                // Rimuovi l'overlay input block
                const overlay = document.getElementById(overlayId);
                if (overlay) overlay.remove();
                // Rimuovi il toast "Automazione in corso"
                const toast = document.getElementById(toastId);
                if (toast) toast.remove();
            },
            {
                styleId: VISUAL_CURSOR_STYLE_ID,
                cursorId: VISUAL_CURSOR_ELEMENT_ID,
                rootClass: VISUAL_CURSOR_ROOT_CLASS,
                overlayId: INPUT_BLOCK_OVERLAY_ID,
                toastId: INPUT_BLOCK_TOAST_ID,
            },
        );
    } catch {
        // Best effort — page might be navigating
    }
}

export async function pulseVisualCursorOverlay(page: Page): Promise<void> {
    const point = pageMouseState.get(page);
    if (!point || page.isClosed() || isMobilePage(page) || config.browserEngine === 'camoufox') {
        return;
    }

    await syncVisualCursorOverlay(page, point, true);
    await page.waitForTimeout(90).catch(() => null);
    await syncVisualCursorOverlay(page, point, false);
}
