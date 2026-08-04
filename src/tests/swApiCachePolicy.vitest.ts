/**
 * Contratto di cache del service worker della dashboard (`public/sw.js`).
 *
 * Il file non è importabile: gira nel browser e si registra su `self`. Qui viene eseguito
 * per davvero dentro un contesto isolato con un `self` finto, così il test osserva il
 * comportamento del sorgente reale — non una sua riscrittura.
 *
 * Cosa protegge: la Cache API scrive su DISCO e sopravvive alla chiusura del browser.
 * Una risposta di `/api/export/leads` contiene nome, azienda, URL LinkedIn, email e telefono
 * dei lead: non deve finirci.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

type FetchHandler = (event: FakeFetchEvent) => void;

interface FakeFetchEvent {
    request: { url: string; method: string; headers: { get: (k: string) => string | null } };
    respondWith: (v: unknown) => void;
}

let fetchHandler: FetchHandler;

/** Esegue public/sw.js in un contesto isolato e restituisce l'handler `fetch` registrato. */
function loadServiceWorker(): FetchHandler {
    const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
    const handlers = new Map<string, FetchHandler>();

    const cacheStub = {
        keys: async () => [],
        put: async () => undefined,
        delete: async () => true,
        addAll: async () => undefined,
        match: async () => undefined,
    };

    const sandbox = {
        self: {
            addEventListener: (type: string, fn: FetchHandler) => handlers.set(type, fn),
            skipWaiting: () => undefined,
            clients: { claim: () => undefined },
            registration: { navigationPreload: { enable: () => Promise.resolve() } },
        },
        caches: {
            open: async () => cacheStub,
            keys: async () => [],
            delete: async () => true,
            match: async () => undefined,
        },
        fetch: async () => ({ ok: true, clone: () => ({}), headers: new Headers() }),
        Response,
        Headers,
        URL,
        console,
    };

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    const handler = handlers.get('fetch');
    if (!handler) throw new Error('sw.js non registra un handler fetch');
    return handler;
}

/** Simula una richiesta e riporta se il service worker l'ha intercettata (quindi cachata). */
function isIntercepted(url: string, method = 'GET'): boolean {
    let intercepted = false;
    fetchHandler({
        request: { url, method, headers: { get: () => null } },
        respondWith: (value) => {
            intercepted = true;
            void Promise.resolve(value).catch(() => undefined);
        },
    });
    return intercepted;
}

beforeAll(() => {
    fetchHandler = loadServiceWorker();
});

describe('service worker — nessun dato di persone finisce nella cache su disco', () => {
    const PII_ENDPOINTS = [
        'https://dash.local/api/export/leads?format=csv',
        'https://dash.local/api/leads/search?q=mario',
        'https://dash.local/api/leads/42',
        'https://dash.local/api/review-queue',
        'https://dash.local/api/blacklist',
        'https://dash.local/api/auth/session',
    ];

    it.each(PII_ENDPOINTS)('non intercetta %s', (url) => {
        expect(isIntercepted(url)).toBe(false);
    });

    it('non mette in cache uno stato live come /api/observability', () => {
        expect(isIntercepted('https://dash.local/api/observability')).toBe(false);
    });

    it('non intercetta un endpoint API nuovo mai dichiarato (allowlist, non denylist)', () => {
        expect(isIntercepted('https://dash.local/api/qualcosa-di-nuovo')).toBe(false);
    });
});

describe('service worker — la cache offline continua a servire i dati aggregati', () => {
    it.each([
        'https://dash.local/api/kpis',
        'https://dash.local/api/runs',
        'https://dash.local/api/stats/trend?days=7',
    ])('intercetta %s', (url) => {
        expect(isIntercepted(url)).toBe(true);
    });

    it('continua a servire gli asset statici', () => {
        expect(isIntercepted('https://dash.local/assets/bundle.js')).toBe(true);
        expect(isIntercepted('https://dash.local/')).toBe(true);
    });

    it('resta fuori dai non-GET e dal flusso eventi', () => {
        expect(isIntercepted('https://dash.local/api/kpis', 'POST')).toBe(false);
        expect(isIntercepted('https://dash.local/api/events')).toBe(false);
    });
});

describe('service worker — le risposte già salvate su disco vanno rimosse', () => {
    it('usa un nome di cache API diverso da quello che conteneva i dati dei lead', () => {
        const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
        // L'handler `activate` cancella le cache che non sono più nell'elenco valido:
        // finché il nome resta 'lkbot-api-v2', le risposte con PII restano sul disco.
        expect(source).not.toContain("CACHE_API = 'lkbot-api-v2'");
    });
});
