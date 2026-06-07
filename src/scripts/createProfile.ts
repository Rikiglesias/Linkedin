import path from 'path';
import { config } from '../config';
import { ensureDirectoryPrivate } from '../security/filesystem';
import { getProxyFailoverChainAsync, getStickyProxy, type ProxyConfig } from '../proxyManager';
import { launchBrowser, closeBrowser } from '../browser/launcher';
import { recordSuccessfulAuth } from '../browser/sessionCookieMonitor';

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
    // login-IP vs automation-IP (segnale di detection). Risolviamo il proxy in fail-closed (throw
    // se il pool e' vuoto) e lo passiamo ESPLICITO a launchBrowser piu' sotto: cosi' il login non
    // puo' mai ripiegare su IP diretto (a differenza del path managed interno di launchBrowser,
    // launcher.ts:271-273, che ripiega su undefined). CL3.
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

    // CL3 anti-ban fix: riusare launchBrowser() invece di un launchPersistentContext "nudo".
    // Prima il login partiva senza stealth (canvas/WebGL/navigator/JA3 reali) -> il fingerprint del
    // login era DIVERSO da quello stealth usato dall'automazione (deterministico per accountId =
    // profileDir): mismatch login-vs-automation = forte segnale di detection nel momento piu'
    // sensibile (setting del cookie li_at). Ora login e automazione condividono lo STESSO fingerprint.
    // - proxy ESPLICITO: launchBrowser con options.proxy usa solo quel proxy (launchPlan=[proxy]) e
    //   NON ripiega su IP diretto, preservando il fail-closed AB-24 risolto sopra.
    // - headless:false per il login manuale. launchBrowser NON abilita il window click-through (lo
    //   fanno solo i flussi di automazione) -> la finestra resta interattiva per l'utente.
    const session = await launchBrowser({
        sessionDir: profileDir,
        headless: false,
        proxy,
    });

    try {
        const page = session.page;
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

        console.log(`[PROFILE] Directory: ${profileDir}`);
        console.log(
            `[PROFILE] Completa il login manualmente entro ${timeoutSeconds}s. I cookie verranno salvati nel profilo.`,
        );

        const timeoutAt = Date.now() + timeoutSeconds * 1000;
        let loginDetected = false;
        while (Date.now() < timeoutAt) {
            const cookies = await session.browser.cookies();
            if (cookies.some((cookie) => cookie.name === 'li_at')) {
                loginDetected = true;
                break;
            }
            await page.waitForTimeout(2500);
        }

        if (loginDetected) {
            // CL3: registra la baseline di freshness al momento del login reale, cosi' il countdown
            // di rotazione sessione (7gg) parte da ora e non dalla prima run di automazione.
            recordSuccessfulAuth(profileDir, 'create-profile');
            console.log('[PROFILE] Login rilevato e profilo persistente aggiornato.');
        } else {
            console.log('[PROFILE] Timeout raggiunto. Il profilo è stato comunque salvato con lo stato corrente.');
        }
    } finally {
        await closeBrowser(session).catch(() => {});
    }
}
