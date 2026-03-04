/**
 * browser/humanBehavior.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula comportamento umano nel browser: delay log-normale,
 * movimenti mouse con curva Bézier, digitazione con typo,
 * reading scroll, decoy actions, inter-job delay.
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
import { MouseGenerator } from '../ml/mouseGenerator';
import { calculateContextualDelay } from '../ml/timingModel';
import { determineNextKeystroke } from '../ai/typoGenerator';

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
        baseMax: max
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

        const startX = 100 + Math.random() * 300;
        const startY = 100 + Math.random() * 200;

        const finalX = box.x + box.width / 2 + (Math.random() * 8 - 4);
        const finalY = box.y + box.height / 2 + (Math.random() * 8 - 4);

        const path = MouseGenerator.generatePath({ x: startX, y: startY }, { x: finalX, y: finalY }, Math.floor(15 + Math.random() * 10));

        for (let i = 0; i < path.length; i++) {
            const point = path[i];
            if (!point) continue;
            await page.mouse.move(point.x, point.y, { steps: 1 });

            // Pausa randomica intra-movimento
            if (i % 5 === 0) {
                await page.waitForTimeout(10 + Math.random() * 20);
            }
        }

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
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        // Si assume che il mouse parta da una posizione pseudo-casuale oppure logica in alto.
        const startPointX = Math.random() * (viewport.width * 0.4);
        const startPointY = Math.random() * (viewport.height * 0.4);

        const path = MouseGenerator.generatePath(
            { x: startPointX, y: startPointY },
            { x: targetX, y: targetY },
            Math.floor(15 + Math.random() * 10)
        );

        for (let i = 0; i < path.length; i++) {
            const point = path[i];
            if (!point) continue;
            await page.mouse.move(point.x, point.y, { steps: 1 });

            // Rallentamenti asincroni tipici
            if (i % 5 === 0) {
                await page.waitForTimeout(10 + Math.random() * 20);
            }
        }
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
        await page.waitForTimeout(30 + Math.random() * 80);
    } catch {
        // Best effort.
    }
}

export async function humanSwipe(page: Page, direction: 'up' | 'down' = 'up'): Promise<void> {
    try {
        const viewport = page.viewportSize() ?? { width: 390, height: 844 };
        const startX = Math.round(viewport.width * (0.35 + Math.random() * 0.3));
        const startY = direction === 'up'
            ? Math.round(viewport.height * (0.75 + Math.random() * 0.1))
            : Math.round(viewport.height * (0.3 + Math.random() * 0.1));
        const delta = Math.round(viewport.height * (0.2 + Math.random() * 0.2));
        const endY = direction === 'up' ? startY - delta : startY + delta;

        await page.mouse.move(startX, startY, { steps: 4 });
        await page.mouse.down();
        await page.mouse.move(startX + randomInt(-20, 20), endY, { steps: 10 });
        await page.mouse.up();
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
        const originalChar = text[i] ?? '';
        const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, 0.035);

        await element.pressSequentially(typedChar, { delay: Math.floor(Math.random() * 150) + 40 });

        if (isTypo) {
            await page.waitForTimeout(280 + Math.random() * 420);
            await element.press('Backspace');
            await page.waitForTimeout(180 + Math.random() * 250);
            await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 150) + 40 });
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
        baseMax: maxDelay
    });

    if (Math.random() < (isMobilePage(page) ? 0.2 : 0.35)) {
        await randomMouseMove(page);
    }

    const split = Math.floor(totalDelay * (0.4 + Math.random() * 0.2));
    await page.waitForTimeout(Math.max(0, split));

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
        const terms = ['sales', 'marketing', 'engineering', 'operations', 'growth', 'ai'];
        const term = randomElement(terms);
        await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(term)}`, { waitUntil: 'domcontentloaded' });
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
            selectors: [
                joinSelectors('connectButtonPrimary'),
                'a[href*="/in/"]',
            ],
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

export async function runSelectorCanaryDetailed(page: Page, workflow: CanaryWorkflow = 'all'): Promise<SelectorCanaryReport> {
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
