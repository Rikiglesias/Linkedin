/**
 * browser/humanBehavior.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula comportamento umano nel browser: delay log-normale,
 * movimenti mouse con curva Bézier, digitazione con typo,
 * reading scroll, decoy actions, inter-job delay.
 */

import { Page } from 'playwright';
import { config } from '../config';
// joinSelectors rimosso — ora usato solo in selectorCanary.ts
import { getPageDeviceProfile, isMobilePage } from './deviceProfile';
import { MouseGenerator, Point } from '../ml/mouseGenerator';
import { calculateContextualDelay } from '../ml/timingModel';
import { computeSessionTypoRate, determineNextKeystroke, getWordFlowMultiplier } from '../ai/typoGenerator';
import { shouldAccidentalNav, performAccidentalNavigation } from './missclick';
// dismissKnownOverlays importato dinamicamente per rompere circular dep
// humanBehavior → overlayDismisser → humanBehavior (humanMouseMoveToCoords)
import { randomElement, randomInt } from '../utils/random';

// ─── Stato Memoria Mouse ─────────────────────────────────────────────────────

// Mantiene l'ultima posizione nota del mouse per ogni pagina attiva.
// L'uso di WeakMap assicura l'assenza di memory leak quando la Page viene chiusa.
const pageMouseState = new WeakMap<Page, Point>();

/** Inizializza la posizione mouse per una pagina nuova (centro viewport con varianza).
 *  Evita il pattern rilevabile "mouse entra dal bordo" al primo movimento. */
export function initializeMouseState(page: Page): void {
    if (pageMouseState.has(page)) return;
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const initialX = viewport.width * (0.3 + Math.random() * 0.4);
    const initialY = viewport.height * (0.15 + Math.random() * 0.25);
    pageMouseState.set(page, { x: initialX, y: initialY });
}

/** Timeout globale per movimenti mouse: protegge da hang quando il mouse reale
 *  dell'utente interferisce con Camoufox humanize o il browser perde focus.
 *  Se scade, il movimento viene abortito e il bot prosegue. */
// M32: Configurabile via env var — su browser virtuali o connessioni lente, 8s potrebbe non bastare.
const MOUSE_MOVE_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.MOUSE_MOVE_TIMEOUT_MS ?? '8000', 10) || 8_000);

async function withMouseTimeout<T>(fn: () => Promise<T>, page?: Page, targetPoint?: Point, timeoutMs: number = MOUSE_MOVE_TIMEOUT_MS): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
        const result = await Promise.race([
            fn(),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => { timedOut = true; resolve(undefined); }, timeoutMs);
            }),
        ]);
        if (timedOut) {
            // M42: Dopo abort timeout, NON aggiornare pageMouseState al target — il mouse
            // non ha raggiunto la destinazione. Logga warning per monitorare frequenza.
            // Senza questo fix, la prossima azione assumeva che il mouse fosse al target
            // → "teletrasporto" rilevabile.
            console.warn(`[MOUSE] Timeout ${timeoutMs}ms raggiunto — mouse NON al target, procedendo dalla posizione attuale`);
            // Non aggiornare pageMouseState — resta all'ultima posizione nota
        } else if (page && targetPoint) {
            // Movimento completato con successo: aggiorna posizione
            pageMouseState.set(page, targetPoint);
        }
        return result;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
import crypto from 'crypto';

const _cursorHex = crypto.randomBytes(8).toString('hex');
const VISUAL_CURSOR_STYLE_ID = `__lk_style_${_cursorHex}__`;
const VISUAL_CURSOR_ELEMENT_ID = `__lk_cursor_${_cursorHex}__`;
const VISUAL_CURSOR_ROOT_CLASS = `__lk_root_${_cursorHex}__`;

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

