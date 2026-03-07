/**
 * browser/missclick.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula errori di click umani: missclick su zona vuota con recovery,
 * e navigazione accidentale con ritorno.
 *
 * Design principles:
 * - Missclick SOLO su zone vuote (nessun bottone pericoloso)
 * - MAI durante operazioni critiche (send, connect, challenge)
 * - Recovery naturale: pausa di esitazione → ritorno al target
 * - Navigazione accidentale: solo durante fasi idle/feed
 * - Frequenza bassa e realistica: 1-3% dei click
 */

import { Page } from 'playwright';
import { logInfo } from '../telemetry/logger';

export type MissclickContext = 'idle' | 'navigation' | 'feed' | 'critical';

export interface MissclickConfig {
    enabled: boolean;
    missclickRate: number;
    accidentalNavRate: number;
    safeOffsetMinPx: number;
    safeOffsetMaxPx: number;
    recoveryDelayMinMs: number;
    recoveryDelayMaxMs: number;
}

const DEFAULT_CONFIG: MissclickConfig = {
    enabled: true,
    missclickRate: 0.02,
    accidentalNavRate: 0.005,
    safeOffsetMinPx: 8,
    safeOffsetMaxPx: 25,
    recoveryDelayMinMs: 250,
    recoveryDelayMaxMs: 700,
};

const DANGEROUS_SELECTORS = [
    'button:has-text("Report")',
    'button:has-text("Segnala")',
    'button:has-text("Block")',
    'button:has-text("Blocca")',
    'button:has-text("Withdraw")',
    'button:has-text("Ritira")',
    'button:has-text("Remove")',
    'button:has-text("Rimuovi")',
    'button:has-text("Unfollow")',
    'button:has-text("Delete")',
    'button:has-text("Elimina")',
    'button[aria-label*="Report"]',
    'button[aria-label*="Block"]',
    'a[href*="/settings/"]',
];

const ACCIDENTAL_NAV_URLS = [
    'https://www.linkedin.com/jobs/',
    'https://www.linkedin.com/learning/',
    'https://www.linkedin.com/mynetwork/grow/',
    'https://www.linkedin.com/premium/',
];

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * Determines if a missclick should happen based on context and probability.
 * Returns false for critical contexts (send, connect, challenge resolution).
 */
export function shouldMissclick(context: MissclickContext, cfg?: Partial<MissclickConfig>): boolean {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    if (!c.enabled || context === 'critical') return false;
    return Math.random() < c.missclickRate;
}

/**
 * Determines if an accidental navigation should happen.
 * Only during idle/feed phases, never during work.
 */
export function shouldAccidentalNav(context: MissclickContext, cfg?: Partial<MissclickConfig>): boolean {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    if (!c.enabled || context !== 'feed') return false;
    return Math.random() < c.accidentalNavRate;
}

/**
 * Checks if a point is near any dangerous button on the page.
 * Uses fast DOM check (no vision AI needed for this).
 */
async function isNearDangerousElement(page: Page, x: number, y: number, radiusPx: number = 40): Promise<boolean> {
    return page.evaluate(
        ({ px, py, radius, selectors }) => {
            for (const sel of selectors) {
                try {
                    const elements = document.querySelectorAll(sel);
                    for (const el of elements) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width === 0 && rect.height === 0) continue;
                        const expandedLeft = rect.left - radius;
                        const expandedTop = rect.top - radius;
                        const expandedRight = rect.right + radius;
                        const expandedBottom = rect.bottom + radius;
                        if (px >= expandedLeft && px <= expandedRight && py >= expandedTop && py <= expandedBottom) {
                            return true;
                        }
                    }
                } catch {
                    // selector may be invalid in current context
                }
            }
            return false;
        },
        { px: x, py: y, radius: radiusPx, selectors: DANGEROUS_SELECTORS },
    );
}

/**
 * Computes a safe missclick offset from the target point.
 * The offset is in empty space near the target, verified to not be on a dangerous element.
 */
async function computeSafeMissclickPoint(
    page: Page,
    targetX: number,
    targetY: number,
    cfg: MissclickConfig,
): Promise<{ x: number; y: number } | null> {
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = randomBetween(cfg.safeOffsetMinPx, cfg.safeOffsetMaxPx);
        const missX = Math.max(5, Math.min(viewport.width - 5, targetX + Math.cos(angle) * distance));
        const missY = Math.max(5, Math.min(viewport.height - 5, targetY + Math.sin(angle) * distance));

        const dangerous = await isNearDangerousElement(page, missX, missY);
        if (!dangerous) {
            return { x: missX, y: missY };
        }
    }

    return null;
}

/**
 * Performs a missclick: clicks on empty space near the target, pauses with
 * hesitation, then moves to the actual target. Returns true if missclick
 * was executed, false if skipped (unsafe zone).
 */
export async function performMissclick(
    page: Page,
    targetX: number,
    targetY: number,
    cfg?: Partial<MissclickConfig>,
): Promise<boolean> {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    const missPoint = await computeSafeMissclickPoint(page, targetX, targetY, c);
    if (!missPoint) return false;

    await page.mouse.move(missPoint.x, missPoint.y, { steps: 5 });
    await page.mouse.click(missPoint.x, missPoint.y);

    const hesitation = randomBetween(c.recoveryDelayMinMs, c.recoveryDelayMaxMs);
    await page.waitForTimeout(hesitation);

    await page.mouse.move(targetX, targetY, { steps: 8 });

    void logInfo('missclick.performed', {
        missX: Math.round(missPoint.x),
        missY: Math.round(missPoint.y),
        targetX: Math.round(targetX),
        targetY: Math.round(targetY),
        hesitationMs: Math.round(hesitation),
    });

    return true;
}

/**
 * Performs an accidental navigation: navigates to an unrelated LinkedIn page,
 * reads briefly, then goes back. Simulates "oops, wrong tab/link" behavior.
 */
export async function performAccidentalNavigation(page: Page): Promise<boolean> {
    const currentUrl = page.url();

    try {
        const targetUrl = ACCIDENTAL_NAV_URLS[Math.floor(Math.random() * ACCIDENTAL_NAV_URLS.length)];
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

        const stayMs = randomBetween(800, 2500);
        await page.waitForTimeout(stayMs);

        if (Math.random() < 0.6) {
            await page.evaluate(() => window.scrollBy({ top: 150 + Math.random() * 300, behavior: 'smooth' }));
            await page.waitForTimeout(randomBetween(400, 1000));
        }

        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(async () => {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        });

        const postReturnPause = randomBetween(300, 800);
        await page.waitForTimeout(postReturnPause);

        void logInfo('missclick.accidental_nav', {
            targetUrl,
            stayMs: Math.round(stayMs),
            returnedTo: currentUrl,
        });

        return true;
    } catch {
        try {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch {
            // absolute last resort — page state may be lost
        }
        return false;
    }
}
