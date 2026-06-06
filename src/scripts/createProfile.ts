import path from 'path';
import { chromium, firefox } from 'playwright';
import { config } from '../config';
import { ensureDirectoryPrivate } from '../security/filesystem';
import { getProxyFailoverChainAsync, getStickyProxy, type ProxyConfig } from '../proxyManager';

export interface CreateProfileOptions {
    profileDir: string;
    loginUrl: string;
    timeoutSeconds: number;
}

const DEFAULT_PROFILE_DIR = path.resolve(process.cwd(), 'profiles', 'linkedin-profile');
const DEFAULT_LOGIN_URL = 'https://www.linkedin.com/login';

export function resolveProfileDir(rawDir: string | null | undefined): string {
    if (!rawDir || !rawDir.trim()) {
        return DEFAULT_PROFILE_DIR;
    }
    const trimmed = rawDir.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

export async function createPersistentProfile(options: Partial<CreateProfileOptions> = {}): Promise<void> {
    const profileDir = resolveProfileDir(options.profileDir);
    const loginUrl = options.loginUrl?.trim() || DEFAULT_LOGIN_URL;
    const timeoutSeconds = Math.max(60, Math.floor(options.timeoutSeconds ?? 900));

    ensureDirectoryPrivate(profileDir);

    // AB-24 (anti-ban — finding HIGH): il browser di login NON deve mai partire su IP diretto
    // quando un proxy gestito e' configurato. Il login setta il cookie li_at: eseguirlo sull'IP
    // reale = de-anonimizzazione totale nel momento piu' sensibile, e crea un mismatch geo
    // login-IP vs automation-IP (segnale di detection). createProfile e' l'unico altro punto, oltre
    // a launchBrowser(), che lancia un browser direttamente: applichiamo qui lo stesso gate
    // fail-closed di launcher.ts:271-279, riusando le primitive di risoluzione proxy.
    const managedProxyEnabled =
        config.proxyUrl.trim().length > 0 ||
        config.proxyListPath.trim().length > 0 ||
        !!config.proxyProviderApiEndpoint;
    let proxy: ProxyConfig | undefined;
    if (managedProxyEnabled) {
        proxy =
            (await getStickyProxy(profileDir, {}, profileDir)) ??
            (
                await getProxyFailoverChainAsync({
                    preferredType: config.proxyMobilePriorityEnabled ? 'mobile' : undefined,
                })
            )[0];
        if (!proxy) {
            throw new Error(
                'AB-24: no proxy resolved with managed proxy enabled - refusing to create profile / log in on direct IP (de-anonymization risk). Check proxy pool/provider/file.',
            );
        }
    }

    const isFirefox = config.browserEngine === 'firefox' || config.browserEngine === 'camoufox';
    const engine = isFirefox ? firefox : chromium;
    const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
        headless: false,
        viewport: { width: 1366, height: 768 },
        locale: 'it-IT',
    };
    if (proxy) {
        contextOptions.proxy = {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
        };
    }
    const context = await engine.launchPersistentContext(profileDir, contextOptions);

    try {
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

        console.log(`[PROFILE] Directory: ${profileDir}`);
        console.log(
            `[PROFILE] Completa il login manualmente entro ${timeoutSeconds}s. I cookie verranno salvati nel profilo.`,
        );

        const timeoutAt = Date.now() + timeoutSeconds * 1000;
        let loginDetected = false;
        while (Date.now() < timeoutAt) {
            const cookies = await context.cookies();
            if (cookies.some((cookie) => cookie.name === 'li_at')) {
                loginDetected = true;
                break;
            }
            await page.waitForTimeout(2500);
        }

        if (loginDetected) {
            console.log('[PROFILE] Login rilevato e profilo persistente aggiornato.');
        } else {
            console.log('[PROFILE] Timeout raggiunto. Il profilo è stato comunque salvato con lo stato corrente.');
        }
    } finally {
        await context.close().catch(() => {});
    }
}
