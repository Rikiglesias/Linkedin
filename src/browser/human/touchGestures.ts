/**
 * browser/human/touchGestures.ts
 * ─────────────────────────────────────────────────────────────────
 * Gesture touch/tap umane: humanTap (tap con jitter coordinate + TouchEvent su mobile)
 * e humanSwipe (swipe su/giù via Touch.* su mobile o mouse drag su desktop).
 * Estratto da humanBehavior.ts (A13, split SRP). Codice VERBATIM — le coordinate jitter
 * e i waitForTimeout sono micro-varianza UI: spostati, non riscritti.
 */

import { Page } from 'playwright';
import { isMobilePage } from '../deviceProfile';
import { getStartingPoint, updateMouseState } from './mouseState';
import { syncVisualCursorOverlay } from './cursorOverlay';
import { randomInt } from '../../utils/random';

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
            await page.evaluate(
                ([sx, sy, ex, ey]) => {
                    const target = document.elementFromPoint(sx, sy) ?? document.body;
                    target.dispatchEvent(
                        new TouchEvent('touchstart', {
                            touches: [new Touch({ identifier: 1, target, clientX: sx, clientY: sy })],
                            bubbles: true,
                        }),
                    );
                    target.dispatchEvent(
                        new TouchEvent('touchmove', {
                            touches: [new Touch({ identifier: 1, target, clientX: ex, clientY: ey })],
                            bubbles: true,
                        }),
                    );
                    target.dispatchEvent(
                        new TouchEvent('touchend', {
                            changedTouches: [new Touch({ identifier: 1, target, clientX: ex, clientY: ey })],
                            bubbles: true,
                        }),
                    );
                },
                [startX, startY, endX, endY] as [number, number, number, number],
            );
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
