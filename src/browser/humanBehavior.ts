/**
 * browser/humanBehavior.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula comportamento umano nel browser: delay log-normale,
 * movimenti mouse con curva Bézier, digitazione con typo,
 * reading scroll, decoy actions, inter-job delay.
 */

import { Page } from 'playwright';
import { config } from '../config';
import { joinSelectors } from '../selectors';
import { getPageDeviceProfile, isMobilePage } from './deviceProfile';
import { MouseGenerator, Point } from '../ml/mouseGenerator';
import { calculateContextualDelay } from '../ml/timingModel';
import { computeSessionTypoRate, determineNextKeystroke, getWordFlowMultiplier } from '../ai/typoGenerator';
import { shouldMissclick, shouldAccidentalNav, performMissclick, performAccidentalNavigation } from './missclick';
import { dismissKnownOverlays } from './overlayDismisser';
import { randomElement, randomInt } from '../utils/random';

// ─── Stato Memoria Mouse ─────────────────────────────────────────────────────

// Mantiene l'ultima posizione nota del mouse per ogni pagina attiva.
// L'uso di WeakMap assicura l'assenza di memory leak quando la Page viene chiusa.
const pageMouseState = new WeakMap<Page, Point>();
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
                // Overlay full-screen trasparente che blocca click utente
                if (!document.getElementById(overlayId)) {
                    const overlay = document.createElement('div');
                    overlay.id = overlayId;
                    overlay.style.cssText = [
                        'position: fixed',
                        'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
                        'z-index: 2147483645',
                        'background: transparent',
                        'pointer-events: auto',
                    ].join(';');
                    document.documentElement.appendChild(overlay);
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
 * Disabilita temporaneamente l'overlay di blocco input.
 * Chiamare PRIMA di ogni click del bot (smartClick, visionClick).
 */
export async function pauseInputBlock(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
        await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) el.style.pointerEvents = 'none';
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
            if (el) el.style.pointerEvents = 'auto';
        }, INPUT_BLOCK_OVERLAY_ID);
    } catch { /* best effort */ }
}

