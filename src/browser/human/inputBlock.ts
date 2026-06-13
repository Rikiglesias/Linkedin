/**
 * browser/human/inputBlock.ts
 * ─────────────────────────────────────────────────────────────────
 * Overlay DOM full-screen che blocca click/scroll/tastiera/mouse dell'utente durante
 * l'automazione, + pause/resume per i click e i movimenti del bot, + blockUserInput
 * (entry point). Estratto da humanBehavior.ts (A13, split SRP). Codice VERBATIM.
 * NON-timing comportamentale: i setTimeout (150ms passthrough click, 2500ms toast) sono
 * meccanica UI, non formule anti-ban.
 */

import { Page } from 'playwright';
import { isMobilePage } from '../deviceProfile';
import { initializeMouseState } from './mouseState';
import { enableVisualCursorOverlay } from './cursorOverlay';
import { INPUT_BLOCK_TOAST_ID, INPUT_BLOCK_OVERLAY_ID } from './overlayIds';

/**
 * Inietta un overlay trasparente full-screen che blocca click/tastiera dell'utente.
 * L'overlay ha pointer-events: auto → intercetta i click dell'utente.
 * Prima dei click del bot, chiamare pauseInputBlock() per disabilitarlo temporaneamente.
 * Deve essere ri-iniettato dopo ogni navigazione (il DOM viene distrutto).
 */
export async function ensureInputBlock(page: Page): Promise<void> {
    if (page.isClosed() || isMobilePage(page)) {
        return;
    }

    try {
        await page.evaluate(
            ({ toastId, overlayId }) => {
                // Overlay full-screen trasparente che blocca click + scroll + keyboard utente
                if (!document.getElementById(overlayId)) {
                    const overlay = document.createElement('div');
                    overlay.id = overlayId;
                    overlay.style.cssText = [
                        'position: fixed',
                        'top: 0',
                        'left: 0',
                        'right: 0',
                        'bottom: 0',
                        'z-index: 2147483645',
                        'background: transparent',
                        'pointer-events: auto',
                        'cursor: none',
                    ].join(';');
                    document.documentElement.appendChild(overlay);

                    // Nasconde il cursore nativo su TUTTO il documento e TUTTI gli elementi.
                    // Un semplice cursor:none su body non basta — elementi con cursor:pointer
                    // (link, bottoni) lo sovrascrivono. Lo style !important copre tutto.
                    const cursorStyle = document.createElement('style');
                    cursorStyle.id = overlayId + '-cursor';
                    cursorStyle.textContent = '*, *::before, *::after { cursor: none !important; }';
                    document.head.appendChild(cursorStyle);
                    document.documentElement.style.cursor = 'none';
                    if (document.body) document.body.style.cursor = 'none';

                    // Blocca TUTTI gli eventi utente: scroll, keyboard, touch, click, mousemove
                    const blockEvent = (e: Event) => {
                        const ov = document.getElementById(overlayId);
                        if (ov && ov.dataset.botClicking === 'true') return;
                        e.preventDefault();
                        e.stopPropagation();
                    };
                    // mousemove: blocca quando l'utente muove il mouse fisico (no flag bot).
                    // Quando il bot muove il mouse, setta dataset.botMoving='true' → handler lascia passare.
                    // stopImmediatePropagation: blocca ANCHE listener registrati da LinkedIn sullo stesso nodo.
                    const blockMouseMove = (e: Event) => {
                        const ov = document.getElementById(overlayId);
                        if (ov && (ov.dataset.botClicking === 'true' || ov.dataset.botMoving === 'true')) return;
                        e.preventDefault();
                        e.stopImmediatePropagation();
                    };
                    const blockOpts = { capture: true, passive: false } as AddEventListenerOptions;
                    overlay.addEventListener('wheel', blockEvent, blockOpts);
                    overlay.addEventListener('touchmove', blockEvent, blockOpts);
                    overlay.addEventListener('keydown', blockEvent, blockOpts);
                    overlay.addEventListener('keyup', blockEvent, blockOpts);
                    overlay.addEventListener('keypress', blockEvent, blockOpts);
                    // Blocca click utente (mousedown/up/click arrivano all'overlay via pointer-events:auto)
                    overlay.addEventListener('mousedown', blockEvent, blockOpts);
                    overlay.addEventListener('mouseup', blockEvent, blockOpts);
                    overlay.addEventListener('click', blockEvent, blockOpts);
                    overlay.addEventListener('dblclick', blockEvent, blockOpts);
                    overlay.addEventListener('contextmenu', blockEvent, blockOpts);
                    // Blocca mousemove/mouseover sull'overlay (impedisce che LinkedIn veda il mouse utente)
                    overlay.addEventListener('mousemove', blockMouseMove, blockOpts);
                    overlay.addEventListener('mouseover', blockMouseMove, blockOpts);
                    overlay.addEventListener('mouseenter', blockMouseMove, blockOpts);
                    // Document-level: blocca scroll + click + mousemove ovunque (cattura eventi che bypassano overlay)
                    document.addEventListener('wheel', blockEvent, blockOpts);
                    document.addEventListener('touchmove', blockEvent, blockOpts);
                    document.addEventListener('mousedown', blockEvent, blockOpts);
                    document.addEventListener('mouseup', blockEvent, blockOpts);
                    document.addEventListener('click', blockEvent, blockOpts);
                    document.addEventListener('dblclick', blockEvent, blockOpts);
                    document.addEventListener('contextmenu', blockEvent, blockOpts);
                    // Document-level mousemove: blocca il mouse dell'utente anche se bypassa l'overlay
                    document.addEventListener('mousemove', blockMouseMove, blockOpts);
                    document.addEventListener('mouseover', blockMouseMove, blockOpts);
                    document.addEventListener('mouseenter', blockMouseMove, blockOpts);
                }

                // Toast notifica
                if (!document.getElementById(toastId)) {
                    const toast = document.createElement('div');
                    toast.id = toastId;
                    toast.textContent = 'Automazione in corso — input bloccato';
                    toast.style.cssText = [
                        'position: fixed',
                        'bottom: 20px',
                        'left: 50%',
                        'transform: translateX(-50%)',
                        'background: rgba(0,0,0,0.85)',
                        'color: #fff',
                        'padding: 8px 18px',
                        'border-radius: 8px',
                        'font: 13px/1.4 system-ui, sans-serif',
                        'z-index: 2147483647',
                        'pointer-events: none',
                        'opacity: 0',
                        'transition: opacity 300ms ease',
                    ].join(';');
                    document.documentElement.appendChild(toast);

                    let hideTimer: ReturnType<typeof setTimeout> | null = null;
                    document.addEventListener(
                        'mousedown',
                        () => {
                            toast.style.opacity = '1';
                            if (hideTimer) clearTimeout(hideTimer);
                            hideTimer = setTimeout(() => {
                                toast.style.opacity = '0';
                            }, 2500);
                        },
                        true,
                    );
                }
            },
            { toastId: INPUT_BLOCK_TOAST_ID, overlayId: INPUT_BLOCK_OVERLAY_ID },
        );
    } catch {
        // Best effort.
    }
}

