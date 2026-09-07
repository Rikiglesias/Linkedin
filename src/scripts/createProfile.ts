import path from 'path';
import { resolveSessionDir } from '../accountManager';
import { config } from '../config';
import { ensureDirectoryPrivate } from '../security/filesystem';
import { getProxyFailoverChainAsync, getStickyProxy, type ProxyConfig } from '../proxyManager';
import { launchBrowser, closeBrowser } from '../browser/launcher';
import { profileHasCookies } from '../browser/browserIdentity';
import { recordSuccessfulAuth } from '../browser/sessionCookieMonitor';

export interface CreateProfileOptions {
    profileDir: string;
    loginUrl: string;
    timeoutSeconds: number;
    /** Account di cui aprire il jar quando `profileDir` non e' dato: senza, si aprirebbe il PRIMO. */
    accountId: string | null;
}

const DEFAULT_LOGIN_URL = 'https://www.linkedin.com/login';

/**
 * F-7c1a9e04 (anti-ban, trovato dal critico di fine blocco A): il default NON puo' essere una
 * costante di modulo. Era `<cwd>/profiles/linkedin-profile`, mentre `login`, `send-invites` e
 * `identity-init` passano da `resolveSessionDir()` (`data/session`): due cookie jar e due
 * `.fingerprint.json` per lo STESSO account, cioe' due dispositivi diversi per LinkedIn nel
 * momento piu' sensibile (il login che setta `li_at`). Il default e' ora la funzione unica di C53;
 * `--dir` resta sovrano per i profili usa-e-getta e la diagnostica.
 */
export function resolveProfileDir(rawDir: string | null | undefined, accountId?: string | null): string {
    if (!rawDir || !rawDir.trim()) {
        return resolveSessionDir(accountId);
    }
    const trimmed = rawDir.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

export async function createPersistentProfile(options: Partial<CreateProfileOptions> = {}): Promise<void> {
    // L'`accountId` va propagato: senza, un chiamante che passa solo `{timeoutSeconds}` aprirebbe il
    // PRIMO profilo configurato ignorando `--account`, cioe' il jar dell'account sbagliato proprio
    // durante un login — la classe che C53 e F-7c1a9e04 hanno appena chiuso.
    const profileDir = resolveProfileDir(options.profileDir, options.accountId);
    const loginUrl = options.loginUrl?.trim() || DEFAULT_LOGIN_URL;
    const timeoutSeconds = Math.max(60, Math.floor(options.timeoutSeconds ?? 900));

    // Il profilo e' GIA' autenticato: aprire il browser qui vorrebbe dire caricare la pagina di login
    // da loggati (redirect al feed) e chiudere entro un paio di secondi, perche' il loop di attesa non
    // gira. Ripetuto, e' un pattern di micro-sessioni da 2 secondi contro il principio delle sessioni
    // credibili — e il comando non farebbe comunque nulla di utile. Si controlla PRIMA di lanciare,
    // come fa gia' `identity-init`.
    if (profileHasCookies(profileDir)) {
        console.log(`[PROFILE] ${profileDir} ha gia' una sessione LinkedIn: nessun browser aperto.`);
        console.log('[PROFILE] Per un profilo separato usa --dir <path>; per rifare il login usa `bot.ps1 login`.');
        return;
    }

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

        // F-7c1a9e04 (secondo effetto, trovato dalla review anti-ban): ora che il default e' la
        // cartella dell'account, il jar puo' essere GIA' autenticato. Se `li_at` c'e' gia' al primo
        // controllo non e' avvenuto nessun login nuovo: registrare la baseline di freschezza
        // azzererebbe il countdown di rotazione (7gg) su una sessione vecchia, facendola sembrare
        // fresca. La baseline si scrive SOLO per un login davvero avvenuto in questo comando.
        const giaAutenticato = (await session.browser.cookies()).some((cookie) => cookie.name === 'li_at');
        const timeoutAt = Date.now() + timeoutSeconds * 1000;
        let loginDetected = false;
        while (!giaAutenticato && Date.now() < timeoutAt) {
            const cookies = await session.browser.cookies();
            if (cookies.some((cookie) => cookie.name === 'li_at')) {
                loginDetected = true;
                break;
            }
            await page.waitForTimeout(2500);
        }

        if (giaAutenticato) {
            console.log(
                `[PROFILE] Sessione gia' autenticata in ${profileDir}: nessun login eseguito, baseline di freschezza NON toccata. Usa --dir per un profilo separato.`,
            );
        } else if (loginDetected) {
            // CL3: registra la baseline di freshness al momento del login reale, cosi' il countdown
            // di rotazione sessione (7gg) parte da ora e non dalla prima run di automazione.
            await recordSuccessfulAuth(profileDir, 'create-profile');
            console.log('[PROFILE] Login rilevato e profilo persistente aggiornato.');
        } else {
            console.log('[PROFILE] Timeout raggiunto. Il profilo è stato comunque salvato con lo stato corrente.');
        }
    } finally {
        await closeBrowser(session).catch(() => {});
    }
}
