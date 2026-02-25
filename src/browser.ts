import { chromium, BrowserContext, Page } from 'playwright';
import { config } from './config';
import { ensureDirectoryPrivate } from './security/filesystem';
import { SELECTORS } from './selectors';
import { getProxyFailoverChain, markProxyFailed, markProxyHealthy, ProxyConfig } from './proxyManager';

// ─── User-Agent pool (Chrome reali su Windows/macOS/Linux) ──────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

// ─── Viewport pool (risoluzioni comuni reali) ────────────────────────────────
const VIEWPORTS = [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
];

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Anti-fingerprinting patch (sostituisce playwright-stealth) ──────────────
const STEALTH_INIT_SCRIPT = `
(function () {
    // Rimuove navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

    // Imposta lingue italiane/inglesi realistiche
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'], configurable: true });

    // Sovrascrive platform in base all'UA (approssimato)
    const ua = navigator.userAgent;
    const platform = ua.includes('Win') ? 'Win32' : ua.includes('Mac') ? 'MacIntel' : 'Linux x86_64';
    Object.defineProperty(navigator, 'platform', { get: () => platform, configurable: true });

    // Evita rilevamento via plugin vuoti
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5], configurable: true });

    // Rimuove automationControlled da Chrome
    if (window.chrome) {
        Object.defineProperty(window, 'chrome', {
            get: () => ({ runtime: {}, loadTimes: () => {}, csi: () => {} }),
            configurable: true,
        });
    }

    // Permessi realistici
    const originalQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
        Object.defineProperty(navigator.permissions, 'query', {
            value: (parameters: PermissionDescriptor) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                    : originalQuery(parameters),
            configurable: true,
        });
    }
})();
`;

export interface BrowserSession {
    browser: BrowserContext;
    page: Page;
}

export interface LaunchBrowserOptions {
    headless?: boolean;
    proxy?: ProxyConfig;
    sessionDir?: string;
}

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    const sessionDir = options.sessionDir ?? config.sessionDir;
    ensureDirectoryPrivate(sessionDir);

    const userAgent = randomElement(USER_AGENTS);
    const viewport = randomElement(VIEWPORTS);
    const proxyChain = options.proxy ? [options.proxy] : getProxyFailoverChain();
    const launchPlan: Array<ProxyConfig | undefined> = proxyChain.length > 0 ? proxyChain : [undefined];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < launchPlan.length; attempt++) {
        const selectedProxy = launchPlan[attempt];
        const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
            headless: options.headless ?? config.headless,
            viewport,
            userAgent,
            locale: 'it-IT',
            timezoneId: config.timezone,
        };

        if (selectedProxy) {
            contextOptions.proxy = {
                server: selectedProxy.server,
                username: selectedProxy.username,
                password: selectedProxy.password,
            };
        }

        try {
            const browser = await chromium.launchPersistentContext(sessionDir, contextOptions);

            // Applica patch anti-fingerprinting su tutte le pagine (incluse future)
            await browser.addInitScript({ content: STEALTH_INIT_SCRIPT });

            const existingPage = browser.pages()[0];
            const page = existingPage ?? await browser.newPage();
            if (selectedProxy) {
                markProxyHealthy(selectedProxy);
            }
            return { browser, page };
        } catch (error) {
            lastError = error;
            if (selectedProxy) {
                markProxyFailed(selectedProxy);
                if (attempt < launchPlan.length - 1) {
                    console.warn(
                        `[PROXY] Launch fallito su ${selectedProxy.server}, provo il prossimo (${attempt + 2}/${launchPlan.length}).`
                    );
                }
            }
        }
    }

    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error('Impossibile avviare il browser context.');
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
    const challengeInUrl = ['checkpoint', 'challenge', 'captcha', 'security-verification'].some((token) =>
        currentUrl.includes(token)
    );
    if (challengeInUrl) {
        return true;
    }

    const selectorMatches = await page.locator(SELECTORS.challengeSignals).count();
    return selectorMatches > 0;
}

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

/**
 * Pausa con distribuzione log-normale invece di uniforme:
 * più realistica perché i tempi di reazione umani seguono questa distribuzione.
 */
export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const mean = (min + max) / 2;
    const std = (max - min) / 4;
    const raw = randomLogNormal(mean, std);
    const delay = Math.round(Math.min(max * 1.5, Math.max(min, raw)));
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

        // Tappa intermedia con offset casuale (curva naturalistica)
        const midX = startX + (box.x - startX) * 0.35 + (Math.random() * 30 - 15);
        const midY = startY + (box.y - startY) * 0.35 + (Math.random() * 20 - 10);
        await page.mouse.move(midX, midY, { steps: 8 });
        await page.waitForTimeout(30 + Math.random() * 60);

        // Target finale (centro dell'elemento con micro-offset)
        const finalX = box.x + box.width / 2 + (Math.random() * 6 - 3);
        const finalY = box.y + box.height / 2 + (Math.random() * 4 - 2);
        await page.mouse.move(finalX, finalY, { steps: 12 });
    } catch {
        // Se l'elemento non è visibile, ignora silenziosamente
    }
}

/**
 * Digita il testo carattere per carattere con delay variabile.
 * Include il 3% di probabilità di errore di battitura + correzione (Backspace),
 * simulando il comportamento di un utente reale.
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
    const element = page.locator(selector).first();
    await element.click();
    await humanDelay(page, 200, 500);

    for (let i = 0; i < text.length; i++) {
        // 3% di probabilità di digita-sbaglio → correzione
        if (Math.random() < 0.03 && text.length > 3) {
            const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
            await element.pressSequentially(wrongChar, { delay: Math.floor(Math.random() * 130) + 40 });
            await page.waitForTimeout(280 + Math.random() * 420);
            await element.press('Backspace');
            await page.waitForTimeout(180 + Math.random() * 250);
        }

        await element.pressSequentially(text[i], { delay: Math.floor(Math.random() * 150) + 40 });

        // Pausa più lunga occasionale (come quando si pensa alla prossima parola)
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
    const scrollCount = 3 + Math.floor(Math.random() * 5); // 3-7 scroll
    for (let i = 0; i < scrollCount; i++) {
        const deltaY = 150 + Math.random() * 380;
        await page.evaluate((dy: number) => window.scrollBy({ top: dy, behavior: 'smooth' }), deltaY);
        await humanDelay(page, 700, 2200);
    }
    // 30% di probabilità di tornare in cima
    if (Math.random() < 0.3) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await humanDelay(page, 500, 1400);
    }
}

/**
 * Pausa randomizzata tra un job e il successivo per evitare il pattern burst.
 * Range: 30–90 secondi di base, con picco occasionale ("pausa caffè").
 */
export async function interJobDelay(page: Page): Promise<void> {
    const base = Math.floor(Math.random() * 60_000) + 30_000;
    const longBreak = Math.random() < 0.08 ? Math.floor(Math.random() * 240_000) + 180_000 : 0;
    await page.waitForTimeout(base + longBreak);
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1200, 2000);
    const navOk = await page.locator(SELECTORS.globalNav).count();
    return navOk > 0;
}
