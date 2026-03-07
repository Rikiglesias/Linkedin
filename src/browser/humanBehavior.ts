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
import { isMobilePage } from './deviceProfile';
import { MouseGenerator, Point } from '../ml/mouseGenerator';
import { calculateContextualDelay } from '../ml/timingModel';
import { determineNextKeystroke } from '../ai/typoGenerator';
import { interactWithFeed } from './organicContent';

// ─── Stato Memoria Mouse ─────────────────────────────────────────────────────

// Mantiene l'ultima posizione nota del mouse per ogni pagina attiva.
// L'uso di WeakMap assicura l'assenza di memory leak quando la Page viene chiusa.
const pageMouseState = new WeakMap<Page, Point>();
import crypto from 'crypto';

const _cursorHex = crypto.randomBytes(8).toString('hex');
const VISUAL_CURSOR_STYLE_ID = `__lk_style_${_cursorHex}__`;
const VISUAL_CURSOR_ELEMENT_ID = `__lk_cursor_${_cursorHex}__`;
const VISUAL_CURSOR_ROOT_CLASS = `__lk_root_${_cursorHex}__`;

async function ensureVisualCursorOverlay(page: Page): Promise<void> {
    if (page.isClosed() || isMobilePage(page)) {
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
    if (page.isClosed() || isMobilePage(page)) {
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

export async function pulseVisualCursorOverlay(page: Page): Promise<void> {
    const point = pageMouseState.get(page);
    if (!point || page.isClosed() || isMobilePage(page)) {
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

// ─── Utility Generali ────────────────────────────────────────────────────────

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * Pausa con distribuzione log-normale asimmetrica (Cronometria Disfasica):
 * modella il timing umano con picchi veloci e occasionali distrazioni (long-tail).
 */
export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const rawDelay = calculateContextualDelay({
        actionType: 'read',
        baseMin: min,
        baseMax: max,
    });

    // Smooth asymmetric application
    const asymmetricDelay = Math.random() < 0.15 ? rawDelay * (1.5 + Math.random()) : rawDelay;
    const delay = Math.round(Math.max(min, Math.min(max * 2.5, asymmetricDelay)));
    await page.waitForTimeout(delay);
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
        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        const startPoint = getStartingPoint(page);

        const finalX = box.x + box.width / 2 + (Math.random() * 8 - 4);
        const finalY = box.y + box.height / 2 + (Math.random() * 8 - 4);

        const distancePixels = Math.hypot(finalX - startPoint.x, finalY - startPoint.y);
        const steps = Math.max(15, Math.round(distancePixels / 20));
        const isSmallTarget = box.width < 20 || box.height < 20;

        const path = MouseGenerator.generatePath(
            startPoint,
            { x: finalX, y: finalY },
            steps,
        );

        const approachStart = isSmallTarget ? Math.floor(path.length * 0.8) : path.length;
        for (let i = 0; i < path.length; i++) {
            const point = path[i];
            if (!point) continue;
            await page.mouse.move(point.x, point.y, { steps: 1 });
            await syncVisualCursorOverlay(page, point);

            if (i % 5 === 0) {
                const inApproachPhase = i >= approachStart;
                const delay = inApproachPhase ? 15 + Math.random() * 35 : 10 + Math.random() * 20;
                await page.waitForTimeout(delay);
            }
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
        const startPoint = getStartingPoint(page);

        const distancePixels = Math.hypot(targetX - startPoint.x, targetY - startPoint.y);
        const steps = Math.max(15, Math.round(distancePixels / 20));

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

            // Rallentamenti asincroni tipici
            if (i % 5 === 0) {
                await page.waitForTimeout(10 + Math.random() * 20);
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
        await page.mouse.move(tapX, tapY, { steps: 5 });
        await syncVisualCursorOverlay(page, { x: tapX, y: tapY });
        updateMouseState(page, { x: tapX, y: tapY });
        await page.waitForTimeout(30 + Math.random() * 80);
    } catch {
        // Best effort.
    }
}

/**
 * AD-03: Hover Pre-Click simulation.
 * Simula il comportamento organico di "assestamento" del mouse prima
 * di effettuare il click (Dwell Time). Eseguito con 80% di ratio.
 */
export async function hoverPreClick(page: Page, targetSelector: string): Promise<void> {
    if (isMobilePage(page)) {
        // Su mobile il fall-through non applicherà logiche cursore
        return;
    }

    try {
        // 80% ratio chance di esecuzione
        if (Math.random() > 0.8) {
            return;
        }

        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        // Assicuriamoci che il mouse arrivi / stia sul box organicamente
        await humanMouseMove(page, targetSelector);

        // Hover Time asimmetrico tra i 300 e gli 800ms
        const dwellTime = 300 + Math.random() * 500;

        // Al 50% delle volte, compi una micro-correzione interna al button
        const doMicroCorrection = Math.random() < 0.5;

        if (doMicroCorrection) {
            const splitTime = dwellTime * 0.4;
            // Prima pausa
            await page.waitForTimeout(splitTime);

            // Micro correzione di pochi px
            const currentMouse = getStartingPoint(page);
            const nudgeX = currentMouse.x + (Math.random() * 6 - 3);
            const nudgeY = currentMouse.y + (Math.random() * 4 - 2);

            // Costringe i bounds a stare dentro il target
            const boundedX = Math.max(box.x, Math.min(box.x + box.width, nudgeX));
            const boundedY = Math.max(box.y, Math.min(box.y + box.height, nudgeY));

            await page.mouse.move(boundedX, boundedY, { steps: randomInt(2, 4) });
            await syncVisualCursorOverlay(page, { x: boundedX, y: boundedY });
            updateMouseState(page, { x: boundedX, y: boundedY });

            // Rimanente pausa
            await page.waitForTimeout(dwellTime - splitTime);
        } else {
            // Sosta passiva di puro dwell time
            await page.waitForTimeout(dwellTime);
        }
    } catch {
        // Fall-soft. Se fallisce, il click reale successivo andrà comunque forward.
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

        await page.mouse.move(startX, startY, { steps: 4 });
        await syncVisualCursorOverlay(page, { x: startX, y: startY });
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 10 });
        await syncVisualCursorOverlay(page, { x: endX, y: endY });
        await page.mouse.up();
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

    for (let i = 0; i < text.length; i++) {
        const originalChar = text[i] ?? '';
        const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, 0.035);

        // AD-11: Implementazione Delay Bimodale
        const isSpaceOrPunctuation = /[\s.,!?-]/.test(typedChar);
        const delayBase = isSpaceOrPunctuation ? Math.floor(Math.random() * 150) + 150 : Math.floor(Math.random() * 50) + 40;

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
    }
}

/**
 * Scrolling variabile con 3-7 movimenti, velocità diversa e 30% di probabilità
 * di tornare in cima (comportamento dei lettori reali).
 */
export async function simulateHumanReading(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    const scrollCount = mobile ? 2 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < scrollCount; i++) {
        const deltaY = mobile ? 220 + Math.random() * 420 : 150 + Math.random() * 380;
        await page.evaluate((dy: number) => window.scrollBy({ top: dy, behavior: 'smooth' }), deltaY);
        if (mobile && Math.random() < 0.4) {
            await humanSwipe(page, 'up');
        }
        await humanDelay(page, 700, 2200);

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
 */
export async function interJobDelay(page: Page): Promise<void> {
    const minDelay = Math.max(1, config.interJobMinDelaySec) * 1000;
    const maxDelay = Math.max(config.interJobMinDelaySec, config.interJobMaxDelaySec) * 1000;

    const totalDelay = calculateContextualDelay({
        actionType: 'interJob',
        baseMin: minDelay,
        baseMax: maxDelay,
    });

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

    if (Math.random() < (isMobilePage(page) ? 0.15 : 0.25)) {
        await randomMouseMove(page);
    }

    await page.waitForTimeout(Math.max(0, totalDelay - split));
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
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'network') {
        await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 1200, 2400);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'notifications') {
        await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 1200, 2400);
        return;
    }
    if (step === 'search') {
        const term = randomElement(DECOY_SEARCH_TERMS);
        await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(term)}`, {
            waitUntil: 'domcontentloaded',
        });
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
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
    const actions = [
        async () => {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await simulateHumanReading(page);
            // AD-02: Interviene sul Feed con una probabilità del 20%
            await interactWithFeed(page, 0.20);
        },
        async () => {
            await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
            await humanDelay(page, 2000, 5000);
            await simulateHumanReading(page);
        },
        async () => {
            const search = randomElement(terms);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${search}`, {
                waitUntil: 'domcontentloaded',
            });
            await humanDelay(page, 1500, 4000);
            await simulateHumanReading(page);
        },
        async () => {
            // AD-10: Ondivagous navigation (history.back)
            const historyState = await page.evaluate(() => window.history.length).catch(() => 0);
            if (historyState > 2) {
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await humanDelay(page, 1000, 3000);
                await simulateHumanReading(page);
            } else {
                // Fallback action
                await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
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
