import { chromium, BrowserContext, Page } from 'playwright';
import { config } from './config';
import { ensureDirectoryPrivate } from './security/filesystem';
import { SELECTORS } from './selectors';
import { pauseAutomation } from './risk/incidentManager';
import {
    ProxyConfig,
    getStickyProxy,
    markProxyFailed,
    markProxyHealthy,
    releaseStickyProxy
} from './proxyManager';

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

export interface CloudFingerprint {
    userAgent: string;
    viewport?: { width: number; height: number };
}

let cachedCloudFingerprints: CloudFingerprint[] | null = null;
let lastFingerprintFetchTime = 0;

async function fetchCloudFingerprints(): Promise<CloudFingerprint[]> {
    if (!config.fingerprintApiEndpoint) return [];

    // Cache di 10 minuti per evitare DDoS al provider
    if (cachedCloudFingerprints && Date.now() - lastFingerprintFetchTime < 10 * 60 * 1000) {
        return cachedCloudFingerprints;
    }

    try {
        const response = await fetch(config.fingerprintApiEndpoint, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            const data = await response.json() as CloudFingerprint[];
            if (Array.isArray(data) && data.length > 0 && data[0].userAgent) {
                cachedCloudFingerprints = data;
                lastFingerprintFetchTime = Date.now();
                return data;
            }
        }
    } catch {
        // Silenzioso, passa al fallback locale
    }
    return [];
}

export interface BrowserSession {
    browser: BrowserContext;
    page: Page;
}

export interface LaunchBrowserOptions {
    headless?: boolean;
    proxy?: ProxyConfig;
    sessionDir?: string;
}

