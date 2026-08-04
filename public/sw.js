/**
 * Service Worker — LinkedIn Bot Dashboard PWA
 *
 * Strategie:
 *   /assets/*  → stale-while-revalidate (serve cache, aggiorna in background)
 *   /api/*     → network-first con fallback cache (max-age 5min)
 *   /          → stale-while-revalidate (shell HTML)
 *   SSE/POST   → skip (non cacheable)
 */

const CACHE_STATIC = 'lkbot-static-v2';
// v3: il nome cambia apposta. All'attivazione le cache non piu' valide vengono cancellate,
// ed e' l'unico modo di rimuovere dal disco le risposte con dati personali gia' salvate
// dalla versione precedente, che cacheava qualunque GET sotto /api/.
const CACHE_API = 'lkbot-api-v3';
const API_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const API_CACHE_MAX_ENTRIES = 50;

/**
 * Gli UNICI endpoint che possono finire su disco: dati aggregati, nessun dato di persone.
 * E' una allowlist a corrispondenza esatta, non un prefisso: un endpoint nuovo resta fuori
 * finche' non lo si aggiunge qui di proposito.
 *
 * Fuori da questa lista sta tutto cio' che riguarda persone o sessioni — /api/leads,
 * /api/export/leads (nome, azienda, URL LinkedIn, email, telefono), /api/review-queue,
 * /api/blacklist, /api/auth/session — e lo stato live come /api/observability, dove una
 * copia di cinque minuti fa inganna invece di aiutare.
 */
const CACHEABLE_API_PATHS = new Set([
    '/api/kpis',
    '/api/runs',
    '/api/stats/trend',
]);

const PRECACHE_URLS = [
    '/',
    '/style.css',
    '/assets/bundle.js',
    '/manifest.json',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

// Activate: clean old caches, enable navigation preload
self.addEventListener('activate', (event) => {
    const VALID_CACHES = new Set([CACHE_STATIC, CACHE_API]);
    event.waitUntil(
        Promise.all([
            caches.keys().then((keys) =>
                Promise.all(keys.filter((k) => !VALID_CACHES.has(k)).map((k) => caches.delete(k)))
            ),
            self.registration.navigationPreload && self.registration.navigationPreload.enable(),
        ])
    );
    self.clients.claim();
});

// Trim API cache to max entries (LRU-like: delete oldest)
async function trimApiCache() {
    const cache = await caches.open(CACHE_API);
    const keys = await cache.keys();
    if (keys.length > API_CACHE_MAX_ENTRIES) {
        const toDelete = keys.slice(0, keys.length - API_CACHE_MAX_ENTRIES);
        await Promise.all(toDelete.map((k) => cache.delete(k)));
    }
}

// Check if cached API response is still fresh
function isApiFresh(response) {
    const cached = response.headers.get('sw-cached-at');
    if (!cached) return false;
    return (Date.now() - Number(cached)) < API_CACHE_MAX_AGE_MS;
}

// Clone response with timestamp header for API cache
function stampResponse(response) {
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(Date.now()));
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

// Stale-while-revalidate for static assets
function staleWhileRevalidate(request) {
    return caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((resp) => {
            if (resp.ok) {
                const clone = resp.clone();
                caches.open(CACHE_STATIC).then((cache) => cache.put(request, clone));
            }
            return resp;
        });

        return cached || networkFetch;
    });
}

// Network-first with cache fallback for API
async function networkFirstApi(request) {
    try {
        const resp = await fetch(request);
        if (resp.ok) {
            const stamped = stampResponse(resp.clone());
            const cache = await caches.open(CACHE_API);
            await cache.put(request, stamped);
            trimApiCache();
        }
        return resp;
    } catch {
        const cached = await caches.match(request);
        if (cached && isApiFresh(cached)) {
            return cached;
        }
        if (cached) {
            return cached;
        }
        return new Response(JSON.stringify({ error: 'offline', cached: false }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET, SSE streams, and WebSocket upgrades
    if (
        event.request.method !== 'GET' ||
        url.pathname.startsWith('/api/events') ||
        event.request.headers.get('accept') === 'text/event-stream'
    ) {
        return;
    }

    // API: solo gli endpoint aggregati dichiarati sopra vengono messi in cache.
    // Tutti gli altri escono di qui senza respondWith, cioe' li serve la rete e non
    // toccano il disco — devono uscire PRIMA della cache statica qui sotto, che non ha
    // nemmeno una scadenza.
    if (url.pathname.startsWith('/api/')) {
        if (CACHEABLE_API_PATHS.has(url.pathname)) {
            event.respondWith(networkFirstApi(event.request));
        }
        return;
    }

    // Static assets (/assets/*, /style.css, /, /manifest.json): stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
});
