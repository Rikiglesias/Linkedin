/**
 * Service Worker — LinkedIn Bot Dashboard PWA
 *
 * Strategy: Network-first for API calls, cache-first for static assets.
 */

const CACHE_NAME = 'lkbot-dashboard-v1';
const STATIC_ASSETS = [
    '/',
    '/style.css',
    '/assets/bundle.js',
    '/manifest.json',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET and SSE
    if (event.request.method !== 'GET' || url.pathname.startsWith('/api/events')) {
        return;
    }

    // API calls: network-first
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((resp) => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return resp;
                })
                .catch(() => caches.match(event.request).then((r) => r || new Response('{}', { status: 503 })))
        );
        return;
    }

    // Static assets: cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((resp) => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return resp;
            });
        })
    );
});