/**
 * Segnala che il bot sta muovendo il mouse (NO cambio pointer-events).
 * I listener lasciano passare gli eventi CDP del bot ma bloccano il mouse fisico dell'utente.
 * Chiamare PRIMA di humanMouseMove/humanMouseMoveToCoords.
 */
export async function pauseInputBlockForMove(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) el.dataset.botMoving = 'true';
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

/**
 * Fine movimento mouse bot. Rimuove il flag botMoving.
 */
export async function resumeInputBlockForMove(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) delete el.dataset.botMoving;
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

/**
 * Disabilita temporaneamente l'overlay di blocco input per CLICK.
 * Breve finestra pointer-events:none (~150ms) per far arrivare il click al target LinkedIn.
 * Chiamare PRIMA di ogni click del bot (smartClick, visionClick).
 */
export async function pauseInputBlock(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.pointerEvents = 'none';
                el.dataset.botClicking = 'true';
                const elRec = el as unknown as Record<string, unknown>;
                const prev = elRec.__restoreTimer as ReturnType<typeof setTimeout> | undefined;
                if (prev) clearTimeout(prev);
                elRec.__restoreTimer = setTimeout(() => {
                    el.style.pointerEvents = 'auto';
                    delete el.dataset.botClicking;
                }, 150);
            }
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

/**
 * Riabilita l'overlay di blocco input dopo il click del bot.
 */
export async function resumeInputBlock(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) {
                const elRec = el as unknown as Record<string, unknown>;
                const prev = elRec.__restoreTimer as ReturnType<typeof setTimeout> | undefined;
                if (prev) clearTimeout(prev);
                el.style.pointerEvents = 'auto';
                delete el.dataset.botClicking;
            }
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

export async function blockUserInput(page: Page): Promise<void> {
    initializeMouseState(page);
    await enableVisualCursorOverlay(page);
    await ensureInputBlock(page);
    // Riapplica WS_EX_TRANSPARENT a TUTTE le finestre del processo browser.
    // Dopo ogni page.goto il browser può creare nuove finestre child che non
    // ereditano il flag — senza questo, il mouse dell'utente le raggiunge.
    try {
        const { reapplyWindowClickThrough } = await import('../windowInputBlock');
        reapplyWindowClickThrough();
    } catch {
        /* best-effort — non blocca se fallisce */
    }
    // Auto-dismiss overlay LinkedIn dopo navigazione (via bridge per zero circular dep)
    const { callDismissOverlays } = await import('../overlayBridge');
    await callDismissOverlays(page);
}
