/**
 * browser/launcher.ts
 * ─────────────────────────────────────────────────────────────────
 * Lifecycle browser Playwright: launch, close, GC e gestione proxy.
 */

import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { config, ProxyType } from '../config';
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
import { ensureCycleTlsProxy, stopCycleTlsProxy } from '../proxy/cycleTlsProxy';
import { CloudFingerprint, BrowserFingerprint, pickDesktopFingerprint, pickFingerprintMode, pickMobileFingerprint } from './stealth';
import { DeviceProfile, registerPageDeviceProfile } from './deviceProfile';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';

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
    await stopCycleTlsProxy().catch(() => { });
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
        const response = await fetchWithRetryPolicy(config.fingerprintApiEndpoint, {
            headers: { 'Accept': 'application/json' },
            method: 'GET',
        }, {
            integration: 'fingerprint.cloud_fetch',
            circuitKey: 'fingerprint.api',
            timeoutMs: 5_000,
            maxAttempts: 2,
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
    deviceProfile: DeviceProfile;
    fingerprint: BrowserFingerprint;
}

export interface LaunchBrowserOptions {
    headless?: boolean;
    proxy?: ProxyConfig;
    sessionDir?: string;
    preferredProxyType?: ProxyType;
    forceMobileProxy?: boolean;
}

function isSameProxy(a: ProxyConfig | undefined, b: ProxyConfig | undefined): boolean {
    if (!a || !b) return false;
    return a.server === b.server
        && (a.username ?? '') === (b.username ?? '')
        && (a.password ?? '') === (b.password ?? '');
}

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    const sessionDirRaw = options.sessionDir ?? config.sessionDir;
    const sessionDir = path.isAbsolute(sessionDirRaw) ? sessionDirRaw : path.resolve(process.cwd(), sessionDirRaw);
    ensureDirectoryPrivate(sessionDir);

    const headless = options.headless ?? config.headless;
    const managedProxyEnabled = !options.proxy
        && (config.proxyUrl.trim().length > 0
            || config.proxyListPath.trim().length > 0
            || !!config.proxyProviderApiEndpoint);
    const explicitProxy = options.proxy;
    const proxySelection = {
        preferredType: options.preferredProxyType,
        forceMobile: options.forceMobileProxy,
    };
    const stickyProxy = !explicitProxy && managedProxyEnabled ? await getStickyProxy(sessionDir, proxySelection) : undefined;

    let launchPlan: Array<ProxyConfig | undefined> = [];
    let mobileEscalationAppended = false;
    if (explicitProxy) {
        launchPlan = [explicitProxy];
    } else if (managedProxyEnabled) {
        const failoverChain = await getProxyFailoverChainAsync({
            ...proxySelection,
            preferredType: proxySelection.preferredType ?? (config.proxyMobilePriorityEnabled ? 'mobile' : undefined),
        });
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
        const isMobileSession = pickFingerprintMode();
        const fingerprint = isMobileSession
            ? pickMobileFingerprint(cloudFingerprints)
            : pickDesktopFingerprint(cloudFingerprints);
        const deviceProfile: DeviceProfile = {
            fingerprintId: fingerprint.id,
            isMobile: fingerprint.isMobile === true,
            hasTouch: fingerprint.hasTouch === true || fingerprint.isMobile === true,
        };

        const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
            headless,
            viewport: fingerprint.viewport,
            locale: fingerprint.locale ?? 'it-IT',
            timezoneId: fingerprint.timezone ?? config.timezone,
            userAgent: fingerprint.userAgent,
        };
        if (deviceProfile.isMobile) {
            contextOptions.isMobile = true;
            contextOptions.hasTouch = true;
            contextOptions.deviceScaleFactor = fingerprint.deviceScaleFactor ?? 2.5;
        }

        if (config.useJa3Proxy) {
            const cycleProxyEndpoint = await ensureCycleTlsProxy({
                upstreamProxy: currentProxy,
                ja3Fingerprint: fingerprint.ja3,
                userAgent: fingerprint.userAgent,
            });
            if (!cycleProxyEndpoint) {
                throw new Error('CycleTLS proxy endpoint non disponibile.');
            }
            contextOptions.proxy = {
                server: cycleProxyEndpoint,
            };
        } else if (currentProxy) {
            contextOptions.proxy = {
                server: currentProxy.server,
                username: currentProxy.username,
                password: currentProxy.password,
            };
        }

        try {
            const browser = await chromium.launchPersistentContext(sessionDir, contextOptions);

            const existingPage = browser.pages()[0];
            const page = existingPage ?? await browser.newPage();
            for (const contextPage of browser.pages()) {
                registerPageDeviceProfile(contextPage, deviceProfile);
            }
            browser.on('page', (newPage) => {
                registerPageDeviceProfile(newPage, deviceProfile);
            });

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
            return { browser, page, deviceProfile, fingerprint };
        } catch (error) {
            lastError = error;
            if (currentProxy) {
                markProxyFailed(currentProxy);
                if (attempt < launchPlan.length - 1) {
                    console.warn(`[PROXY] Launch fallito su ${currentProxy.server}, provo il prossimo (${attempt + 2}/${launchPlan.length}).`);
                }
            }

            const failedAttempts = attempt + 1;
            const shouldEscalateMobile = !explicitProxy
                && managedProxyEnabled
                && !mobileEscalationAppended
                && config.proxyMobilePriorityEnabled
                && failedAttempts >= config.proxyMobileEscalationFailures;
            if (shouldEscalateMobile) {
                const mobileChain = await getProxyFailoverChainAsync({
                    preferredType: 'mobile',
                    forceMobile: true,
                });
                for (const proxy of mobileChain) {
                    if (!launchPlan.some((existing) => isSameProxy(existing, proxy))) {
                        launchPlan.push(proxy);
                    }
                }
                mobileEscalationAppended = true;
                console.warn(`[PROXY] Escalation attiva: fallback prioritario su mobile proxy dopo ${failedAttempts} failure.`);
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
