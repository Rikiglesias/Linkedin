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

const DEFAULT_JA3 =
    '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53-10,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0';

export const desktopFingerprintPool: Fingerprint[] = [
    {
        id: 'desktop_chrome_win_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_win_2',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1536, height: 864 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_mac_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_chrome_linux_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_edge_win_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
        viewport: { width: 1600, height: 900 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
    {
        id: 'desktop_firefox_win_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
        viewport: { width: 1280, height: 720 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
    },
];

export const mobileFingerprintPool: Fingerprint[] = [
    {
        id: 'mobile_ios_safari_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_ios_chrome_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1',
        viewport: { width: 393, height: 852 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_chrome_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        viewport: { width: 412, height: 915 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2.625,
    },
    {
        id: 'mobile_android_chrome_2',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
        viewport: { width: 360, height: 800 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_firefox_1',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0',
        viewport: { width: 360, height: 780 },
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    },
    {
        id: 'mobile_android_chrome_3',
        ja3: DEFAULT_JA3,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; 2306EPN60G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
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

