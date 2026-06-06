import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Verify AB-24 sul secondo launch-path: createProfile.ts.
 * Il browser di login (che setta il cookie li_at) non deve mai partire su IP diretto quando un
 * proxy gestito e' configurato. Stesso gate fail-closed di launchBrowser(): managed proxy ON +
 * nessun proxy risolto -> HALT (throw), mai login su IP reale. Nessun browser reale viene lanciato.
 */

const mocks = vi.hoisted(() => ({
    launchPersistentContext: vi.fn(),
    getStickyProxy: vi.fn(),
    getProxyFailoverChainAsync: vi.fn(),
    ensureDirectoryPrivate: vi.fn(),
    config: {
        browserEngine: 'chromium',
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

vi.mock('playwright', () => ({
    chromium: { launchPersistentContext: mocks.launchPersistentContext },
    firefox: { launchPersistentContext: mocks.launchPersistentContext },
}));

import { createPersistentProfile } from '../scripts/createProfile';

function fakeContext() {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    return {
        pages: vi.fn().mockReturnValue([page]),
        newPage: vi.fn().mockResolvedValue(page),
        // li_at presente al primo giro -> loginDetected, esce subito (niente loop da 900s).
        cookies: vi.fn().mockResolvedValue([{ name: 'li_at' }]),
        close: vi.fn().mockResolvedValue(undefined),
    };
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
        mocks.launchPersistentContext.mockResolvedValue(fakeContext());
    });

    test('managed proxy ON + pool vuoto -> HALT (throw AB-24), nessun browser lanciato', async () => {
        mocks.config.proxyListPath = './proxies.txt'; // managed proxy ON
        await expect(createPersistentProfile({ timeoutSeconds: 60 })).rejects.toThrow(/AB-24/);
        expect(mocks.launchPersistentContext).not.toHaveBeenCalled();
    });

    test('managed proxy ON + proxy risolto -> login lanciato CON quel proxy', async () => {
        mocks.config.proxyListPath = './proxies.txt';
        mocks.getProxyFailoverChainAsync.mockResolvedValue([
            { server: 'http://p1.example:8080', username: 'u', password: 'p' },
        ]);
        await createPersistentProfile({ timeoutSeconds: 60 });
        expect(mocks.launchPersistentContext).toHaveBeenCalledTimes(1);
        const ctxOptions = mocks.launchPersistentContext.mock.calls[0][1];
        expect(ctxOptions.proxy).toEqual({
            server: 'http://p1.example:8080',
            username: 'u',
            password: 'p',
        });
    });

    test('managed proxy OFF (nessun proxy configurato) -> launch senza proxy (dev/test legittimo)', async () => {
        // tutte le 3 sorgenti proxy vuote -> managedProxyEnabled = false
        await createPersistentProfile({ timeoutSeconds: 60 });
        expect(mocks.launchPersistentContext).toHaveBeenCalledTimes(1);
        const ctxOptions = mocks.launchPersistentContext.mock.calls[0][1];
        expect(ctxOptions.proxy).toBeUndefined();
    });

    test('preferisce lo sticky proxy quando disponibile', async () => {
        mocks.config.proxyListPath = './proxies.txt';
        mocks.getStickyProxy.mockResolvedValue({ server: 'http://sticky.example:9000' });
        mocks.getProxyFailoverChainAsync.mockResolvedValue([{ server: 'http://other.example:8080' }]);
        await createPersistentProfile({ timeoutSeconds: 60 });
        const ctxOptions = mocks.launchPersistentContext.mock.calls[0][1];
        expect(ctxOptions.proxy.server).toBe('http://sticky.example:9000');
        expect(mocks.getProxyFailoverChainAsync).not.toHaveBeenCalled();
    });
});
