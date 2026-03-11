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
const CACHE_API = 'lkbot-api-v2';
const API_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const API_CACHE_MAX_ENTRIES = 50;

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

    // API calls: network-first with stale cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstApi(event.request));
        return;
    }

    // Static assets (/assets/*, /style.css, /, /manifest.json): stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
});
