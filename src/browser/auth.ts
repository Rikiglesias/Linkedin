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
 * Rileva se LinkedIn ha presentato un challenge (CAPTCHA, verifica email,
 * account limitato). Controlla URL, selettori DOM e testo della pagina.
 */
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