async function syncVisualCursorOverlay(page: Page, point: Point, clicking: boolean = false): Promise<void> {
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

/**
 * Attende che l'utente completi il login manualmente nel browser.
 * Funzione condivisa — usata da syncSearchWorkflow, salesNavigatorSync, e come modello
 * per waitForManualLogin in bulkSaveOrchestrator (che ha logica aggiuntiva con setInputBlockSuspended).
 *
 * 1. Rimuove TUTTI gli overlay (cursore, input block, toast) → l'utente ha pieno controllo
 * 2. Polling ogni 4-6s con isLoggedIn()
 * 3. Timeout configurabile (default 3 minuti)
 * 4. Ritorna true se login completato, false se timeout
 */
export async function awaitManualLogin(
    page: Page,
    context: string,
    options?: { timeoutMs?: number },
): Promise<boolean> {
    const maxWaitMs = options?.timeoutMs ?? 3 * 60 * 1000;
    const startTime = Date.now();

    await removeAllOverlays(page);
    releaseMouseConfinement();

    console.warn(`[${context}] Sessione non autenticata — in attesa del login manuale nel browser...`);
    console.warn(`[${context}] URL: ${page.url()}`);
    console.warn(`[${context}] Hai ${Math.round(maxWaitMs / 60_000)} minuti per completare il login.`);

    while (Date.now() - startTime < maxWaitMs) {
        await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));
        try {
            if (page.isClosed()) return false;
            const { isLoggedIn: checkIsLoggedIn } = await import('./auth');
            if (await checkIsLoggedIn(page)) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`[${context}] Login completato dopo ${elapsed}s.`);
                await humanDelay(page, 1500, 2500);
                return true;
            }
        } catch {
            // isLoggedIn può fallire durante navigazione — riprova
        }
        const remaining = Math.round((maxWaitMs - (Date.now() - startTime)) / 1000);
        if (remaining > 0) {
            console.log(`[${context}] Ancora in attesa del login... (${remaining}s rimanenti)`);
        }
    }

    console.error(`[${context}] Timeout: login manuale non completato entro ${Math.round(maxWaitMs / 60_000)} minuti.`);
    return false;
}

// ─── Input Blocking Overlay ──────────────────────────────────────────────────

const INPUT_BLOCK_TOAST_ID = `__lk_toast_${_cursorHex}__`;
const INPUT_BLOCK_OVERLAY_ID = `__lk_block_${_cursorHex}__`;

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
                        'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
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
                    document.addEventListener('mousedown', () => {
                        toast.style.opacity = '1';
                        if (hideTimer) clearTimeout(hideTimer);
                        hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
                    }, true);
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
    } catch { /* best effort */ }
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
    } catch { /* best effort */ }
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
    } catch { /* best effort */ }
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
    } catch { /* best effort */ }
}

/**
 * Funzione di rilascio cursore (no-op dopo rimozione ClipCursor).
 * Mantenuta per retrocompatibilità — chiamata da awaitManualLogin, closeBrowser, SIGINT.
 */
export function releaseMouseConfinement(): void {
    // No-op: il confinamento ClipCursor è stato rimosso.
    // L'isolamento mouse è gestito interamente via CSS overlay nel browser.
}