export async function blockUserInput(page: Page): Promise<void> {
    await enableVisualCursorOverlay(page);
    await ensureInputBlock(page);
    // Auto-dismiss overlay LinkedIn dopo navigazione
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
    try {
        // Chiudi overlay che potrebbero intercettare il click
        await dismissKnownOverlays(page);
        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const finalX = Math.max(0, Math.min(viewport.width - 1, box.x + box.width / 2 + (Math.random() * 8 - 4)));
        const finalY = Math.max(0, Math.min(viewport.height - 1, box.y + box.height / 2 + (Math.random() * 8 - 4)));

        // Camoufox con humanize=true: movimento diretto, Camoufox umanizza a livello C++.
        if (config.browserEngine === 'camoufox' && config.camoufoxHumanize) {
            const distancePixels = Math.hypot(finalX - (pageMouseState.get(page)?.x ?? 0), finalY - (pageMouseState.get(page)?.y ?? 0));
            const steps = Math.max(5, Math.min(15, Math.round(distancePixels / 80)));
            await page.mouse.move(finalX, finalY, { steps });
            updateMouseState(page, { x: finalX, y: finalY });
            return;
        }

        const startPoint = getStartingPoint(page);

        const distancePixels = Math.hypot(finalX - startPoint.x, finalY - startPoint.y);
        // Più step = movimento più fluido e meno scattoso
        const steps = Math.max(20, Math.round(distancePixels / 12));
        const isSmallTarget = box.width < 20 || box.height < 20;

        const path = MouseGenerator.generatePath(
            startPoint,
            { x: finalX, y: finalY },
            steps,
        );

        const approachStart = isSmallTarget ? Math.floor(path.length * 0.7) : Math.floor(path.length * 0.85);
        for (let i = 0; i < path.length; i++) {
            const point = path[i];
            if (!point) continue;
            await page.mouse.move(point.x, point.y, { steps: 1 });
            await syncVisualCursorOverlay(page, point);

            // Pause più frequenti e più lunghe per movimento naturale
            if (i % 3 === 0) {
                const inApproachPhase = i >= approachStart;
                const delay = inApproachPhase ? 20 + Math.random() * 50 : 12 + Math.random() * 25;
                await page.waitForTimeout(delay);
            }
        }
        if (shouldMissclick('navigation')) {
            await performMissclick(page, finalX, finalY);
        }

        updateMouseState(page, { x: finalX, y: finalY });
    } catch {
        // Ignora silenziosamente
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
    try {
        // Camoufox con humanize=true umanizza i movimenti a livello C++ (curve, jitter, tremor).
        // Il nostro Bézier path è ridondante e causa: doppio cursore, lentezza, pattern innaturale.
        // Con Camoufox: movimento diretto con pochi step — Camoufox aggiunge naturalezza internamente.
        if (config.browserEngine === 'camoufox' && config.camoufoxHumanize) {
            const startPoint = getStartingPoint(page);
            const distancePixels = Math.hypot(targetX - startPoint.x, targetY - startPoint.y);
            const steps = Math.max(5, Math.min(15, Math.round(distancePixels / 80)));
            await page.mouse.move(targetX, targetY, { steps });
            updateMouseState(page, { x: targetX, y: targetY });
            return;
        }

        const startPoint = getStartingPoint(page);

        const distancePixels = Math.hypot(targetX - startPoint.x, targetY - startPoint.y);
        const steps = Math.max(20, Math.round(distancePixels / 12));

        const path = MouseGenerator.generatePath(
            startPoint,
            { x: targetX, y: targetY },
            steps,
        );

        for (let i = 0; i < path.length; i++) {
            const point = path[i];
            if (!point) continue;
            await page.mouse.move(point.x, point.y, { steps: 1 });
            await syncVisualCursorOverlay(page, point);

            // Pause più frequenti per movimento più fluido
            if (i % 3 === 0) {
                await page.waitForTimeout(12 + Math.random() * 25);
            }
        }
        updateMouseState(page, { x: targetX, y: targetY });
    } catch {
        // Best effort
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
        const startPoint = getStartingPoint(page);
        const startX = startPoint.x;
        const startY = startPoint.y;

        const endX = Math.random() * viewport.width;
        const endY = Math.random() * viewport.height;

        await page.mouse.move(startX, startY, { steps: 6 });
        await syncVisualCursorOverlay(page, { x: startX, y: startY });
        await page.waitForTimeout(30 + Math.random() * 80);

        const midX = startX + (endX - startX) * 0.5 + (Math.random() * 20 - 10);
        const midY = startY + (endY - startY) * 0.5 + (Math.random() * 20 - 10);
        await page.mouse.move(midX, midY, { steps: 5 });
        await syncVisualCursorOverlay(page, { x: midX, y: midY });
        await page.waitForTimeout(20 + Math.random() * 60);

        if (Math.random() < 0.14) {
            const overshootX = endX + (Math.random() * 24 - 12);
            const overshootY = endY + (Math.random() * 18 - 9);
            await page.mouse.move(overshootX, overshootY, { steps: 6 });
            await syncVisualCursorOverlay(page, { x: overshootX, y: overshootY });
            await page.waitForTimeout(20 + Math.random() * 60);
        }
        await page.mouse.move(endX, endY, { steps: 8 });
        await syncVisualCursorOverlay(page, { x: endX, y: endY });
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

        await page.evaluate((ts) => {
            const origVis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
                ?? Object.getOwnPropertyDescriptor(document, 'visibilityState');
            const origHid = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
                ?? Object.getOwnPropertyDescriptor(document, 'hidden');
            (window as unknown as Record<string, unknown>).__origVisDesc = origVis;
            (window as unknown as Record<string, unknown>).__origHidDesc = origHid;
            Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
            Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
            window.dispatchEvent(new Event('blur', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        const awayTime = Math.max(3000, Math.min(maxAwayTimeMs, 3000 + Math.random() * maxAwayTimeMs));
        await page.waitForTimeout(awayTime);

        await page.evaluate((ts) => {
            const w = window as unknown as Record<string, unknown>;
            const origVis = w.__origVisDesc as PropertyDescriptor | undefined;
            const origHid = w.__origHidDesc as PropertyDescriptor | undefined;
            if (origVis) {
                Object.defineProperty(document, 'visibilityState', origVis);
            } else {
                Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
            }
            if (origHid) {
                Object.defineProperty(document, 'hidden', origHid);
            } else {
                Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
            }
            delete w.__origVisDesc;
            delete w.__origHidDesc;
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
            if (charIndex > currentWordLen) {
                charIndex = 1;
                currentWordIdx++;
                currentWordMultiplier = currentWordIdx < words.length
                    ? getWordFlowMultiplier(words[currentWordIdx])
                    : 1.0;
            }
        }

        // AD-11: Implementazione Delay Bimodale + context-aware per lunghezza testo
        // + Typing Flow State (6.3): parole comuni più veloci, parole rare più lente
        const isSpaceOrPunctuation = /[\s.,!?-]/.test(typedChar);
        const rawDelay = isSpaceOrPunctuation ? Math.floor(Math.random() * 150) + 150 : Math.floor(Math.random() * 50) + 40;
        const delayBase = Math.round(rawDelay * lengthSlowFactor * currentWordMultiplier);

        await element.pressSequentially(typedChar, { delay: delayBase });

        if (isTypo) {
            await page.waitForTimeout(280 + Math.random() * 420);
            await element.press('Backspace');
            await page.waitForTimeout(180 + Math.random() * 250);

            // Per la correzione usiamo un delay di entità intermedia
            await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
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

async function runDecoyStep(page: Page, step: DecoyStep): Promise<void> {
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
        const term = randomElement(DECOY_SEARCH_TERMS);
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

export async function performDecoyBurst(page: Page): Promise<void> {
    const baseSteps: DecoyStep[] = ['feed', 'notifications', 'network', 'search', 'back'];
    const steps = shuffle(baseSteps).slice(0, randomInt(2, 4));
    for (const step of steps) {
        await runDecoyStep(page, step).catch(() => null);
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

export async function performDecoyAction(page: Page): Promise<void> {
    const terms = DECOY_SEARCH_TERMS;
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
            const { interactWithFeed } = await import('./organicContent');
            await interactWithFeed(page, 0.20);
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
        await decoy();
    } catch {
        // Ignora silenziosamente — è solo noise decoy
    }
}

type CanaryWorkflow = 'all' | 'invite' | 'check' | 'message';

interface SelectorCanaryStepDefinition {
    id: string;
    url: string;
    selectors: string[];
    required: boolean;
    timeoutMs?: number;
}

export interface SelectorCanaryStepResult {
    id: string;
    url: string;
    required: boolean;
    ok: boolean;
    matchedSelector: string | null;
    error: string | null;
}

export interface SelectorCanaryReport {
    workflow: CanaryWorkflow;
    ok: boolean;
    criticalFailed: number;
    optionalFailed: number;
    steps: SelectorCanaryStepResult[];
}

function buildSelectorCanaryPlan(workflow: CanaryWorkflow): SelectorCanaryStepDefinition[] {
    const plan: SelectorCanaryStepDefinition[] = [
        {
            id: 'feed.global_nav',
            url: 'https://www.linkedin.com/feed/',
            selectors: [joinSelectors('globalNav')],
            required: true,
            timeoutMs: 4000,
        },
    ];

    if (workflow === 'all' || workflow === 'invite') {
        plan.push({
            id: 'invite.search_surface',
            url: 'https://www.linkedin.com/search/results/people/?keywords=manager',
            selectors: [joinSelectors('connectButtonPrimary'), 'a[href*="/in/"]'],
            required: false,
            timeoutMs: 3000,
        });
    }

    if (workflow === 'all' || workflow === 'message') {
        plan.push({
            id: 'message.inbox_surface',
            url: 'https://www.linkedin.com/messaging/',
            selectors: [
                '.msg-conversations-container',
                '.msg-overlay-list-bubble',
                '[data-control-name="compose_message"]',
            ],
            required: false,
            timeoutMs: 3000,
        });
    }

    if (workflow === 'all' || workflow === 'check') {
        plan.push({
            id: 'check.network_surface',
            url: 'https://www.linkedin.com/mynetwork/',
            selectors: [
                'a[href*="/mynetwork/invitation-manager/"]',
                joinSelectors('invitePendingIndicators'),
                joinSelectors('globalNav'),
            ],
            required: false,
            timeoutMs: 3000,
        });
    }

    return plan;
}

async function evaluateCanaryStep(page: Page, step: SelectorCanaryStepDefinition): Promise<SelectorCanaryStepResult> {
    try {
        await page.goto(step.url, { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 800, 1600);

        for (const selector of step.selectors) {
            const normalized = selector.trim();
            if (!normalized) continue;
            const playwrightSelector = normalized.startsWith('//') ? `xpath=${normalized}` : normalized;
            try {
                await page.waitForSelector(playwrightSelector, { timeout: step.timeoutMs ?? 3000 });
                return {
                    id: step.id,
                    url: step.url,
                    required: step.required,
                    ok: true,
                    matchedSelector: normalized,
                    error: null,
                };
            } catch {
                // Try next candidate selector.
            }
        }

        return {
            id: step.id,
            url: step.url,
            required: step.required,
            ok: false,
            matchedSelector: null,
            error: 'selector_not_found',
        };
    } catch (error) {
        return {
            id: step.id,
            url: step.url,
            required: step.required,
            ok: false,
            matchedSelector: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function runSelectorCanaryDetailed(
    page: Page,
    workflow: CanaryWorkflow = 'all',
): Promise<SelectorCanaryReport> {
    const plan = buildSelectorCanaryPlan(workflow);
    const steps: SelectorCanaryStepResult[] = [];

    for (const step of plan) {
        steps.push(await evaluateCanaryStep(page, step));
    }

    const criticalFailed = steps.filter((step) => step.required && !step.ok).length;
    const optionalFailed = steps.filter((step) => !step.required && !step.ok).length;
    return {
        workflow,
        ok: criticalFailed === 0,
        criticalFailed,
        optionalFailed,
        steps,
    };
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    const report = await runSelectorCanaryDetailed(page, 'all');
    return report.ok;
}
