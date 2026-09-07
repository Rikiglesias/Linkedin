import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Verify AB-24 sul secondo launch-path: createProfile.ts.
 * Il browser di login (che setta il cookie li_at) non deve mai partire su IP diretto quando un
 * proxy gestito e' configurato. Stesso gate fail-closed di launchBrowser(): managed proxy ON +
 * nessun proxy risolto -> HALT (throw), mai login su IP reale. Nessun browser reale viene lanciato.
 *
 * CL3 (collaudo): createProfile ora RIUSA launchBrowser() (stesso fingerprint stealth di login e
 * automazione, no mismatch di detection) passandogli il proxy risolto in modo ESPLICITO (cosi'
 * launchBrowser non puo' ripiegare su IP diretto). Il test mocka launchBrowser e verifica che
 * (a) su pool vuoto NON venga chiamato, (b) altrimenti riceva il proxy corretto.
 */

const mocks = vi.hoisted(() => ({
    launchBrowser: vi.fn(),
    closeBrowser: vi.fn(),
    recordSuccessfulAuth: vi.fn(),
    getStickyProxy: vi.fn(),
    getProxyFailoverChainAsync: vi.fn(),
    ensureDirectoryPrivate: vi.fn(),
    config: {
        browserEngine: 'chromium',
        // F-7c1a9e04: il default del profilo passa da resolveSessionDir(), che legge queste due.
        sessionDir: './data/session',
        multiAccountEnabled: false,
        proxyUrl: '',
        proxyListPath: '',
        proxyProviderApiEndpoint: undefined as string | undefined,
        proxyMobilePriorityEnabled: false,
    },
}));

vi.mock('../config', () => ({ config: mocks.config }));

vi.mock('../proxyManager', () => ({
    getStickyProxy: mocks.getStickyProxy,
    getProxyFailoverChainAsync: mocks.getProxyFailoverChainAsync,
}));

vi.mock('../security/filesystem', () => ({
    ensureDirectoryPrivate: mocks.ensureDirectoryPrivate,
}));

vi.mock('../browser/launcher', () => ({
    launchBrowser: mocks.launchBrowser,
    closeBrowser: mocks.closeBrowser,
}));

vi.mock('../browser/sessionCookieMonitor', () => ({
    recordSuccessfulAuth: mocks.recordSuccessfulAuth,
}));

import { createPersistentProfile } from '../scripts/createProfile';

/**
 * `giaAutenticato` (F-7c1a9e04): il PRIMO `cookies()` decide se il jar era gia' loggato PRIMA di
 * questo comando. Default = jar vuoto al primo controllo e `li_at` al secondo, cioe' un login vero
 * avvenuto durante il comando (niente loop da 900s). Con `gia: true` il jar e' gia' autenticato.
 */
function fakeSession(opzioni: { gia?: boolean } = {}) {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const cookies = opzioni.gia
        ? vi.fn().mockResolvedValue([{ name: 'li_at' }])
        : vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ name: 'li_at' }]);
    return { page, browser: { cookies } };
}

describe('createProfile AB-24 — login mai su IP diretto', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config.browserEngine = 'chromium';
        mocks.config.proxyUrl = '';
        mocks.config.proxyListPath = '';
        mocks.config.proxyProviderApiEndpoint = undefined;
        mocks.config.proxyMobilePriorityEnabled = false;
        mocks.getStickyProxy.mockResolvedValue(undefined);
        mocks.getProxyFailoverChainAsync.mockResolvedValue([]);
        mocks.launchBrowser.mockResolvedValue(fakeSession());
        mocks.closeBrowser.mockResolvedValue(undefined);
    });

    test('managed proxy ON + pool vuoto -> HALT (throw AB-24), nessun browser lanciato', async () => {
        mocks.config.proxyListPath = './proxies.txt'; // managed proxy ON
        await expect(createPersistentProfile({ timeoutSeconds: 60 })).rejects.toThrow(/AB-24/);
        expect(mocks.launchBrowser).not.toHaveBeenCalled();
    });

    test('managed proxy ON + proxy risolto -> launchBrowser CON quel proxy esplicito', async () => {
        mocks.config.proxyListPath = './proxies.txt';
        mocks.getProxyFailoverChainAsync.mockResolvedValue([
            { server: 'http://p1.example:8080', username: 'u', password: 'p' },
        ]);
        await createPersistentProfile({ timeoutSeconds: 60 });
        expect(mocks.launchBrowser).toHaveBeenCalledTimes(1);
        const launchOptions = mocks.launchBrowser.mock.calls[0][0];
        expect(launchOptions.proxy).toEqual({
            server: 'http://p1.example:8080',
            username: 'u',
            password: 'p',
        });
        expect(launchOptions.headless).toBe(false);
        // login riuscito -> baseline freshness registrata
        expect(mocks.recordSuccessfulAuth).toHaveBeenCalledWith(expect.any(String), 'create-profile');
    });

    test('managed proxy OFF (nessun proxy configurato) -> launchBrowser senza proxy (dev/test legittimo)', async () => {
        // tutte le 3 sorgenti proxy vuote -> managedProxyEnabled = false
        await createPersistentProfile({ timeoutSeconds: 60 });
        expect(mocks.launchBrowser).toHaveBeenCalledTimes(1);
        const launchOptions = mocks.launchBrowser.mock.calls[0][0];
        expect(launchOptions.proxy).toBeUndefined();
    });

    test('jar GIA autenticato -> nessun login nuovo, baseline di freschezza NON toccata', async () => {
        // F-7c1a9e04: col default sulla cartella dell'account il jar puo' essere gia' loggato.
        // Registrare la baseline qui direbbe al bot che la sessione e' fresca di oggi e ritarderebbe
        // la rotazione dei 7 giorni su cookie vecchi.
        mocks.launchBrowser.mockResolvedValue(fakeSession({ gia: true }));
        await createPersistentProfile({ timeoutSeconds: 60 });
        expect(mocks.launchBrowser).toHaveBeenCalledTimes(1);
        expect(mocks.recordSuccessfulAuth).not.toHaveBeenCalled();
        expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
    });

    test('preferisce lo sticky proxy quando disponibile', async () => {
        mocks.config.proxyListPath = './proxies.txt';
        mocks.getStickyProxy.mockResolvedValue({ server: 'http://sticky.example:9000' });
        mocks.getProxyFailoverChainAsync.mockResolvedValue([{ server: 'http://other.example:8080' }]);
        await createPersistentProfile({ timeoutSeconds: 60 });
        const launchOptions = mocks.launchBrowser.mock.calls[0][0];
        expect(launchOptions.proxy.server).toBe('http://sticky.example:9000');
        expect(mocks.getProxyFailoverChainAsync).not.toHaveBeenCalled();
    });
});