const STEALTH_INIT_SCRIPT = `
    // 1. Defeat navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    
    // 2. Mock hardwareConcurrency and deviceMemory
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    
    // 3. Mock plugins & mimeTypes
    if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjimiaplmpugondwaidnpafkincn', description: '' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ]
        });
    }

    // 4. Spoof WebGL Vendor/Renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Google Inc. (Apple)'; // VENDOR (UNMASKED_VENDOR_WEBGL)
        if (parameter === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'; // RENDERER (UNMASKED_RENDERER_WEBGL)
        return getParameter.apply(this, arguments);
    };

    // 5. Canvas Fingerprint Noise
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
        const context = this.getContext('2d');
        if (context) {
            const width = this.width;
            const height = this.height;
            context.fillStyle = 'rgba(255,255,255,0.01)';
            context.fillText('stealth', Math.random() * width, Math.random() * height);
        }
        return originalToDataURL.apply(this, arguments);
    };
    
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() {
        const imageData = originalGetImageData.apply(this, arguments);
        for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() * 2 - 1)));
        }
        return imageData;
    };

    // 6. AudioContext Fingerprint Noise
    const audioContextFunc = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (audioContextFunc) {
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function() {
            const results = originalGetChannelData.apply(this, arguments);
            for (let i = 0; i < results.length; i += 100) {
                results[i] = results[i] + (Math.random() * 0.0000001 - 0.00000005);
            }
            return results;
        };
    }

    // 7. WebRTC IP Leak Prevention (Fake RTCPeerConnection)
    if (window.RTCPeerConnection) {
        const OriginalRTCPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = function(...args) {
            const pc = new OriginalRTCPeerConnection(...args);
            pc.createDataChannel = () => ({ close: () => {} });
            pc.createOffer = () => Promise.resolve({ type: 'offer', sdp: '' });
            return pc;
        };
        window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    }

    // 8. Delete Playwright CDP Traces (cdc_*)
    for (const key of Object.keys(window)) {
        if (key.match(/^cdc_[a-zA-Z0-9]+_/)) {
            try { delete window[key]; } catch {}
        }
    }

    // 9. Hardware & Sensor Mocks
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') return Promise.resolve({ state: 'denied', onchange: null });
            if (parameters.name === 'geolocation') return Promise.resolve({ state: 'prompt', onchange: null });
            return originalQuery(parameters);
        };
    }
    Object.defineProperty(navigator, 'getBattery', { get: () => undefined });
`;

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    const sessionDir = options.sessionDir ?? config.sessionDir;
    ensureDirectoryPrivate(sessionDir);

    const headless = options.headless ?? config.headless;

    // Check cooldown / proxy rotation
    const autoScaleProxy = config.multiAccountEnabled; // In multiaccount leghiamo proxy a sessionDir

    // Ottieni un proxy sano (magari pescando da Cloud Provider API async)
    const selectedProxy: ProxyConfig | undefined = autoScaleProxy
        ? await getStickyProxy(sessionDir)
        : options.proxy;

    const launchPlan: Array<ProxyConfig | undefined> = [selectedProxy];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < launchPlan.length; attempt++) {
        const currentProxy = launchPlan[attempt];

        // Fingerprint Rotation Logic
        let userAgent = randomElement(USER_AGENTS);
        let viewport = randomElement(VIEWPORTS);

        const cloudFingerprints = await fetchCloudFingerprints();
        if (cloudFingerprints.length > 0) {
            const fp = randomElement(cloudFingerprints);
            userAgent = fp.userAgent;
            if (fp.viewport) {
                viewport = fp.viewport;
            }
        }

        const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
            headless,
            viewport,
            userAgent,
            locale: 'it-IT',
            timezoneId: config.timezone,
        };

        if (currentProxy) {
            contextOptions.proxy = {
                server: currentProxy.server,
                username: currentProxy.username,
                password: currentProxy.password,
            };
        }

        try {
            const browser = await chromium.launchPersistentContext(sessionDir, contextOptions);
            await browser.addInitScript(STEALTH_INIT_SCRIPT);

            const existingPage = browser.pages()[0];
            const page = existingPage ?? await browser.newPage();

            // Global Kill-Switch 429 - Circuit Breaker
            page.on('response', async (response) => {
                if (response.status() === 429) {
                    const url = response.url();
                    if (url.includes('linkedin.com/voyager')) {
                        console.error('\n🚨 [GLOBAL KILL-SWITCH] Ricevuto HTTP 429 (Too Many Requests) da LinkedIn APIs:', url);
                        if (currentProxy) {
                            console.error(`💥 Uccisione forzata del Proxy bruciato: ${currentProxy.server}`);
                            markProxyFailed(currentProxy);
                            releaseStickyProxy(sessionDir);
                        }
                        await pauseAutomation('HTTP_429_RATE_LIMIT', { url }, config.autoPauseMinutesOnFailureBurst ?? 60).catch(() => { });
                    }
                }
            });

            if (currentProxy) {
                markProxyHealthy(currentProxy);
            }
            return { browser, page };
        } catch (error) {
            lastError = error;
            if (currentProxy) {
                markProxyFailed(currentProxy);
                if (attempt < launchPlan.length - 1) {
                    console.warn(
                        `[PROXY] Launch fallito su ${currentProxy.server}, provo il prossimo (${attempt + 2}/${launchPlan.length}).`
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
    if (selectorMatches > 0) {
        return true;
    }

    const pageText = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? '';
    if (!pageText) {
        return false;
    }
    return /temporarily blocked|temporaneamente bloccato|restricted your account|account limitato/.test(pageText);
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
 * Pausa con distribuzione log-normale asimmetrica (Cronometria Disfasica):
 * Modella il timing umano con picchi veloci e occasionali distrazioni (long-tail).
 */
export async function humanDelay(page: Page, min: number = 1500, max: number = 3500): Promise<void> {
    const mean = min + (max - min) * 0.35; // Asimmetria: centro spostato verso il basso
    const std = (max - min) / 3;
    const raw = randomLogNormal(mean, std);
    const asymmetricDelay = Math.random() < 0.15 ? raw * (1.5 + Math.random()) : raw; // 15% di probabilità di coda lunga 
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

        // Tappa intermedia con offset casuale e inversione di curva naturale
        const curveFactor = Math.random() < 0.5 ? 1 : -1;
        const midX = startX + (box.x - startX) * 0.4 + (Math.random() * 40 * curveFactor);
        const midY = startY + (box.y - startY) * 0.6 + (Math.random() * 40 * -curveFactor);
        await page.mouse.move(midX, midY, { steps: Math.floor(6 + Math.random() * 5) });
        await page.waitForTimeout(20 + Math.random() * 40);

        // Target finale (centro dell'elemento con micro-offset)
        const finalX = box.x + box.width / 2 + (Math.random() * 8 - 4);
        const finalY = box.y + box.height / 2 + (Math.random() * 8 - 4);

        // Jitter Overshoot: supera il target in base al vettore dir e torna indietro
        if (Math.random() < 0.32) {
            const dirX = finalX - startX;
            const dirY = finalY - startY;
            const length = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
            const overExt = 0.05 + Math.random() * 0.12; // 5-17% overshoot

            const overshootX = finalX + (dirX / length) * (length * overExt);
            const overshootY = finalY + (dirY / length) * (length * overExt);

            await page.mouse.move(overshootX, overshootY, { steps: Math.floor(4 + Math.random() * 4) });
            await page.waitForTimeout(30 + Math.random() * 60); // Realizzazione di aver superato il taget

            // Correzione micro verso il target effettivo
            await page.mouse.move(finalX, finalY, { steps: Math.floor(5 + Math.random() * 5) });
        } else {
            await page.mouse.move(finalX, finalY, { steps: Math.floor(8 + Math.random() * 6) });
        }
    } catch {
        // Se l'elemento non è visibile, ignora silenziosamente
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
        // Non bloccante: se il mouse move fallisce, continua.
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

export async function runSelectorCanary(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1200, 2000);
    const navOk = await page.locator(SELECTORS.globalNav).count();
    return navOk > 0;
}

/**
 * Azioni Diversive Mute (Decoy):
 * Rompe i flow di automazione navigando in sezioni casuali di LinkedIn prima
 * di effettuare i veri task, per mascherare i pattern lineari da bot.
 */
export async function performDecoyAction(page: Page): Promise<void> {
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
            const terms = ['marketing', 'developer', 'ceo', 'sales', 'hr', 'tech', 'design'];
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
        // Ignora silenziosamente, è solo un'azione noise decoy
    }
}
