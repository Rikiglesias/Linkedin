/**
 * browser/launcher.ts
 * ─────────────────────────────────────────────────────────────────
 * Lifecycle browser Playwright: launch, close, GC e gestione proxy.
 */

import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { config, ProxyType } from '../config';
import { logInfo } from '../telemetry/logger';
import { ensureDirectoryPrivate } from '../security/filesystem';
import { pauseAutomation } from '../risk/incidentManager';
import {
    ProxyConfig,
    getProxyFailoverChainAsync,
    getStickyProxy,
    markProxyFailed,
    markProxyHealthy,
    releaseStickyProxy,
} from '../proxyManager';
import { ensureCycleTlsProxy, stopCycleTlsProxy } from '../proxy/cycleTlsProxy';
import {
    CloudFingerprint,
    BrowserFingerprint,
    pickDesktopFingerprint,
    pickFingerprintMode,
    pickMobileFingerprint,
} from './stealth';
import { buildStealthInitScript } from './stealthScripts';
import { HttpResponseThrottler } from '../risk/httpThrottler';
import { DeviceProfile, registerPageDeviceProfile } from './deviceProfile';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { FingerprintPool } from '../fingerprint/noiseGenerator';

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

process.on('SIGINT', () => {
    void cleanupBrowsers().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
    void cleanupBrowsers().then(() => process.exit(0));
});

function validateFingerprintConsistency(fp: BrowserFingerprint): void {
    const isMobile = fp.isMobile === true;
    const vp = fp.viewport;

    // Mobile should have touch capability
    if (isMobile && fp.hasTouch === false) {
        console.warn(`[FINGERPRINT] Inconsistency: isMobile=true but hasTouch=false (id=${fp.id})`);
    }

    // Viewport plausibility: mobile should be < 1024px width, desktop >= 800px
    if (isMobile && vp && vp.width > 1024) {
        console.warn(`[FINGERPRINT] Inconsistency: isMobile=true but viewport.width=${vp.width} (id=${fp.id})`);
    }
    if (!isMobile && vp && vp.width < 800) {
        console.warn(`[FINGERPRINT] Inconsistency: isMobile=false but viewport.width=${vp.width} (id=${fp.id})`);
    }

    // Device scale factor: mobile typically 2-3, desktop typically 1
    if (isMobile && fp.deviceScaleFactor !== undefined && fp.deviceScaleFactor < 1.5) {
        console.warn(`[FINGERPRINT] Inconsistency: isMobile=true but deviceScaleFactor=${fp.deviceScaleFactor} (id=${fp.id})`);
    }
}

let cachedCloudFingerprints: CloudFingerprint[] | null = null;
let lastFingerprintFetchTime = 0;

async function fetchCloudFingerprints(): Promise<CloudFingerprint[]> {
    if (!config.fingerprintApiEndpoint) return [];

    if (cachedCloudFingerprints && Date.now() - lastFingerprintFetchTime < 10 * 60 * 1000) {
        return cachedCloudFingerprints;
    }

    try {
        const response = await fetchWithRetryPolicy(
            config.fingerprintApiEndpoint,
            {
                headers: { Accept: 'application/json' },
                method: 'GET',
            },
            {
                integration: 'fingerprint.cloud_fetch',
                circuitKey: 'fingerprint.api',
                timeoutMs: 5_000,
                maxAttempts: 2,
            },
        );

        if (response.ok) {
            const data = (await response.json()) as CloudFingerprint[];
            if (Array.isArray(data) && data.length > 0 && data[0]?.userAgent) {
                cachedCloudFingerprints = data;
                lastFingerprintFetchTime = Date.now();
                return data;
            }
        }
    } catch {
        // API error: invalidate stale cache so next call retries
        cachedCloudFingerprints = null;
        lastFingerprintFetchTime = 0;
    }

    return [];
}

export interface BrowserSession {
    browser: BrowserContext;
    page: Page;
    deviceProfile: DeviceProfile;
    fingerprint: BrowserFingerprint;
    httpThrottler: HttpResponseThrottler;
}

