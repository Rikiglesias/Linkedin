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
 * Finestra del watchdog lato pagina che ripristina l'overlay da solo se il processo muore fra la
 * pausa e la ripresa. Il watchdog NON si rimuove (e' l'unica rete quando il bot non torna piu'):
 * si DIMENSIONA sul gesto. A 150 ms fissi tornava opaco A META' del gesto di click — pre-click
 * 40-259 ms + dwell del bottone 40-109 ms, cioe' fino a 368 ms — e l'overlay riattivato
 * intercettava il click del bot stesso. Chi chiama passa la durata massima del PROPRIO gesto piu'
 * un margine; il valore viene comunque clampato, cosi' la finestra in cui il mouse fisico
 * dell'utente puo' raggiungere la pagina resta sotto il secondo anche se un chiamante sbaglia il
 * conto.
 */
export const INPUT_BLOCK_HOLD_MIN_MS = 150;
export const INPUT_BLOCK_HOLD_MAX_MS = 1000;
export const INPUT_BLOCK_HOLD_DEFAULT_MS = 400;

/**
 * L'acquisizione dell'input non e' riuscita: il gesto NON deve partire (fail-closed).
 * Prima questo caso era ingoiato da un `catch {}` — il click partiva con l'overlay ancora opaco,
 * quindi veniva intercettato, e il chiamante lo contava come eseguito.
 */
export class InputBlockAcquireError extends Error {
    readonly reason: 'page_closed' | 'evaluate_failed';
    readonly detail: string;

    constructor(reason: 'page_closed' | 'evaluate_failed', detail = '') {
        super(`input_block_acquire_failed:${reason}${detail ? ` (${detail})` : ''}`);
        this.name = 'InputBlockAcquireError';
        this.reason = reason;
        this.detail = detail;
    }
}

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
            ({ toastId, overlayId, showToast }) => {
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

                    // Lo stato "il bot sta agendo" vive come property JS sull'elemento, NON come
                    // dataset: `el.dataset.x` genera l'attributo `data-x` nell'HTML, cioè una firma
                    // leggibile da LinkedIn (misurata: `data-bot-moving` presente durante il movimento).
                    // Una property JS non compare nel DOM. Stesso pattern già usato per __restoreTimer.
                    const botActing = (): boolean => {
                        const ov = document.getElementById(overlayId) as unknown as Record<string, unknown> | null;
                        return !!ov && (ov.__botClicking === true || ov.__botMoving === true);
                    };
                    // Blocca TUTTI gli eventi utente: scroll, keyboard, touch, click, mousemove.
                    // La via di fuga vale per ENTRAMBI i flag: prima `blockEvent` guardava solo
                    // botClicking, quindi il `wheel` del bot (page.mouse.wheel in simulateHumanReading)
                    // veniva cancellato da preventDefault → la pagina non scrollava MAI (misurato: scrollY 0).
                    const blockEvent = (e: Event) => {
                        if (botActing()) return;
                        e.preventDefault();
                        e.stopPropagation();
                    };
                    // mousemove: blocca quando l'utente muove il mouse fisico (no flag bot).
                    // stopImmediatePropagation: blocca ANCHE listener registrati da LinkedIn sullo stesso nodo.
                    const blockMouseMove = (e: Event) => {
                        if (botActing()) return;
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

                // Toast notifica — OPT-IN (default OFF).
                // Il testo finiva nel DOM della pagina LinkedIn: una stringa fissa e identica fra
                // installazioni identifica il SOFTWARE, non la sessione (misurato dall'harness:
                // "Automazione in corso — input bloccato" leggibile in document.outerHTML).
                // Per riaverlo in sviluppo: SHOW_AUTOMATION_TOAST=true.
                if (showToast && !document.getElementById(toastId)) {
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
            {
                toastId: INPUT_BLOCK_TOAST_ID,
                overlayId: INPUT_BLOCK_OVERLAY_ID,
                showToast: process.env.SHOW_AUTOMATION_TOAST === 'true',
            },
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
            const el = document.getElementById(id) as unknown as Record<string, unknown> | null;
            if (el) el.__botMoving = true;
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

/**
 * Porta UNICA per lo scroll del bot.
 *
 * `page.mouse.wheel` diretto viene cancellato dall'overlay di input-block (che fa
 * preventDefault sul wheel per fermare l'utente fisico e non sa distinguere i due).
 * Chi scrolla senza passare da qui produce zero movimento reale, in silenzio.
 * Misurato con `src/tests/harnessInputBlockEvents.ts`: 0 px prima, 1023 px dopo.
 */
export async function botWheel(page: Page, deltaX: number, deltaY: number): Promise<void> {
    await pauseInputBlockForMove(page);
    try {
        await page.mouse.wheel(deltaX, deltaY);
    } finally {
        await resumeInputBlockForMove(page);
    }
}

/**
 * Fine movimento mouse bot. Rimuove il flag botMoving.
 */
export async function resumeInputBlockForMove(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id) as unknown as Record<string, unknown> | null;
            if (el) delete el.__botMoving;
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

/**
 * Disabilita temporaneamente l'overlay di blocco input per CLICK.
 * Finestra pointer-events:none per far arrivare il click al target LinkedIn; `holdMs` e' la durata
 * MASSIMA del gesto che sta per partire piu' un margine — oltre quella il watchdog lato pagina
 * ripristina l'overlay (rete di sicurezza per il caso in cui il processo muoia prima della ripresa).
 * Chiamare PRIMA di ogni click del bot, e SEMPRE con la ripresa in un `finally`.
 *
 * FAIL-CLOSED: se la pagina e' chiusa o la `evaluate` fallisce lancia `InputBlockAcquireError` — il
 * gesto non deve partire su un input di cui non si ha la proprieta'.
 * Overlay assente (`el` null) NON e' un fallimento: sulle pagine mobile `ensureInputBlock` non lo
 * inietta affatto, e senza overlay non c'e' nulla che possa intercettare il click del bot.
 */
export async function pauseInputBlock(page: Page, holdMs: number = INPUT_BLOCK_HOLD_DEFAULT_MS): Promise<void> {
    const hold = Math.min(INPUT_BLOCK_HOLD_MAX_MS, Math.max(INPUT_BLOCK_HOLD_MIN_MS, Math.round(holdMs)));
    if (page.isClosed()) {
        await segnalaAcquisizioneFallita('page_closed', hold, '');
        throw new InputBlockAcquireError('page_closed');
    }
    try {
        await page.evaluate(
            ({ id, restoreAfterMs }) => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.pointerEvents = 'none';
                    const elRec = el as unknown as Record<string, unknown>;
                    elRec.__botClicking = true;
                    const prev = elRec.__restoreTimer as ReturnType<typeof setTimeout> | undefined;
                    if (prev) clearTimeout(prev);
                    elRec.__restoreTimer = setTimeout(() => {
                        el.style.pointerEvents = 'auto';
                        delete elRec.__botClicking;
                    }, restoreAfterMs);
                }
            },
            { id: INPUT_BLOCK_OVERLAY_ID, restoreAfterMs: hold },
        );
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await segnalaAcquisizioneFallita('evaluate_failed', hold, detail);
        throw new InputBlockAcquireError('evaluate_failed', detail);
    }
}

/**
 * Import dinamico come per `windowInputBlock`/`overlayBridge` piu' sotto: questo modulo e' una
 * primitiva del browser e non deve tirarsi dentro staticamente la telemetria (che passa dal DB).
 * La telemetria non puo' mascherare il fallimento: se anche il log fallisce, l'errore vero passa.
 */
async function segnalaAcquisizioneFallita(
    reason: 'page_closed' | 'evaluate_failed',
    holdMs: number,
    detail: string,
): Promise<void> {
    try {
        const { logWarn } = await import('../../telemetry/logger');
        await logWarn('input_block.acquire_failed', { reason, holdMs, error: detail });
    } catch (errTelemetria) {
        // Ultima risorsa: se anche la telemetria e' rotta l'evento non deve sparire del tutto.
        // Non si rilancia da qui — a fallire davvero e' l'acquisizione, e quell'errore lo alza
        // `pauseInputBlock` al chiamante.
        const causa = errTelemetria instanceof Error ? errTelemetria.message : String(errTelemetria);
        console.warn(
            `[input-block] acquisizione fallita (${reason}, hold ${holdMs} ms): ${detail} — telemetria non disponibile: ${causa}`,
        );
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
                delete elRec.__botClicking;
            }
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch {
        /* best effort */
    }
}

export async function blockUserInput(page: Page): Promise<void> {
    await initializeMouseState(page);
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
