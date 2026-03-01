/**
 * browser/stealth.ts
 * ─────────────────────────────────────────────────────────────────
 * Fingerprint selection + anti-bot init script iniettato nelle pagine.
 */

export interface CloudFingerprint {
    userAgent: string;
    viewport?: { width: number; height: number };
}

export interface BrowserFingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
];

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function pickBrowserFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>): BrowserFingerprint {
    if (cloudFingerprints.length > 0) {
        const fp = randomElement(cloudFingerprints);
        return {
            userAgent: fp.userAgent,
            viewport: fp.viewport ?? randomElement(VIEWPORTS),
        };
    }

    return {
        userAgent: randomElement(USER_AGENTS),
        viewport: randomElement(VIEWPORTS),
    };
}