export interface LaunchBrowserOptions {
    headless?: boolean;
    proxy?: ProxyConfig;
    sessionDir?: string;
    preferredProxyType?: ProxyType;
    forceMobileProxy?: boolean;
    /** Se true, forza un fingerprint desktop (mai mobile). Usato per SalesNav. */
    forceDesktop?: boolean;
    /** Se true, ignora qualsiasi proxy configurato e usa connessione diretta. */
    bypassProxy?: boolean;
    /** Account identifier used for deterministic fingerprint IDs. */
    accountId?: string;
}

function isSameProxy(a: ProxyConfig | undefined, b: ProxyConfig | undefined): boolean {
    if (!a || !b) return false;
    return (
        a.server === b.server && (a.username ?? '') === (b.username ?? '') && (a.password ?? '') === (b.password ?? '')
    );
}

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<BrowserSession> {
    const sessionDirRaw = options.sessionDir ?? config.sessionDir;
    const sessionDir = path.isAbsolute(sessionDirRaw) ? sessionDirRaw : path.resolve(process.cwd(), sessionDirRaw);
    ensureDirectoryPrivate(sessionDir);

    const headless = options.headless ?? config.headless;
    const managedProxyEnabled =
        !options.bypassProxy &&
        !options.proxy &&
        (config.proxyUrl.trim().length > 0 ||
            config.proxyListPath.trim().length > 0 ||
            !!config.proxyProviderApiEndpoint);
    const explicitProxy = options.proxy;
    const proxySelection = {
        preferredType: options.preferredProxyType,
        forceMobile: options.forceMobileProxy,
    };
    const stickyProxy =
        !explicitProxy && managedProxyEnabled ? await getStickyProxy(sessionDir, proxySelection) : undefined;

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
        const accountId = options.accountId ?? sessionDir;
        const isMobileSession = options.forceDesktop ? false : pickFingerprintMode(accountId);
        const fingerprint = isMobileSession
            ? pickMobileFingerprint(cloudFingerprints, accountId)
            : pickDesktopFingerprint(cloudFingerprints, accountId);
        const consistentNoise = FingerprintPool.generateConsistentProfile(fingerprint);
        validateFingerprintConsistency(fingerprint);
        await logInfo('browser.fingerprint_selected', {
            fingerprintId: fingerprint.id,
            isMobile: isMobileSession,
            accountId,
            canvasNoise: consistentNoise.canvasNoise,
            attempt,
        });

        const deviceProfile: DeviceProfile = {
            fingerprintId: fingerprint.id,
            isMobile: fingerprint.isMobile === true,
            hasTouch: fingerprint.hasTouch === true || fingerprint.isMobile === true,
            canvasNoise: consistentNoise.canvasNoise,
            webglNoise: consistentNoise.webglNoise,
            audioNoise: consistentNoise.audioNoise,
        };

        // Per sessioni non-headless, usa viewport null + --start-maximized
        // così il browser riempie lo schermo (SalesNav ha bisogno di spazio per il virtual scroller).
        // Per headless, forza un viewport grande (1920x1080).
        let viewport: { width: number; height: number } | null;
        if (headless) {
            viewport = { width: 1920, height: 1080 };
        } else {
            // viewport null = il browser usa le dimensioni della finestra
            viewport = null;
        }

        const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
            headless,
            viewport,
            locale: fingerprint.locale ?? 'it-IT',
            timezoneId: fingerprint.timezone ?? config.timezone,
            userAgent: fingerprint.userAgent,
            args: [
                '--disable-blink-features=AutomationControlled', // Nasconde flag navigator.webdriver
                '--disable-features=IsolateOrigins,site-per-process', // Migliora fallback iframe extraction
                '--disable-webrtc', // Previene TCP/IP WebRTC leaks (fondamentale per proxy/Tor)
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-component-extensions-with-background-pages',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized', // Finestra massimizzata per SalesNav e rendering completo
                '--enable-features=DnsOverHttps<DoHTrial', // AD-12: Enforce DoH via Cloudflare resolver
                '--force-fieldtrials=DoHTrial/Group1',
                '--force-fieldtrial-params=DoHTrial.Group1:server/https%3A%2F%2Fcloudflare-dns.com%2Fdns-query/method/POST',
            ],
        };
        // Proxy provider HTTPS handling: ignoreHTTPSErrors SOLO per domini proxy noti.
        // NON usa --ignore-certificate-errors (flag Chrome rilevabile dai bot detector).
        // Playwright ignoreHTTPSErrors agisce a livello di context, non espone flag al DOM.
        // Nota: Oxylabs (pr.oxylabs.io) usa CONNECT tunnel senza MITM — non serve
        // ignoreHTTPSErrors, ma lo abilitiamo comunque per resilienza su cert self-signed.
        const PROXY_DOMAINS_ALLOWLIST =
            /brd\.superproxy\.io|lum-superproxy\.io|brightdata\.com|luminati\.io|oxylabs\.io/i;
        if (currentProxy && PROXY_DOMAINS_ALLOWLIST.test(currentProxy.server)) {
            contextOptions.ignoreHTTPSErrors = true;
        }
        // isMobile, hasTouch e deviceScaleFactor non sono supportati con viewport: null (non-headless)
        if (deviceProfile.isMobile && viewport !== null) {
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
            // CloakBrowser integration: se attivo, usa il binario stealth Chromium
            // che patcha canvas, WebGL, audio, fonts, GPU, CDP leaks a livello C++.
            // Passa 30/30 test detection (reCAPTCHA v3, Cloudflare Turnstile, FingerprintJS).
            let browser: BrowserContext;
            if (config.cloakBrowserEnabled) {
                try {
                    const cloakbrowser = require('cloakbrowser') as { launch: typeof chromium.launchPersistentContext };
                    browser = await cloakbrowser.launch(sessionDir, contextOptions);
                    void logInfo('browser.cloakbrowser_launched', { sessionDir });
                } catch (cloakErr) {
                    console.warn('[BROWSER] CloakBrowser non disponibile, fallback a Playwright standard:', cloakErr instanceof Error ? cloakErr.message : String(cloakErr));
                    browser = await chromium.launchPersistentContext(sessionDir, contextOptions);
                }
            } else {
                browser = await chromium.launchPersistentContext(sessionDir, contextOptions);
            }

            // Iniezione noise Canvas/WebGL nativa in stack V8
            // Se CloakBrowser è attivo, salta le manipolazioni già gestite a livello binario
            const skipIfCloak = config.cloakBrowserEnabled ? new Set(config.stealthScriptsSkipIfCloak) : new Set<string>();
            // Merge: sezioni skip da CloakBrowser + sezioni skip esplicite via STEALTH_SKIP_SECTIONS
            for (const section of config.stealthSkipSections) {
                skipIfCloak.add(section);
            }
            const scriptContent = `
                (() => {
                    const canvasNoise = ${deviceProfile.canvasNoise ?? 0};
                    const webglNoise = ${deviceProfile.webglNoise ?? 0};
                    const isApple = /Mac OS X|Macintosh|iPhone|iPad/i.test(${JSON.stringify(fingerprint.userAgent)});
                    
                    const originalGetContext = HTMLCanvasElement.prototype.getContext;
                    HTMLCanvasElement.prototype.getContext = function(type, contextAttributes) {
                        const ctx = originalGetContext.call(this, type, contextAttributes);
                        if (type === '2d' && ctx) {
                            const originalGetImageData = ctx.getImageData;
                            ctx.getImageData = function(x, y, w, h) {
                                const imageData = originalGetImageData.call(this, x, y, w, h);
                                // Noise bidirezionale con PRNG Mulberry32 seedato dal fingerprint.
                                // Deterministico per sessione ma pseudo-casuale — non rilevabile
                                // statisticamente (a differenza del vecchio pattern pixelIndex % 2/3/5).
                                // Alpha (i+3) intatto — alterarlo è un marker di bot.
                                const noiseR = Math.floor(canvasNoise * 255);
                                const noiseG = Math.floor(canvasNoise * 230);
                                const noiseB = Math.floor(canvasNoise * 245);
                                // Mulberry32 PRNG: veloce, 32-bit, periodo 2^32
                                let prngState = Math.abs(canvasNoise * 1e9 | 0) || 1;
                                function nextRng() {
                                    prngState |= 0; prngState = prngState + 0x6D2B79F5 | 0;
                                    let t = Math.imul(prngState ^ prngState >>> 15, 1 | prngState);
                                    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                                    return ((t ^ t >>> 14) >>> 0) / 4294967296;
                                }
                                for (let i = 0; i < imageData.data.length; i += 4) {
                                    const signR = nextRng() < 0.5 ? 1 : -1;
                                    const signG = nextRng() < 0.5 ? 1 : -1;
                                    const signB = nextRng() < 0.5 ? 1 : -1;
                                    
                                    imageData.data[i]     = Math.max(0, Math.min(255, imageData.data[i]     + (noiseR * signR)));
                                    imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + (noiseG * signG)));
                                    imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + (noiseB * signB)));
                                }
                                return imageData;
                            };
                        }
                        if ((type === 'webgl' || type === 'webgl2') && ctx) {
                            const originalGetParameter = ctx.getParameter;
                            // Pool esteso di renderer realistici, selezionati deterministicamente per fingerprint
                            const desktopRenderers = [
                                { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)' },
                                { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)' },
                            ];
                            const appleRenderers = [
                                { vendor: 'Apple', renderer: 'Apple GPU' },
                                { vendor: 'Apple', renderer: 'Apple M1' },
                                { vendor: 'Apple', renderer: 'Apple M2' },
                                { vendor: 'Apple', renderer: 'Apple M3' },
                            ];
                            const pool = isApple ? appleRenderers : desktopRenderers;
                            const rendererIdx = Math.abs(canvasNoise * 1e6 | 0) % pool.length;
                            const selected = pool[rendererIdx];
                            ctx.getParameter = function(parameter) {
                                const res = originalGetParameter.call(this, parameter);
                                if (parameter === 37445) return selected.vendor;
                                if (parameter === 37446) return selected.renderer;
                                return res;
                            };
                        }
                        return ctx;
                    };
                })();
            `;
            // Skip canvas/webgl noise injection if CloakBrowser handles it at binary level
            if (!skipIfCloak.has('canvas') && !skipIfCloak.has('webgl')) {
                await browser.addInitScript({ content: scriptContent });
            }

            // Stealth init script: WebRTC kill, navigator normalization, chrome mock, permissions override
            // Derive hardware specs coherent with the fingerprint's device class
            const isMobileDevice = fingerprint.isMobile ?? false;
            const fpHash = fingerprint.id.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) >>> 0;
            const mobileHwOptions = [4, 6, 8];
            const desktopHwOptions = [4, 8, 12, 16];
            const coherentHwConcurrency = isMobileDevice
                ? mobileHwOptions[fpHash % mobileHwOptions.length]
                : desktopHwOptions[fpHash % desktopHwOptions.length];
            const mobileMemOptions = [2, 3, 4, 6];
            const desktopMemOptions = [4, 8, 16];
            const coherentDeviceMemory = isMobileDevice
                ? mobileMemOptions[(fpHash >> 4) % mobileMemOptions.length]
                : desktopMemOptions[(fpHash >> 4) % desktopMemOptions.length];
            const coherentColorDepth = isMobileDevice ? 32 : 24;

            const stealthScript = buildStealthInitScript({
                locale: fingerprint.locale ?? 'it-IT',
                languages: [
                    fingerprint.locale ?? 'it-IT',
                    (fingerprint.locale ?? 'it-IT').split('-')[0] ?? 'it',
                    'en-US',
                    'en',
                ],
                isHeadless: headless,
                viewportWidth: fingerprint.viewport?.width ?? 1280,
                viewportHeight: fingerprint.viewport?.height ?? 800,
                audioNoise: deviceProfile.audioNoise,
                hardwareConcurrency: coherentHwConcurrency,
                deviceMemory: coherentDeviceMemory,
                colorDepth: coherentColorDepth,
                skipSections: skipIfCloak,
            });
            await browser.addInitScript({ content: stealthScript });

            const existingPage = browser.pages()[0];
            const page = existingPage ?? (await browser.newPage());
            for (const contextPage of browser.pages()) {
                registerPageDeviceProfile(contextPage, deviceProfile);
            }
            browser.on('page', (newPage) => {
                registerPageDeviceProfile(newPage, deviceProfile);
            });

            const httpThrottler = new HttpResponseThrottler();

            page.on('response', async (response) => {
                const url = response.url();
                // Traccia i response time delle API LinkedIn per adaptive throttling
                if (url.includes('linkedin.com')) {
                    const timing = response.request().timing();
                    if (timing && typeof timing.responseEnd === 'number' && timing.responseEnd > 0) {
                        httpThrottler.recordResponseTime(url, timing.responseEnd);
                    }
                }

                if (response.status() === 429) {
                    if (url.includes('linkedin.com/voyager')) {
                        console.error('\n[GLOBAL KILL-SWITCH] HTTP 429 (Too Many Requests) da LinkedIn APIs:', url);
                        if (currentProxy) {
                            console.error(`[PROXY] Proxy bruciato: ${currentProxy.server} `);
                            markProxyFailed(currentProxy);
                            releaseStickyProxy(sessionDir);
                        }
                        await pauseAutomation(
                            'HTTP_429_RATE_LIMIT',
                            { url },
                            config.autoPauseMinutesOnFailureBurst ?? 60,
                        ).catch(() => { });
                    }
                }
            });

            if (currentProxy) {
                markProxyHealthy(currentProxy);
            }
            activeBrowsers.add(browser);
            return { browser, page, deviceProfile, fingerprint, httpThrottler };
        } catch (error) {
            lastError = error;
            if (currentProxy) {
                markProxyFailed(currentProxy);
                if (attempt < launchPlan.length - 1) {
                    console.warn(
                        `[PROXY] Launch fallito su ${currentProxy.server}, provo il prossimo(${attempt + 2}/${launchPlan.length}).`,
                    );
                }
            }

            const failedAttempts = attempt + 1;
            const shouldEscalateMobile =
                !explicitProxy &&
                managedProxyEnabled &&
                !mobileEscalationAppended &&
                config.proxyMobilePriorityEnabled &&
                failedAttempts >= config.proxyMobileEscalationFailures;
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
                console.warn(
                    `[PROXY] Escalation attiva: fallback prioritario su mobile proxy dopo ${failedAttempts} failure.`,
                );
            }
        }
    }

    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error('Impossibile avviare il browser context.');
}

