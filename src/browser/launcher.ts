/**
 * browser/launcher.ts
 * ─────────────────────────────────────────────────────────────────
 * Lifecycle browser Playwright: launch, close, GC e gestione proxy.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { config } from '../config';
import { ensureDirectoryPrivate } from '../security/filesystem';
import { pauseAutomation } from '../risk/incidentManager';
import {
    ProxyConfig,
    getProxyFailoverChainAsync,
    getStickyProxy,
    markProxyFailed,
    markProxyHealthy,
    releaseStickyProxy
} from '../proxyManager';
import { CloudFingerprint, pickBrowserFingerprint, STEALTH_INIT_SCRIPT } from './stealth';

const activeBrowsers = new Set<BrowserContext>();

const cleanupBrowsers = async () => {
    for (const browser of activeBrowsers) {
        try {
            await browser.close();
        } catch {
            // ignore close errors during shutdown
        }
    }
    activeBrowsers.clear();
};

process.on('SIGINT', async () => {
    await cleanupBrowsers();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cleanupBrowsers();
    process.exit(0);
});

let cachedCloudFingerprints: CloudFingerprint[] | null = null;
let lastFingerprintFetchTime = 0;

async function fetchCloudFingerprints(): Promise<CloudFingerprint[]> {
    if (!config.fingerprintApiEndpoint) return [];

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
            if (Array.isArray(data) && data.length > 0 && data[0]?.userAgent) {
                cachedCloudFingerprints = data;
                lastFingerprintFetchTime = Date.now();
                return data;
            }
        }
    } catch {
        // keep local fallback
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

function isSameProxy(a: ProxyConfig | undefined, b: ProxyConfig | undefined): boolean {
    if (!a || !b) return false;
    return a.server === b.server
        && (a.username ?? '') === (b.username ?? '')
        && (a.password ?? '') === (b.password ?? '');
}

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    const sessionDir = options.sessionDir ?? config.sessionDir;
    ensureDirectoryPrivate(sessionDir);

    const headless = options.headless ?? config.headless;
    const autoScaleProxy = config.multiAccountEnabled;
    const explicitProxy = options.proxy;
    const stickyProxy = !explicitProxy && autoScaleProxy ? await getStickyProxy(sessionDir) : undefined;

    let launchPlan: Array<ProxyConfig | undefined> = [];
    if (explicitProxy) {
        launchPlan = [explicitProxy];
    } else if (autoScaleProxy) {
        const failoverChain = await getProxyFailoverChainAsync();
        if (stickyProxy) {
            launchPlan.push(stickyProxy);
        }
        for (const candidate of failoverChain) {
            if (!isSameProxy(candidate, stickyProxy)) {
                launchPlan.push(candidate);
            }
        }
        if (launchPlan.length === 0) {
            launchPlan = [undefined];
        }
    } else {
        launchPlan = [undefined];
    }
    let lastError: unknown = null;

    for (let attempt = 0; attempt < launchPlan.length; attempt++) {
        const currentProxy = launchPlan[attempt];
        const cloudFingerprints = await fetchCloudFingerprints();
        const fingerprint = pickBrowserFingerprint(cloudFingerprints);

        const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
            headless,
            viewport: fingerprint.viewport,
            userAgent: fingerprint.userAgent,
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

            page.on('response', async (response) => {
                if (response.status() === 429) {
                    const url = response.url();
                    if (url.includes('linkedin.com/voyager')) {
                        console.error('\n[GLOBAL KILL-SWITCH] HTTP 429 (Too Many Requests) da LinkedIn APIs:', url);
                        if (currentProxy) {
                            console.error(`[PROXY] Proxy bruciato: ${currentProxy.server}`);
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
            activeBrowsers.add(browser);
            return { browser, page };
        } catch (error) {
            lastError = error;
            if (currentProxy) {
                markProxyFailed(currentProxy);
                if (attempt < launchPlan.length - 1) {
                    console.warn(`[PROXY] Launch fallito su ${currentProxy.server}, provo il prossimo (${attempt + 2}/${launchPlan.length}).`);
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
    activeBrowsers.delete(session.browser);
    await session.browser.close().catch(() => { });
}

export async function performBrowserGC(session: BrowserSession): Promise<void> {
    try {
        const pages = session.browser.pages();
        for (const p of pages) {
            if (p !== session.page && !p.isClosed()) {
                await p.close().catch(() => { });
            }
        }
        const client = await session.page.context().newCDPSession(session.page);
        await client.send('HeapProfiler.enable').catch(() => { });
        await client.send('HeapProfiler.collectGarbage').catch(() => { });
        await client.detach().catch(() => { });
    } catch {
        // ignore GC errors
    }
}

export type { CloudFingerprint };
