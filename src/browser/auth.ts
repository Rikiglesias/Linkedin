/**
 * browser/auth.ts
 * ─────────────────────────────────────────────────────────────────
 * Verifica dello stato di autenticazione LinkedIn e della presenza
 * di CAPTCHA/checkpoint nel browser Playwright.
 */

import { Page } from 'playwright';
import { joinSelectors } from '../selectors';

/** Verifica la presenza del cookie `li_at` (sessione LinkedIn valida). */
async function hasLinkedinAuthCookie(page: Page): Promise<boolean> {
    try {
        const cookies = await page.context().cookies('https://www.linkedin.com');
        return cookies.some((cookie) => cookie.name === 'li_at' && cookie.value.trim().length > 0);
    } catch {
        return false;
    }
}

/**
 * Ritorna `true` se il browser risulta autenticato su LinkedIn.
 * Controlla: cookie `li_at`, presenza navbar globale, assenza pagina login.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    const currentUrl = page.url().toLowerCase();
    const authPatterns = [
        '/login',
        '/uas/login',
        '/checkpoint',
        '/checkpoint/challenge',
        '/challenge',
        '/authwall',
        '/signup',
        '/reauthentication',
        '/sessionPasswordChallenge',
    ];
    if (authPatterns.some((p) => currentUrl.includes(p))) {
        return false;
    }

    const loginForm = await page.locator('form[action*="login"], input[name="session_key"]').count();
    if (loginForm > 0) {
        return false;
    }

    const count = await page.locator(joinSelectors('globalNav')).count();
    if (count > 0) {
        return true;
    }

    // Sales Navigator ha una navbar diversa da LinkedIn standard
    const salesNavNav = await page.locator(
        '.global-nav, [data-test-global-nav], .nav-main, #global-nav, .search-global-typeahead',
    ).count();
    if (salesNavNav > 0) {
        return true;
    }

    // Se siamo su una pagina /sales/ senza form di login, siamo autenticati
    if (currentUrl.includes('/sales/') && !currentUrl.includes('/sales/login')) {
        return true;
    }

    // Fallback: se non siamo su /login e non c'e' form login, il cookie li_at
    // resta un indicatore utile ma non deve sovrascrivere segnali espliciti.
    return hasLinkedinAuthCookie(page);
}

/** Naviga al feed (endpoint protetto, redirect a login se sessione scaduta) e verifica il login. */
export async function checkLogin(page: Page): Promise<boolean> {
    const response = await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Delay semplice post-navigazione (non serve humanDelay con distribuzione log-normale qui —
    // checkLogin è un check tecnico, non un'azione visibile da LinkedIn).
    // Rimosso import humanDelay per rompere circular dep auth↔humanBehavior.
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));
    // Se LinkedIn ha fatto redirect a login, la risposta HTTP originale è 302
    // ma dopo il redirect siamo su /login → isLoggedIn lo rileva via URL
    const finalUrl = page.url().toLowerCase();
    if (finalUrl.includes('/login') || finalUrl.includes('/authwall') || finalUrl.includes('/uas/login')) {
        return false;
    }
    // H01: Rileva pagina di verifica 2FA (TOTP, SMS, email).
    // Se LinkedIn richiede 2FA, il bot resta sulla pagina di verifica senza errore esplicito.
    // Ora: rileva subito e ritorna false con log chiaro per l'utente.
    const verificationPatterns = [
        '/checkpoint/challenge',
        '/checkpoint/lg/login-submit',
        '/uas/login-submit',
        'two-step-verification',
        'sessionPasswordChallenge',
    ];
    if (verificationPatterns.some((p) => finalUrl.includes(p))) {
        console.error('[AUTH] ❌ LinkedIn richiede verifica 2FA/TOTP. Azione: completare la verifica manualmente, poi riprovare.');
        // GAP6-H01: quarantineAccount + alert Telegram per visibilità immediata
        try {
            const { quarantineAccount } = await import('../risk/incidentManager');
            await quarantineAccount('LOGIN_2FA_REQUIRED', {
                message: 'LinkedIn richiede verifica 2FA/TOTP — intervento manuale necessario.',
                url: finalUrl,
            });
        } catch { /* best-effort */ }
        try {
            const { sendTelegramAlert } = await import('../telemetry/alerts');
            await sendTelegramAlert(
                `🔐 **LinkedIn richiede verifica 2FA**\n\nURL: ${finalUrl}\n\nAzione richiesta:\n1. Aprire il browser manualmente\n2. Completare la verifica\n3. Eseguire \`bot.ps1 unquarantine\` per riprendere`,
                'Login 2FA Required',
                'critical',
            ).catch(() => null);
        } catch { /* best-effort */ }
        return false;
    }
    // Controlla anche lo status HTTP (429 = rate limited, 403 = bloccato)
    const status = response?.status() ?? 200;
    if (status === 429 || status === 403) {
        return false;
    }
    return isLoggedIn(page);
}

/**
 * Probe proattivo dello stato LinkedIn prima di lanciare job.
 * Naviga alla home e verifica: login, challenge, response time.
 * Ritorna un oggetto con lo stato e il motivo per non procedere.
 */
export interface LinkedInProbeResult {
    ok: boolean;
    loggedIn: boolean;
    challengeDetected: boolean;
    responseTimeMs: number;
    reason: string | null;
}

export async function probeLinkedInStatus(page: Page): Promise<LinkedInProbeResult> {
    const startMs = Date.now();
    try {
        const response = await page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        const responseTimeMs = Date.now() - startMs;
        const httpStatus = response?.status() ?? 0;

        if (httpStatus === 429) {
            return { ok: false, loggedIn: false, challengeDetected: false, responseTimeMs, reason: 'HTTP_429_RATE_LIMITED' };
        }

        const loggedIn = await isLoggedIn(page);
        if (!loggedIn) {
            return { ok: false, loggedIn: false, challengeDetected: false, responseTimeMs, reason: 'SESSION_EXPIRED' };
        }

        const challenge = await detectChallenge(page);
        if (challenge) {
            return { ok: false, loggedIn: true, challengeDetected: true, responseTimeMs, reason: 'CHALLENGE_ACTIVE' };
        }

        if (responseTimeMs > 15_000) {
            return { ok: false, loggedIn: true, challengeDetected: false, responseTimeMs, reason: 'SLOW_RESPONSE' };
        }

        return { ok: true, loggedIn: true, challengeDetected: false, responseTimeMs, reason: null };
    } catch (error) {
        const responseTimeMs = Date.now() - startMs;
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, loggedIn: false, challengeDetected: false, responseTimeMs, reason: `PROBE_ERROR: ${message}` };
    }
}

export async function detectChallenge(page: Page): Promise<boolean> {
    const currentUrl = page.url().toLowerCase();
    const challengeInUrl = [
        'checkpoint',
        'challenge',
        'captcha',
        'security-verification',
        'reauthentication',
        'sessionPasswordChallenge',
    ].some((token) => currentUrl.includes(token));
    if (challengeInUrl) {
        return true;
    }

    const selectorMatches = await page.locator(joinSelectors('challengeSignals')).count();
    if (selectorMatches > 0) {
        return true;
    }

    const pageText = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? '';
    if (!pageText) {
        return false;
    }
    return /temporarily blocked|temporaneamente bloccato|restricted your account|account limitato/.test(pageText);
}
