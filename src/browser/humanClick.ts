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
        // Pre-click non uniforme (right-skew): un umano non aspetta esattamente 30ms prima di
        // cliccare. random*random = distribuzione asimmetrica verso valori bassi, coda variabile.
        await page.waitForTimeout(40 + Math.floor(Math.random() * Math.random() * 220));
        await page.mouse.click(x, y, { delay: 40 + Math.floor(Math.random() * 70) });
    } finally {
        await resumeInputBlock(page);
    }
}

/** Campione gaussiano standard N(0,1) via Box-Muller (guardia su log(0)). */
function gaussianStd(): number {
    let u1 = Math.random();
    const u2 = Math.random();
    if (u1 < 1e-9) u1 = 1e-9;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function buildHumanClickPoint(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
    // Dispersione GAUSSIANA 2D attorno al centro su ENTRAMBI gli assi (sigma ~18% della
    // dimensione), MAI collassata a 0. Il vecchio jitter uniforme cap 3px/2px con jitterY=0
    // sotto i 40px di altezza dava coordinata Y costante al pixel sui bottoni Connetti/Invia
    // (~32-36px) = firma robotica netta. Offset clampato a ±42% per restare DENTRO il target.
    const sigmaX = Math.max(2, box.width * 0.18);
    const sigmaY = Math.max(2, box.height * 0.18);
    const clampX = box.width * 0.42;
    const clampY = box.height * 0.42;
    const offX = Math.max(-clampX, Math.min(clampX, gaussianStd() * sigmaX));
    const offY = Math.max(-clampY, Math.min(clampY, gaussianStd() * sigmaY));
    return {
        x: box.x + box.width / 2 + offX,
        y: box.y + box.height / 2 + offY,
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
