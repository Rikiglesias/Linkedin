/**
 * browser/human/mouseMovement.ts
 * ─────────────────────────────────────────────────────────────────
 * Movimenti mouse umani: withMouseTimeout (guard anti-hang), humanMouseMove
 * (verso selettore), humanMouseMoveToCoords (verso X/Y), randomMouseMove (idle).
 * Estratto da humanBehavior.ts (A13, split SRP). TIMING-CORE — traiettoria Bézier
 * (MouseGenerator.generateHumanPath), durata ∝ legge di Fitts (350 + 90·log2(...)),
 * timing inter-punto log-normale (logNormalDelayMs). Formule copiate VERBATIM:
 * un drift numerico = scatto robotico/teleport rilevabile. NON riscrivere, solo spostare.
 */

import { Page } from 'playwright';
import { MouseGenerator, Point } from '../../ml/mouseGenerator';
import { isMobilePage } from '../deviceProfile';
import { logNormalDelayMs } from '../../utils/random';
import { pageMouseState, getStartingPoint, updateMouseState } from './mouseState';
import { pauseInputBlockForMove, resumeInputBlockForMove } from './inputBlock';
import { humanSwipe } from './touchGestures';

/** Timeout globale per movimenti mouse: protegge da hang quando il mouse reale
 *  dell'utente interferisce con Camoufox humanize o il browser perde focus.
 *  Se scade, il movimento viene abortito e il bot prosegue. */
// M32: Configurabile via env var — su browser virtuali o connessioni lente, 8s potrebbe non bastare.
const MOUSE_MOVE_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.MOUSE_MOVE_TIMEOUT_MS ?? '8000', 10) || 8_000);

async function withMouseTimeout<T>(
    fn: () => Promise<T>,
    page?: Page,
    targetPoint?: Point,
    timeoutMs: number = MOUSE_MOVE_TIMEOUT_MS,
): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
        const result = await Promise.race([
            fn(),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    resolve(undefined);
                }, timeoutMs);
            }),
        ]);
        if (timedOut) {
            // M42: Dopo abort timeout, NON aggiornare pageMouseState al target — il mouse
            // non ha raggiunto la destinazione. Logga warning per monitorare frequenza.
            // Senza questo fix, la prossima azione assumeva che il mouse fosse al target
            // → "teletrasporto" rilevabile.
            console.warn(
                `[MOUSE] Timeout ${timeoutMs}ms raggiunto — mouse NON al target, procedendo dalla posizione attuale`,
            );
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
        // Chiudi overlay che potrebbero intercettare il click (via bridge per zero circular dep)
        const { callDismissOverlays } = await import('../overlayBridge');
        await callDismissOverlays(page);
        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const finalX = Math.max(0, Math.min(viewport.width - 1, box.x + box.width / 2 + (Math.random() * 8 - 4)));
        const finalY = Math.max(0, Math.min(viewport.height - 1, box.y + box.height / 2 + (Math.random() * 8 - 4)));

        // Movimento mouse multi-fase: drift → approach → overshoot → correction.
        // Un umano reale non va mai diretto al target — prima si muove nell'area generale.
        const startPt = pageMouseState.get(page) ?? getStartingPoint(page);
        const path = MouseGenerator.generateHumanPath(startPt, { x: finalX, y: finalY }, viewport);
        // Durata ∝ legge di Fitts (più lontano = più tempo, sub-lineare), NON budget fisso ~300ms
        // (che dava l'OPPOSTO: path lunghi = MENO ms/punto = scatto robotico). Timing inter-punto
        // log-normale (right-skew biometrico), non uniforme (istogramma piatto = firma bot).
        const moveDistPx = Math.hypot(finalX - startPt.x, finalY - startPt.y);
        const moveTotalMs = 350 + 90 * Math.log2(moveDistPx / 40 + 1);
        const baseDelay = Math.max(10, Math.min(45, moveTotalMs / Math.max(1, path.length)));

        await withMouseTimeout(async () => {
            for (const point of path) {
                await page.mouse.move(point.x, point.y);
                const jitter = logNormalDelayMs(baseDelay, 0.35, baseDelay * 0.5, baseDelay * 2);
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
        // Durata ∝ Fitts + timing inter-punto log-normale (vedi humanMouseMove).
        const moveDistPx = Math.hypot(targetX - startPoint.x, targetY - startPoint.y);
        const moveTotalMs = 350 + 90 * Math.log2(moveDistPx / 40 + 1);
        const baseDelay = Math.max(10, Math.min(45, moveTotalMs / Math.max(1, path.length)));

        await withMouseTimeout(async () => {
            for (const point of path) {
                await page.mouse.move(point.x, point.y);
                const jitter = logNormalDelayMs(baseDelay, 0.35, baseDelay * 0.5, baseDelay * 2);
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