export async function blockUserInput(page: Page): Promise<void> {
    initializeMouseState(page);
    await enableVisualCursorOverlay(page);
    await ensureInputBlock(page);
    // Auto-dismiss overlay LinkedIn dopo navigazione (dynamic import per circular dep fix)
    const { dismissKnownOverlays } = await import('./overlayDismisser');
    await dismissKnownOverlays(page);
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

/**
 * Ottiene l'attuale o genera un nuovo punto di partenza organico (dai bordi o angoli)
 * per il primissimo movimento nella vista.
 */
function getStartingPoint(page: Page): Point {
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

function updateMouseState(page: Page, point: Point): void {
    pageMouseState.set(page, { x: point.x, y: point.y });
}

// ─── Utility Generali (importate da ../utils/random) ─────────────────────────

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

/**
 * Simula movimenti del mouse con traiettoria curva in 3 tappe prima di
 * arrivare sull'elemento target. Riduce il pattern "click istantaneo".
 */
export async function humanMouseMove(page: Page, targetSelector: string): Promise<void> {
    if (isMobilePage(page)) {
        await humanSwipe(page, 'up');
        return;
    }
    await pauseInputBlockForMove(page);
    try {
        // Chiudi overlay che potrebbero intercettare il click (dynamic import per circular dep fix)
        const { dismissKnownOverlays } = await import('./overlayDismisser');
        await dismissKnownOverlays(page);
        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const finalX = Math.max(0, Math.min(viewport.width - 1, box.x + box.width / 2 + (Math.random() * 8 - 4)));
        const finalY = Math.max(0, Math.min(viewport.height - 1, box.y + box.height / 2 + (Math.random() * 8 - 4)));

        // Movimento mouse multi-fase: drift → approach → overshoot → correction.
        // Un umano reale non va mai diretto al target — prima si muove nell'area generale.
        const startPt = pageMouseState.get(page) ?? getStartingPoint(page);
        const path = MouseGenerator.generateHumanPath(startPt, { x: finalX, y: finalY }, viewport);
        // Delay per punto: ~12-20ms per punto, totale proporzionale al path length
        const baseDelay = Math.max(8, Math.min(20, 300 / path.length));

        await withMouseTimeout(async () => {
            for (const point of path) {
                await page.mouse.move(point.x, point.y);
                const jitter = baseDelay * (0.6 + Math.random() * 0.8);
                await page.waitForTimeout(Math.round(jitter));
            }
        });

        updateMouseState(page, { x: finalX, y: finalY });
    } catch {
        // Ignora silenziosamente
    } finally {
        await resumeInputBlockForMove(page);
    }
}

/**
 * Simula movimento umano generico verso X, Y generiche senza un elemento.
 * Fondamentale per il VisionFallback Layer Z, eviterà i "Mouse Teleport" che
 * innescano flag di bot detection.
 */
export async function humanMouseMoveToCoords(page: Page, targetX: number, targetY: number): Promise<void> {
    if (isMobilePage(page)) {
        await humanSwipe(page, 'up'); // fallback semantico per mobile
        return;
    }
    await pauseInputBlockForMove(page);
    try {
        const startPoint = getStartingPoint(page);
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const path = MouseGenerator.generateHumanPath(startPoint, { x: targetX, y: targetY }, viewport);
        const baseDelay = Math.max(8, Math.min(20, 300 / path.length));

        await withMouseTimeout(async () => {
            for (const point of path) {
                await page.mouse.move(point.x, point.y);
                const jitter = baseDelay * (0.6 + Math.random() * 0.8);
                await page.waitForTimeout(Math.round(jitter));
            }
        });

        updateMouseState(page, { x: targetX, y: targetY });
    } catch {
        // Best effort
    } finally {
        await resumeInputBlockForMove(page);
    }
}

export async function humanTap(page: Page, targetSelector: string): Promise<void> {
    try {
        const locator = page.locator(targetSelector).first();
        const box = await locator.boundingBox();
        if (!box) {
            await locator.click().catch(() => null);
            return;
        }
        const tapX = box.x + box.width / 2 + (Math.random() * 10 - 5);
        const tapY = box.y + box.height / 2 + (Math.random() * 10 - 5);
        if (isMobilePage(page)) {
            // CC-15: Usa TouchEvent su mobile UA per coerenza col fingerprint
            await page.touchscreen.tap(tapX, tapY);
        } else {
            await page.mouse.move(tapX, tapY, { steps: 5 });
        }
        await syncVisualCursorOverlay(page, { x: tapX, y: tapY });
        updateMouseState(page, { x: tapX, y: tapY });
        await page.waitForTimeout(30 + Math.random() * 80);
    } catch {
        // Best effort.
    }
}

export async function humanSwipe(page: Page, direction: 'up' | 'down' = 'up'): Promise<void> {
    try {
        const viewport = page.viewportSize() ?? { width: 390, height: 844 };
        const startPoint = getStartingPoint(page);

        // Su mobile manteniamo la coordinata X organica se possibile, variamo la Y basata sulla gesture
        const startX = startPoint.x;
        const startY =
            direction === 'up'
                ? Math.round(viewport.height * (0.75 + Math.random() * 0.1))
                : Math.round(viewport.height * (0.3 + Math.random() * 0.1));
        const delta = Math.round(viewport.height * (0.2 + Math.random() * 0.2));
        const endY = direction === 'up' ? startY - delta : startY + delta;
        const endX = startX + randomInt(-20, 20);

        if (isMobilePage(page)) {
            // CC-15: Swipe via CDP Touch.* per generare TouchEvent su mobile
            // Playwright non ha un'API swipe nativa, usiamo mouse come fallback
            // ma con touchscreen.tap per start/end per generare almeno touch events
            await page.touchscreen.tap(startX, startY);
            await page.waitForTimeout(50 + Math.random() * 50);
            // Simulate drag via evaluate (touch move sequence)
            await page.evaluate(([sx, sy, ex, ey]) => {
                const target = document.elementFromPoint(sx, sy) ?? document.body;
                target.dispatchEvent(new TouchEvent('touchstart', {
                    touches: [new Touch({ identifier: 1, target, clientX: sx, clientY: sy })],
                    bubbles: true,
                }));
                target.dispatchEvent(new TouchEvent('touchmove', {
                    touches: [new Touch({ identifier: 1, target, clientX: ex, clientY: ey })],
                    bubbles: true,
                }));
                target.dispatchEvent(new TouchEvent('touchend', {
                    changedTouches: [new Touch({ identifier: 1, target, clientX: ex, clientY: ey })],
                    bubbles: true,
                }));
            }, [startX, startY, endX, endY] as [number, number, number, number]);
        } else {
            await page.mouse.move(startX, startY, { steps: 4 });
            await syncVisualCursorOverlay(page, { x: startX, y: startY });
            await page.mouse.down();
            await page.mouse.move(endX, endY, { steps: 10 });
            await syncVisualCursorOverlay(page, { x: endX, y: endY });
            await page.mouse.up();
        }
        updateMouseState(page, { x: endX, y: endY });
        await page.waitForTimeout(120 + Math.random() * 220);
    } catch {
        // Non-bloccante.
    }
}

/**
 * Movimento cursor casuale non legato a click, utile per spezzare pattern
 * durante pause lunghe tra job.
 */
export async function randomMouseMove(page: Page): Promise<void> {
    if (isMobilePage(page)) {
        await humanSwipe(page, Math.random() < 0.8 ? 'up' : 'down');
        return;
    }
    try {
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

        const endX = Math.random() * viewport.width;
        const endY = Math.random() * viewport.height;

        // Movimento principale con curva Bezier (no più move lineari)
        await withMouseTimeout(async () => {
            // Punto intermedio per spezzare il pattern diretto
            const startPt = getStartingPoint(page);
            const midX = startPt.x + (endX - startPt.x) * 0.5 + (Math.random() * 20 - 10);
            const midY = startPt.y + (endY - startPt.y) * 0.5 + (Math.random() * 20 - 10);
            await humanMouseMoveToCoords(page, midX, midY);
            await page.waitForTimeout(20 + Math.random() * 60);

            // Overshoot occasionale (14% — esitazione umana)
            if (Math.random() < 0.14) {
                const overshootX = endX + (Math.random() * 24 - 12);
                const overshootY = endY + (Math.random() * 18 - 9);
                await humanMouseMoveToCoords(page, overshootX, overshootY);
                await page.waitForTimeout(20 + Math.random() * 60);
            }

            await humanMouseMoveToCoords(page, endX, endY);
        });

        updateMouseState(page, { x: endX, y: endY });
    } catch {
        // Non bloccante
    }
}

/**
 * AD-04: Simulazione sfocamento tab (cambio scheda utente).
 * Mockerà attivamente la *Page Visibility API* per dimostrare ai tracker
 * che siamo veri umani che hanno cambiato tab.
 */
export async function simulateTabSwitch(page: Page, maxAwayTimeMs: number): Promise<void> {
    if (isMobilePage(page)) {
        // Su mobile il comportamento multi-tab è meno lineare da tracciare, saltiamo.
        return;
    }

    try {
        const jitter = () => Math.round((Math.random() - 0.5) * 20);

        // H18: Usare solo eventi DOM (blur/focus/visibilitychange) SENZA override
        // di document.visibilityState. Il mock via Object.defineProperty è rilevabile
        // perché: 1) lascia tracce su window (__origVisDesc), 2) configurable:true
        // non è il default del browser, 3) CDP può verificare lo stato reale del tab.
        // I listener JavaScript di LinkedIn reagiscono agli EVENTI, non allo stato —
        // quindi dispatching blur/focus/visibilitychange è sufficiente e non rilevabile.
        await page.evaluate((ts) => {
            window.dispatchEvent(new Event('blur', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        const awayTime = Math.max(3000, Math.min(maxAwayTimeMs, 3000 + Math.random() * maxAwayTimeMs));
        await page.waitForTimeout(awayTime);

        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
            window.dispatchEvent(new Event('focus', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        await page.waitForTimeout(500 + Math.random() * 800);
    } catch {
        // Best effort
    }
}

/**
 * Digita il testo carattere per carattere con delay variabile.
 * Include il 3% di probabilità di errore di battitura + correzione (Backspace).
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
    const element = page.locator(selector).first();
    await element.click();
    await humanDelay(page, 200, 500);

    // Context-aware WPM: testi lunghi → ritmo più lento (affaticamento naturale).
    // Testi brevi (< 30 char): veloce. Medi (30-150): normale. Lunghi (> 150): lento.
    const lengthSlowFactor = text.length <= 30 ? 0.85
        : text.length <= 150 ? 1.0
        : text.length <= 400 ? 1.15
        : 1.3;

    // Typing Flow State (6.3): pre-calcola le parole e i loro flow multiplier.
    // Parole comuni → 0.7x delay (flow state), parole rare → 1.4x delay (pensiero).
    const words = text.split(/(?<=\s)|(?=\s)/);
    let charIndex = 0;
    let currentWordIdx = 0;
    let currentWordMultiplier = words.length > 0 ? getWordFlowMultiplier(words[0]) : 1.0;

    for (let i = 0; i < text.length; i++) {
        const originalChar = text[i] ?? '';
        const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, computeSessionTypoRate());

        // Aggiorna il word flow multiplier quando passiamo a una nuova parola
        charIndex++;
        if (currentWordIdx < words.length) {
            const currentWordLen = words[currentWordIdx].length;
            if (charIndex > currentWordLen && currentWordIdx < words.length - 1) {
                charIndex = 1;
                currentWordIdx++;
                currentWordMultiplier = getWordFlowMultiplier(words[currentWordIdx]);
            }
        }

        // AD-11: Implementazione Delay Bimodale + context-aware per lunghezza testo
        // + Typing Flow State (6.3): parole comuni più veloci, parole rare più lente
        const isSpaceOrPunctuation = /[\s.,!?-]/.test(typedChar);
        const rawDelay = isSpaceOrPunctuation ? Math.floor(Math.random() * 150) + 150 : Math.floor(Math.random() * 50) + 40;
        const delayBase = Math.round(rawDelay * lengthSlowFactor * currentWordMultiplier);

        await element.pressSequentially(typedChar, { delay: delayBase });

        if (isTypo) {
            // H17: Variare il pattern di correzione typo — un umano non corregge
            // sempre allo stesso modo. Pattern fisso = fingerprint rilevabile.
            const correctionStyle = Math.random();
            if (correctionStyle < 0.55) {
                // Stile 1 (55%): Backspace singolo + retype (classico)
                await page.waitForTimeout(280 + Math.random() * 420);
                await element.press('Backspace');
                await page.waitForTimeout(180 + Math.random() * 250);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            } else if (correctionStyle < 0.75) {
                // Stile 2 (20%): Cancella 2-3 char + riscrive (ha visto l'errore tardi)
                const charsBack = Math.min(i, 1 + Math.floor(Math.random() * 2));
                await page.waitForTimeout(350 + Math.random() * 500);
                for (let b = 0; b <= charsBack; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(60 + Math.random() * 80);
                }
                await page.waitForTimeout(200 + Math.random() * 300);
                const retypeFrom = Math.max(0, i - charsBack);
                for (let r = retypeFrom; r <= i; r++) {
                    await element.pressSequentially(text[r] ?? '', { delay: Math.floor(Math.random() * 70) + 50 });
                }
            } else if (correctionStyle < 0.90) {
                // Stile 3 (15%): Ignora l'errore — un umano a volte non se ne accorge
                // (il typo resta nel testo, verrà comunque capito)
            } else {
                // Stile 4 (10%): Seleziona char sbagliato + sovrascrive (Shift+Left → type)
                await page.waitForTimeout(300 + Math.random() * 400);
                await page.keyboard.down('Shift');
                await element.press('ArrowLeft');
                await page.keyboard.up('Shift');
                await page.waitForTimeout(100 + Math.random() * 150);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            }
        }

        if (Math.random() < 0.04) {
            await humanDelay(page, 400, 1100);
        }

        // AB-4: Micro-pause "distrazione" — un umano si distrae durante la digitazione.
        // Ogni ~30 caratteri, 6% di probabilità di una micro-pausa riflessiva.
        if (i > 0 && i % 30 === 0 && Math.random() < 0.06) {
            const distractionType = Math.random();
            if (distractionType < 0.5) {
                // Tipo 1: Pausa lunga "rileggere il testo" (2-5s)
                await page.waitForTimeout(2000 + Math.random() * 3000);
            } else if (distractionType < 0.8) {
                // Tipo 2: Correzione riflessiva — cancella e riscrive ultimi 2-3 char
                const charsToRetype = Math.min(i, 2 + Math.floor(Math.random() * 2));
                for (let b = 0; b < charsToRetype; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(80 + Math.random() * 120);
                }
                await page.waitForTimeout(400 + Math.random() * 600);
                const retypeStart = Math.max(0, i - charsToRetype + 1);
                for (let r = retypeStart; r <= i; r++) {
                    const ch = text[r] ?? '';
                    await element.pressSequentially(ch, { delay: Math.floor(Math.random() * 60) + 50 });
                }
            } else {
                // Tipo 3: Micro-pausa "controllo telefono" (1-3s, nessuna azione)
                await page.waitForTimeout(1000 + Math.random() * 2000);
            }
        }
    }
}

/**
 * Scrolling variabile con 3-7 movimenti, velocità diversa e 30% di probabilità
 * di tornare in cima (comportamento dei lettori reali).
 */
export async function simulateHumanReading(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    const isScrollable = await page.evaluate(() => document.body.scrollHeight > window.innerHeight).catch(() => false);
    if (!isScrollable) return;
    const scrollCount = mobile ? 2 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 5);

    // Scroll a 3 fasi (3.2): simula pattern reale di lettura pagina.
    // Fase 1 "orientation": scroll veloce per orientarsi nella pagina
    // Fase 2 "reading": scroll lento per leggere contenuto interessante
    // Fase 3 "skip": scroll veloce per saltare contenuto non rilevante
    // Transizioni probabilistiche: orientation→reading (60%), reading→skip (40%), skip→reading (30%)
    type ScrollPhase = 'orientation' | 'reading' | 'skip';
    let phase: ScrollPhase = 'orientation';

    for (let i = 0; i < scrollCount; i++) {
        let deltaY: number;
        let delayMin: number;
        let delayMax: number;

        if (mobile) {
            deltaY = 220 + Math.random() * 420;
            delayMin = 700;
            delayMax = 2200;
        } else {
            switch (phase) {
                case 'orientation':
                    deltaY = 400 + Math.random() * 200;  // 400-600px
                    delayMin = 300;
                    delayMax = 800;
                    break;
                case 'reading':
                    deltaY = 100 + Math.random() * 150;  // 100-250px
                    delayMin = 500;
                    delayMax = 2000;
                    break;
                case 'skip':
                    deltaY = 500 + Math.random() * 300;  // 500-800px
                    delayMin = 200;
                    delayMax = 500;
                    break;
            }
        }

        await page.mouse.wheel(0, deltaY);
        if (mobile && Math.random() < 0.4) {
            await humanSwipe(page, 'up');
        }
        await humanDelay(page, delayMin, delayMax);

        // Transizione fase (solo desktop — mobile usa pattern uniforme)
        if (!mobile) {
            const roll = Math.random();
            switch (phase) {
                case 'orientation':
                    phase = roll < 0.60 ? 'reading' : 'orientation';
                    break;
                case 'reading':
                    phase = roll < 0.40 ? 'skip' : 'reading';
                    break;
                case 'skip':
                    phase = roll < 0.30 ? 'reading' : 'skip';
                    break;
            }
        }

        // AD-04: 15% di probabilità di cambiare tab temporaneamente mentre legge
        if (Math.random() < 0.15) {
            await simulateTabSwitch(page, 5000 + Math.random() * 15000);
        }
    }
    if (Math.random() < 0.3) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await humanDelay(page, 500, 1400);
    }
}

/**
 * Pausa randomizzata tra un job e il successivo per evitare il pattern burst.
 * Range: 30–90s base + picco casuale (pausa caffè) con 8% di probabilità.
 * Se il throttleSignal indica rallentamento LinkedIn, moltiplica il delay:
 *   shouldSlow → ×1.5, shouldPause → pausa coffee break forzata 3-5 min.
 */
export async function interJobDelay(
    page: Page,
    throttleSignal?: { shouldSlow: boolean; shouldPause: boolean },
    pacingFactor?: number,
): Promise<void> {
    const minDelay = Math.max(1, config.interJobMinDelaySec) * 1000;
    const maxDelay = Math.max(config.interJobMinDelaySec, config.interJobMaxDelaySec) * 1000;

    let totalDelay = calculateContextualDelay({
        actionType: 'interJob',
        baseMin: minDelay,
        baseMax: maxDelay,
        profileMultiplier: getPageDeviceProfile(page).profileMultiplier,
    });

    // Pacing factor da sessionMemory: dopo challenge recenti il bot rallenta,
    // dopo giorni tranquilli può essere leggermente più veloce.
    // pacingFactor < 1.0 → delay più lungo (inverso: divido per il factor)
    // pacingFactor > 1.0 → delay leggermente più corto
    if (pacingFactor !== undefined && pacingFactor > 0 && pacingFactor !== 1.0) {
        totalDelay = Math.round(totalDelay / pacingFactor);
    }

    // Feedback loop reattivo: LinkedIn rallenta → il bot rallenta automaticamente
    if (throttleSignal?.shouldPause) {
        // Pausa coffee break forzata 3-5 min (LinkedIn è in stato critico)
        totalDelay = (180 + Math.floor(Math.random() * 120)) * 1000;
    } else if (throttleSignal?.shouldSlow) {
        // Moltiplica delay ×1.5 (LinkedIn sta rallentando)
        totalDelay = Math.round(totalDelay * 1.5);
    }

    if (Math.random() < (isMobilePage(page) ? 0.2 : 0.35)) {
        await randomMouseMove(page);
    }

    // AD-04: 40% di chance di "cambiare tab" per distrarsi durante job delay lunghi.
    const willSwitchTab = Math.random() < 0.40;

    const split = Math.floor(totalDelay * (0.4 + Math.random() * 0.2));
    await page.waitForTimeout(Math.max(0, split));

    if (willSwitchTab) {
        await simulateTabSwitch(page, totalDelay * 0.3); // Away per il 30% del delay totale
    }

    if (shouldAccidentalNav('feed')) {
        await performAccidentalNavigation(page);
    }

    // GAP #2: Micro-azione organica interleavata — 20% di probabilità.
    // LinkedIn analizza la diversità di azioni nella sessione.
    // Solo inviti consecutivi = segnale bot. Azioni organiche in mezzo = umano.
    if (Math.random() < 0.20) {
        await performDecoyAction(page);
    }

    if (Math.random() < (isMobilePage(page) ? 0.15 : 0.25)) {
        await randomMouseMove(page);
    }

    await page.waitForTimeout(Math.max(0, totalDelay - split));
}

/**
 * Content-Aware Profile Reading (3.4 fix): funzione UNIFICATA che fa
 * scroll + dwell in un budget di tempo TOTALE proporzionale alla ricchezza
 * del profilo. SOSTITUISCE simulateHumanReading + contextualReadingPause
 * quando siamo su un profilo LinkedIn.
 *
 * Budget totale:
 *   Profilo sparse (solo nome e titolo): 4-8s totali
 *   Profilo medio: 7-14s totali
 *   Profilo ricco (about lungo, molte esperienze): 12-20s totali
 *
 * Include: scroll a fasi, pause di lettura, tab switch occasionale.
 * MAI > 20s per singolo profilo — un umano decide velocemente se connettersi.
 */
export async function computeProfileDwellTime(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    try {
        const profileRichness = await page.evaluate(() => {
            const aboutText = document.querySelector('[id*="about"]')?.textContent?.trim().length ?? 0;
            const experienceItems = document.querySelectorAll('li.artdeco-list__item, [id*="experience"] li').length;
            const totalText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length;
            return { aboutText, experienceItems, totalText };
        });

        const aboutScore = Math.min(1, profileRichness.aboutText / 500);
        const expScore = Math.min(1, profileRichness.experienceItems / 5);
        const textScore = Math.min(1, profileRichness.totalText / 3000);
        const richness = aboutScore * 0.35 + expScore * 0.35 + textScore * 0.30;

        // Budget totale: sparse 4-8s, medio 7-14s, ricco 12-20s
        const budgetMs = 4000 + Math.floor(richness * 12_000) + Math.floor(Math.random() * 4000);
        const startMs = Date.now();

        // Fase 1: scroll veloce (orientation) — 30-40% del budget
        const isScrollable = await page.evaluate(() => document.body.scrollHeight > window.innerHeight).catch(() => false);
        if (isScrollable) {
            const scrollSteps = mobile ? randomInt(1, 3) : randomInt(2, 4);
            for (let i = 0; i < scrollSteps; i++) {
                if (Date.now() - startMs > budgetMs * 0.7) break; // Non sforare il budget
                const deltaY = richness > 0.5
                    ? 100 + Math.random() * 200  // Profilo ricco: scroll lento per leggere
                    : 300 + Math.random() * 300;  // Profilo sparse: scroll veloce
                await page.mouse.wheel(0, deltaY);
                if (mobile && Math.random() < 0.3) await humanSwipe(page, 'up');
                // Pausa tra scroll proporzionale a richness
                const pauseMs = 400 + Math.floor(richness * 1200) + Math.floor(Math.random() * 600);
                await page.waitForTimeout(pauseMs);
            }
        }

        // Fase 2: dwell residuo (lettura + decisione) — tempo restante nel budget
        const elapsed = Date.now() - startMs;
        const remainingMs = Math.max(500, budgetMs - elapsed);
        await page.waitForTimeout(remainingMs);

        // 10% tab switch durante lettura profilo
        if (Math.random() < 0.10) {
            await simulateTabSwitch(page, 2000 + Math.random() * 5000);
        }
    } catch {
        // Fallback: dwell time breve se DOM extraction fallisce
        await page.waitForTimeout(3000 + Math.floor(Math.random() * 5000));
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

type DecoyStep = 'feed' | 'network' | 'notifications' | 'search' | 'back';

function shuffle<T>(items: T[]): T[] {
    const clone = items.slice();
    for (let i = clone.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = clone[i];
        clone[i] = clone[j] as T;
        clone[j] = tmp as T;
    }
    return clone;
}

async function runDecoyStep(page: Page, step: DecoyStep, contextTerms?: readonly string[]): Promise<void> {
    if (step === 'feed') {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'network') {
        await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'notifications') {
        await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        return;
    }
    if (step === 'search') {
        // M15/M16: Se termini context-aware disponibili, usali (70%); altrimenti generici.
        const useContext = contextTerms && contextTerms.length > 0 && Math.random() < 0.70;
        const term = randomElement(useContext ? contextTerms : DECOY_SEARCH_TERMS);
        await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(term)}`, {
            waitUntil: 'domcontentloaded',
        });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await ensureVisualCursorOverlay(page);
    await ensureInputBlock(page);
    await humanDelay(page, 800, 1600);
}

export async function performDecoyBurst(page: Page, contextTerms?: readonly string[]): Promise<void> {
    const baseSteps: DecoyStep[] = ['feed', 'notifications', 'network', 'search', 'back'];
    const steps = shuffle(baseSteps).slice(0, randomInt(2, 4));
    for (const step of steps) {
        await runDecoyStep(page, step, contextTerms).catch(() => null);
    }
}

/**
 * Azioni Diversive Mute (Decoy):
 * naviga in sezioni casuali di LinkedIn prima dei veri task
 * per mascherare pattern lineari da bot.
 */
const DECOY_SEARCH_TERMS: readonly string[] = [
    // Business roles
    'ceo', 'cto', 'cfo', 'coo', 'cmo', 'vp sales', 'vp engineering',
    'head of marketing', 'head of product', 'head of operations',
    'director of sales', 'director of engineering', 'director of hr',
    'product manager', 'program manager', 'account executive',
    'business development', 'chief of staff', 'general manager',
    // Industries
    'fintech', 'saas', 'edtech', 'healthtech', 'biotech', 'cleantech',
    'proptech', 'insurtech', 'agritech', 'legaltech', 'martech',
    'e-commerce', 'cybersecurity', 'artificial intelligence', 'blockchain',
    'renewable energy', 'logistics', 'telecommunications', 'media',
    // Skills
    'project management', 'data analysis', 'cloud computing',
    'machine learning', 'digital marketing', 'ux design', 'ui design',
    'full stack developer', 'devops engineer', 'data scientist',
    'product design', 'agile methodology', 'business intelligence',
    'supply chain management', 'financial analysis', 'content strategy',
    'software architecture', 'sales operations', 'customer success',
    // General professional terms
    'marketing', 'developer', 'sales', 'hr', 'tech', 'design',
    'consultant', 'entrepreneur', 'startup', 'venture capital',
    'growth hacking', 'talent acquisition', 'brand strategy',
    'operations manager', 'frontend developer', 'backend engineer',
    'cloud architect', 'scrum master', 'ux researcher',
] as const;

export async function performDecoyAction(page: Page, contextTerms?: readonly string[]): Promise<void> {
    // M15/M16: Se termini context-aware forniti, mescola con generici (coerenza settore)
    const terms = contextTerms && contextTerms.length > 0
        ? [...contextTerms, ...Array.from(DECOY_SEARCH_TERMS).slice(0, 15)]
        : DECOY_SEARCH_TERMS;
    const reInjectOverlay = async () => {
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
    };
    const actions = [
        async () => {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await simulateHumanReading(page);
            // AD-02: Interviene sul Feed con una probabilità del 20%
            try {
                const { interactWithFeed } = await import('./organicContent');
                await interactWithFeed(page, 0.20);
            } catch {
                // organicContent import/exec fallito — skip decoy interaction
            }
        },
        async () => {
            await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await humanDelay(page, 2000, 5000);
            await simulateHumanReading(page);
        },
        async () => {
            const search = randomElement(terms);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${search}`, {
                waitUntil: 'domcontentloaded',
            });
            await reInjectOverlay();
            await humanDelay(page, 1500, 4000);
            await simulateHumanReading(page);
        },
        async () => {
            // AD-10: Ondivagous navigation (history.back)
            const historyState = await page.evaluate(() => window.history.length).catch(() => 0);
            if (historyState > 2) {
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await reInjectOverlay();
                await humanDelay(page, 1000, 3000);
                await simulateHumanReading(page);
            } else {
                // Fallback action
                await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
                await reInjectOverlay();
                await humanDelay(page, 1200, 2400);
            }
        },
    ];

    try {
        const decoy = randomElement(actions);
        await Promise.race([
            decoy(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Decoy timeout 15s')), 15_000)),
        ]);
    } catch {
        // Ignora silenziosamente — è solo noise decoy
    }
}


// Selector canary (buildSelectorCanaryPlan, evaluateCanaryStep, runSelectorCanaryDetailed, runSelectorCanary)
// estratto in browser/selectorCanary.ts (A17: split file >1000 righe)
