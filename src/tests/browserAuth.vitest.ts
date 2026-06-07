/**
 * browserAuth.vitest.ts
 * Suite H23 — test per src/browser/auth.ts
 * Mocka l'oggetto Playwright Page: nessun browser reale.
 */

import { describe, it, expect, vi } from 'vitest';
import { isLoggedIn, detectChallenge, probeLinkedInStatus } from '../browser/auth';

// ─── Mock Page helper ─────────────────────────────────────────────────────────

type Cookie = { name: string; value: string };

function makeMockPage(opts: {
    url?: string;
    cookies?: Cookie[];
    textContent?: string;
    gotoStatus?: number;
    gotoThrows?: Error;
}): Parameters<typeof isLoggedIn>[0] {
    const url = opts.url ?? 'https://www.linkedin.com/feed/';
    const cookies = opts.cookies ?? [];
    const bodyText = opts.textContent ?? '';
    const gotoStatus = opts.gotoStatus ?? 200;

    const gotoImpl = opts.gotoThrows
        ? vi.fn().mockRejectedValue(opts.gotoThrows)
        : vi.fn().mockResolvedValue({ status: vi.fn().mockReturnValue(gotoStatus) });

    return {
        url: vi.fn().mockReturnValue(url),
        context: vi.fn().mockReturnValue({
            cookies: vi.fn().mockResolvedValue(cookies),
        }),
        locator: vi.fn().mockImplementation(() => ({
            count: vi.fn().mockResolvedValue(0),
        })),
        textContent: vi.fn().mockResolvedValue(bodyText),
        $: vi.fn().mockResolvedValue(null),
        goto: gotoImpl,
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof isLoggedIn>[0];
}

// ─── isLoggedIn ───────────────────────────────────────────────────────────────

describe('isLoggedIn', () => {
    it('URL /checkpoint/challenge → false (auth pattern match)', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/checkpoint/challenge',
            cookies: [{ name: 'li_at', value: 'valid-token' }],
        });
        expect(await isLoggedIn(page)).toBe(false);
    });

    it('URL /login → false', async () => {
        const page = makeMockPage({ url: 'https://www.linkedin.com/login' });
        expect(await isLoggedIn(page)).toBe(false);
    });

    it('URL /authwall → false', async () => {
        const page = makeMockPage({ url: 'https://www.linkedin.com/authwall?referralCode=abc' });
        expect(await isLoggedIn(page)).toBe(false);
    });

    it('nessun cookie li_at e nessuna navbar → false (cookie fallback returns false)', async () => {
        // url pulita, nessun cookie li_at, tutti i locator count=0
        const page = makeMockPage({
            url: 'https://www.linkedin.com/in/someone/',
            cookies: [{ name: 'JSESSIONID', value: 'xyz' }],
        });
        expect(await isLoggedIn(page)).toBe(false);
    });

    it('selettore globalNav trovato (count=1) → true', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            cookies: [],
        });
        // locator call sequence in isLoggedIn:
        //   call 1: loginForm selector → 0 (not on login page)
        //   call 2: globalNav selector → 1 (navbar present → logged in)
        let callIdx = 0;
        (page.locator as ReturnType<typeof vi.fn>).mockImplementation(() => {
            callIdx++;
            if (callIdx === 2) return { count: vi.fn().mockResolvedValue(1) };
            return { count: vi.fn().mockResolvedValue(0) };
        });
        expect(await isLoggedIn(page)).toBe(true);
    });

    it('cookie li_at presente, nessuna navbar, URL pulito → true (cookie fallback)', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/in/someone/',
            cookies: [{ name: 'li_at', value: 'valid-session-token' }],
            // All locator counts = 0 (default mock) → falls through to cookie check
        });
        expect(await isLoggedIn(page)).toBe(true);
    });
});

// ─── detectChallenge ──────────────────────────────────────────────────────────

describe('detectChallenge', () => {
    it('URL contiene "checkpoint" → true', async () => {
        const page = makeMockPage({ url: 'https://www.linkedin.com/checkpoint/challenge' });
        expect(await detectChallenge(page)).toBe(true);
    });

    it('URL contiene "captcha" → true', async () => {
        const page = makeMockPage({ url: 'https://www.linkedin.com/captcha/verify' });
        expect(await detectChallenge(page)).toBe(true);
    });

    it('URL normale, body contiene "temporarily blocked" → true', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            textContent: 'We have temporarily blocked your account.',
        });
        expect(await detectChallenge(page)).toBe(true);
    });

    it('URL e body puliti, nessun challengeSignal → false', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            textContent: 'Welcome to your feed!',
        });
        expect(await detectChallenge(page)).toBe(false);
    });

    it('challengeSignals selector trovato (count=1) → true', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            textContent: 'normal content',
        });
        (page.locator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
            count: vi.fn().mockResolvedValue(1),
        }));
        expect(await detectChallenge(page)).toBe(true);
    });
});

// ─── probeLinkedInStatus ──────────────────────────────────────────────────────

describe('probeLinkedInStatus', () => {
    it('success: logged in, no challenge, fast response → ok=true, reason=null', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            cookies: [],
            gotoStatus: 200,
        });
        // locator call sequence inside probeLinkedInStatus:
        //   isLoggedIn: call1=loginForm(0), call2=globalNav(1→logged in)
        //   detectChallenge: call3=challengeSignals(0→no challenge)
        let callIdx = 0;
        (page.locator as ReturnType<typeof vi.fn>).mockImplementation(() => {
            callIdx++;
            if (callIdx === 2) return { count: vi.fn().mockResolvedValue(1) }; // globalNav found
            return { count: vi.fn().mockResolvedValue(0) };
        });
        const result = await probeLinkedInStatus(page);
        expect(result.ok).toBe(true);
        expect(result.loggedIn).toBe(true);
        expect(result.challengeDetected).toBe(false);
        expect(result.reason).toBeNull();
    });

    it('failure: goto throws → ok=false, reason starts with PROBE_ERROR', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            gotoThrows: new Error('net::ERR_TIMED_OUT'),
        });
        const result = await probeLinkedInStatus(page);
        expect(result.ok).toBe(false);
        expect(result.loggedIn).toBe(false);
        expect(result.reason).toMatch(/PROBE_ERROR/);
    });

    it('HTTP 429 → ok=false, reason=HTTP_429_RATE_LIMITED', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/feed/',
            gotoStatus: 429,
        });
        const result = await probeLinkedInStatus(page);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('HTTP_429_RATE_LIMITED');
    });

    it('session expired (URL /login) → ok=false, reason=SESSION_EXPIRED', async () => {
        const page = makeMockPage({
            url: 'https://www.linkedin.com/login',
            cookies: [],
            gotoStatus: 200,
        });
        const result = await probeLinkedInStatus(page);
        expect(result.ok).toBe(false);
        expect(result.loggedIn).toBe(false);
        expect(result.reason).toBe('SESSION_EXPIRED');
    });
});
