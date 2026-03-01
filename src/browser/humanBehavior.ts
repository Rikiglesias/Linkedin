/**
 * browser/humanBehavior.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula comportamento umano nel browser: delay log-normale,
 * movimenti mouse con curva Bézier, digitazione con typo,
 * reading scroll, decoy actions, inter-job delay.
 */

import { Page } from 'playwright';
import { joinSelectors } from '../selectors';

// ─── Log-normale (Box-Muller) ─────────────────────────────────────────────────

function randomLogNormal(mean: number, stdDev: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const mu = Math.log(mean) - 0.5 * Math.log(1 + (stdDev / mean) ** 2);
    const sigma = Math.sqrt(Math.log(1 + (stdDev / mean) ** 2));
    return Math.exp(mu + sigma * z);
}

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * Pausa con distribuzione log-normale asimmetrica (Cronometria Disfasica):
 * modella il timing umano con picchi veloci e occasionali distrazioni (long-tail).
 */
export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const mean = min + (max - min) * 0.35;
    const std = (max - min) / 3;
    const raw = randomLogNormal(mean, std);
    const asymmetricDelay = Math.random() < 0.15 ? raw * (1.5 + Math.random()) : raw;
    const delay = Math.round(Math.max(min, Math.min(max * 2.5, asymmetricDelay)));
    await page.waitForTimeout(delay);
}

/**
 * Simula movimenti del mouse con traiettoria curva in 3 tappe prima di
 * arrivare sull'elemento target. Riduce il pattern "click istantaneo".
 */
export async function humanMouseMove(page: Page, targetSelector: string): Promise<void> {
    try {
        const box = await page.locator(targetSelector).first().boundingBox();
        if (!box) return;

        const startX = 100 + Math.random() * 300;
        const startY = 100 + Math.random() * 200;
        await page.mouse.move(startX, startY, { steps: 10 });
        await page.waitForTimeout(40 + Math.random() * 80);

        const curveFactor = Math.random() < 0.5 ? 1 : -1;
        const midX = startX + (box.x - startX) * 0.4 + (Math.random() * 40 * curveFactor);
        const midY = startY + (box.y - startY) * 0.6 + (Math.random() * 40 * -curveFactor);
        await page.mouse.move(midX, midY, { steps: Math.floor(6 + Math.random() * 5) });
        await page.waitForTimeout(20 + Math.random() * 40);

        const finalX = box.x + box.width / 2 + (Math.random() * 8 - 4);
        const finalY = box.y + box.height / 2 + (Math.random() * 8 - 4);

        if (Math.random() < 0.32) {
            const dirX = finalX - startX;
            const dirY = finalY - startY;
            const length = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
            const overExt = 0.05 + Math.random() * 0.12;
            const overshootX = finalX + (dirX / length) * (length * overExt);
            const overshootY = finalY + (dirY / length) * (length * overExt);

            await page.mouse.move(overshootX, overshootY, { steps: Math.floor(4 + Math.random() * 4) });
            await page.waitForTimeout(30 + Math.random() * 60);
            await page.mouse.move(finalX, finalY, { steps: Math.floor(5 + Math.random() * 5) });
        } else {
            await page.mouse.move(finalX, finalY, { steps: Math.floor(8 + Math.random() * 6) });
        }
    } catch {
        // Ignora silenziosamente
    }
}

/**
 * Movimento cursor casuale non legato a click, utile per spezzare pattern
 * durante pause lunghe tra job.
 */
export async function randomMouseMove(page: Page): Promise<void> {
    try {
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        const startX = Math.random() * viewport.width;
        const startY = Math.random() * viewport.height;
        const endX = Math.random() * viewport.width;
        const endY = Math.random() * viewport.height;

        await page.mouse.move(startX, startY, { steps: 6 });
        await page.waitForTimeout(30 + Math.random() * 80);

        const midX = startX + (endX - startX) * 0.5 + (Math.random() * 20 - 10);
        const midY = startY + (endY - startY) * 0.5 + (Math.random() * 20 - 10);
        await page.mouse.move(midX, midY, { steps: 5 });
        await page.waitForTimeout(20 + Math.random() * 60);

        if (Math.random() < 0.14) {
            const overshootX = endX + (Math.random() * 24 - 12);
            const overshootY = endY + (Math.random() * 18 - 9);
            await page.mouse.move(overshootX, overshootY, { steps: 6 });
            await page.waitForTimeout(20 + Math.random() * 60);
        }
        await page.mouse.move(endX, endY, { steps: 8 });
    } catch {
        // Non bloccante
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
        if (Math.random() < 0.03 && text.length > 3) {
            const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
            await element.pressSequentially(wrongChar, { delay: Math.floor(Math.random() * 130) + 40 });
            await page.waitForTimeout(280 + Math.random() * 420);
            await element.press('Backspace');
            await page.waitForTimeout(180 + Math.random() * 250);
        }
        await element.pressSequentially(text[i] ?? '', { delay: Math.floor(Math.random() * 150) + 40 });
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
    const scrollCount = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < scrollCount; i++) {
        const deltaY = 150 + Math.random() * 380;
        await page.evaluate((dy: number) => window.scrollBy({ top: dy, behavior: 'smooth' }), deltaY);
        await humanDelay(page, 700, 2200);
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
    const base = Math.floor(Math.random() * 60_000) + 30_000;
    const longBreak = Math.random() < 0.08 ? Math.floor(Math.random() * 240_000) + 180_000 : 0;
    const totalDelay = base + longBreak;

    if (Math.random() < 0.35) {
        await randomMouseMove(page);
    }

    const split = Math.floor(totalDelay * (0.4 + Math.random() * 0.2));
    await page.waitForTimeout(Math.max(0, split));

    if (Math.random() < 0.25) {
        await randomMouseMove(page);
    }

    await page.waitForTimeout(Math.max(0, totalDelay - split));
}

/**
 * Azioni Diversive Mute (Decoy):
 * naviga in sezioni casuali di LinkedIn prima dei veri task
 * per mascherare pattern lineari da bot.
 */
export async function performDecoyAction(page: Page): Promise<void> {
    const terms = ['marketing', 'developer', 'ceo', 'sales', 'hr', 'tech', 'design'];
    const actions = [
        async () => {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await simulateHumanReading(page);
        },
        async () => {
            await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
            await humanDelay(page, 2000, 5000);
            await simulateHumanReading(page);
        },
        async () => {
            const search = randomElement(terms);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${search}`, { waitUntil: 'domcontentloaded' });
            await humanDelay(page, 1500, 4000);
            await simulateHumanReading(page);
        }
    ];

    try {
        const decoy = randomElement(actions);
        await decoy();
    } catch {
        // Ignora silenziosamente — è solo noise decoy
    }
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1200, 2000);
    const navOk = await page.locator(joinSelectors('globalNav')).count();
    return navOk > 0;
}
