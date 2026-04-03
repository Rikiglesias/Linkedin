import type { Locator, Page } from 'playwright';
import {
    ensureViewportDwell,
    humanMouseMoveToCoords,
    pulseVisualCursorOverlay,
} from './humanBehavior';
import { pauseInputBlock, resumeInputBlock } from './humanBehavior';

export interface HumanLocatorClickOptions {
    selectorForDwell?: string;
    viewportDwellMinMs?: number;
    viewportDwellMaxMs?: number;
    scrollTimeoutMs?: number;
}

export async function clickCoordinatesHumanLike(page: Page, x: number, y: number): Promise<void> {
    await humanMouseMoveToCoords(page, x, y);
    await pulseVisualCursorOverlay(page);
    await pauseInputBlock(page);

    try {
        await page.waitForTimeout(30);
        await page.mouse.click(x, y, { delay: 40 + Math.floor(Math.random() * 70) });
    } finally {
        await resumeInputBlock(page);
    }
}

function buildHumanClickPoint(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
    const maxJitterX = Math.min(3, box.width * 0.15);
    const maxJitterY = box.height < 40 ? 0 : Math.min(2, box.height * 0.15);
    return {
        x: box.x + box.width / 2 + (Math.random() * maxJitterX * 2 - maxJitterX),
        y: box.y + box.height / 2 + (Math.random() * maxJitterY * 2 - maxJitterY),
    };
}

export async function clickLocatorHumanLike(
    page: Page,
    locator: Locator,
    options: HumanLocatorClickOptions = {},
): Promise<void> {
    if (options.selectorForDwell) {
        await ensureViewportDwell(
            page,
            options.selectorForDwell,
            options.viewportDwellMinMs ?? 650,
            options.viewportDwellMaxMs ?? 1400,
        );
    }

    await locator.scrollIntoViewIfNeeded({ timeout: options.scrollTimeoutMs ?? 3000 }).catch(() => null);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error('locator_bounding_box_unavailable');
    }

    const target = buildHumanClickPoint(box);
    await clickCoordinatesHumanLike(page, target.x, target.y);
}
