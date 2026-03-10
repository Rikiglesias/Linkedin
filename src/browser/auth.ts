/**
 * browser/auth.ts
 * ─────────────────────────────────────────────────────────────────
 * Verifica dello stato di autenticazione LinkedIn e della presenza
 * di CAPTCHA/checkpoint nel browser Playwright.
 */

import { Page } from 'playwright';
import { joinSelectors } from '../selectors';
import { humanDelay } from './humanBehavior';

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

    // Fallback: se non siamo su /login e non c'e' form login, il cookie li_at
    // resta un indicatore utile ma non deve sovrascrivere segnali espliciti.
    return hasLinkedinAuthCookie(page);
}

/** Naviga alla home e verifica il login. */
export async function checkLogin(page: Page): Promise<boolean> {
    await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await humanDelay(page, 2000, 4000);
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
