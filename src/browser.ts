import { chromium, BrowserContext, Page } from 'playwright';
import { config } from './config';
import { ensureDirectoryPrivate } from './security/filesystem';
import { SELECTORS } from './selectors';

export interface BrowserSession {
    browser: BrowserContext;
    page: Page;
}

export interface LaunchBrowserOptions {
    headless?: boolean;
}

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    ensureDirectoryPrivate(config.sessionDir);

    const browser = await chromium.launchPersistentContext(config.sessionDir, {
        headless: options.headless ?? config.headless,
        viewport: { width: 1280, height: 800 },
    });

    const existingPage = browser.pages()[0];
    const page = existingPage ?? await browser.newPage();
    return { browser, page };
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
    await session.browser.close();
}

async function hasLinkedinAuthCookie(page: Page): Promise<boolean> {
    try {
        const cookies = await page.context().cookies('https://www.linkedin.com');
        return cookies.some((cookie) => cookie.name === 'li_at' && cookie.value.trim().length > 0);
    } catch {
        return false;
    }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
    if (await hasLinkedinAuthCookie(page)) {
        return true;
    }

    const count = await page.locator(SELECTORS.globalNav).count();
    if (count > 0) {
        return true;
    }

    const currentUrl = page.url().toLowerCase();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/challenge')) {
        return false;
    }

    const loginForm = await page.locator('form[action*="login"], input[name="session_key"]').count();
    return loginForm === 0;
}

export async function checkLogin(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/', { waitUntil: 'load' });
    await humanDelay(page, 2000, 4000);
    return isLoggedIn(page);
}

export async function detectChallenge(page: Page): Promise<boolean> {
    const currentUrl = page.url().toLowerCase();
    const challengeInUrl = ['checkpoint', 'challenge', 'captcha', 'security-verification'].some((token) => currentUrl.includes(token));
    if (challengeInUrl) {
        return true;
    }

    const selectorMatches = await page.locator(SELECTORS.challengeSignals).count();
    return selectorMatches > 0;
}

export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    await page.waitForTimeout(delay);
}

export async function simulateHumanReading(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollBy(0, 400));
    await humanDelay(page, 1000, 2500);
    await page.evaluate(() => window.scrollBy(0, 450));
    await humanDelay(page, 800, 1800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await humanDelay(page, 600, 1500);
}

/**
 * Digita il testo carattere per carattere con delay variabile,
 * simulando la velocità di digitazione umana (40–120 WPM ≈ 50–250 ms/carattere).
 * Evita il pattern rilevabile di fill() / paste istantaneo.
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
    const element = page.locator(selector).first();
    await element.click();
    await humanDelay(page, 200, 500);
    for (const char of text) {
        await element.pressSequentially(char, { delay: Math.floor(Math.random() * 180) + 50 });
        // Pausa occasionale più lunga (simula pausa mentre si pensa)
        if (Math.random() < 0.04) {
            await humanDelay(page, 400, 1200);
        }
    }
}

/**
 * Pausa randomizzata tra un job e il successivo per evitare il pattern burst.
 * Range: 30–120 secondi di base, con picco occasionale ("pausa caffè").
 */
export async function interJobDelay(page: Page): Promise<void> {
    // Pausa base 30–90 s
    const base = Math.floor(Math.random() * 60_000) + 30_000;
    // 8% di probabilità di pausa lunga 3–7 minuti
    const longBreak = Math.random() < 0.08 ? Math.floor(Math.random() * 240_000) + 180_000 : 0;
    await page.waitForTimeout(base + longBreak);
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1200, 2000);
    const navOk = await page.locator(SELECTORS.globalNav).count();
    return navOk > 0;
}