/**
 * Wind-down umano prima della chiusura: simula un utente che finisce la sessione.
 * Naviga via dalla pagina di lavoro, pausa breve, poi chiude.
 * Un browser che si chiude di colpo su una pagina SalesNav è sospetto.
 */
async function humanWindDown(session: BrowserSession): Promise<void> {
    try {
        const page = session.page;
        if (page.isClosed()) return;

        const url = page.url().toLowerCase();
        const isAutomationPage = url.includes('/sales/') || url.includes('/search/') || url.includes('/mynetwork/');

        if (isAutomationPage) {
            // Variare la destinazione di uscita — un pattern costante "sempre al feed" è rilevabile.
            // Distribuzione pesata: feed 40%, notifiche 20%, homepage 15%, restare 25%
            const roll = Math.random();
            let windDownUrl: string | null = null;
            if (roll < 0.40) {
                windDownUrl = 'https://www.linkedin.com/feed/';
            } else if (roll < 0.60) {
                windDownUrl = 'https://www.linkedin.com/notifications/';
            } else if (roll < 0.75) {
                windDownUrl = 'https://www.linkedin.com/';
            }
            // roll >= 0.75: resta sulla pagina corrente (25%)

            if (windDownUrl) {
                await page.goto(windDownUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10_000,
                }).catch(() => null);
            }
            // Breve scroll come lettura casuale
            await page.evaluate(() => window.scrollBy({ top: 150 + Math.random() * 300, behavior: 'smooth' })).catch(() => null);
            await page.waitForTimeout(1_500 + Math.floor(Math.random() * 2_000)).catch(() => null);
        } else {
            // Su altre pagine, pausa breve prima di chiudere
            await page.waitForTimeout(500 + Math.floor(Math.random() * 1_000)).catch(() => null);
        }
    } catch {
        // Ignora errori durante wind-down — la chiusura deve procedere
    }
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
    await humanWindDown(session);
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
