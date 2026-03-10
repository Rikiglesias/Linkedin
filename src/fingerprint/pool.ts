export interface Fingerprint {
    id: string;
    ja3: string;
    userAgent: string;
    viewport: { width: number; height: number };
    timezone?: string;
    locale?: string;
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
}

/**
 * JA3 fingerprints per browser family.
 * NOTE: These are metadata only — Playwright always uses Chromium's TLS stack
 * regardless of the spoofed UA. Real JA3 spoofing requires CycleTLS proxy or
 * a TLS-patched binary. When CycleTLS is active, these values are forwarded
 * to the proxy for accurate TLS fingerprinting.
 */
const JA3_CHROME =
    '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const JA3_FIREFOX =
    '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0';
const JA3_SAFARI =
    '771,4865-4866-4867-49196-49195-52393-49200-49199-52392-49162-49161-49172-49171-157-156-53-47,0-23-65281-10-11-16-5-13-18-51-45-43-27-17513-21,29-23-24-25,0';
const JA3_EDGE = JA3_CHROME;

export const desktopFingerprintPool: Fingerprint[] = [
    {
        id: 'desktop_chrome_win_1',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_win_2',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1536, height: 864 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_mac_1',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_linux_1',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_edge_win_1',
        ja3: JA3_EDGE,
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
        viewport: { width: 1600, height: 900 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_firefox_win_1',
        ja3: JA3_FIREFOX,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
        viewport: { width: 1280, height: 720 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
];

export const mobileFingerprintPool: Fingerprint[] = [
    {
        id: 'mobile_ios_safari_1',
        ja3: JA3_SAFARI,
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_ios_chrome_1',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/132.0.0.0 Mobile/15E148 Safari/604.1',
        viewport: { width: 393, height: 852 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_chrome_1',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
        viewport: { width: 412, height: 915 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2.625,
    },
    {
        id: 'mobile_android_chrome_2',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        viewport: { width: 360, height: 800 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_firefox_1',
        ja3: JA3_FIREFOX,
        userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:134.0) Gecko/134.0 Firefox/134.0',
        viewport: { width: 360, height: 780 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_chrome_3',
        ja3: JA3_CHROME,
        userAgent:
            'Mozilla/5.0 (Linux; Android 14; 2306EPN60G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
        viewport: { width: 393, height: 873 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2.75,
    },
];

export function pickRandomFingerprint(pool: ReadonlyArray<Fingerprint>): Fingerprint {
    const safePool = pool.length > 0 ? pool : desktopFingerprintPool;
    const index = Math.floor(Math.random() * safePool.length);
    return safePool[index] as Fingerprint;
}

/**
 * Selezione deterministica dal pool basata su accountId + settimana corrente.
 * Lo stesso account ottiene lo stesso fingerprint per ~1 settimana, poi cambia
 * (simula aggiornamento browser naturale). Usa FNV-1a come hash veloce.
 */
export function pickDeterministicFingerprint(
    pool: ReadonlyArray<Fingerprint>,
    accountId: string,
): Fingerprint {
    const safePool = pool.length > 0 ? pool : desktopFingerprintPool;
    if (safePool.length === 1) return safePool[0] as Fingerprint;

    // Week number: cambia ogni ~7 giorni → il fingerprint ruota settimanalmente
    const now = new Date();
    const weekNumber = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
    const seed = `${accountId}:week${weekNumber}`;

    // FNV-1a 32-bit hash per determinismo veloce senza dipendenze crypto
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const index = (hash >>> 0) % safePool.length;
    return safePool[index] as Fingerprint;
}
