/**
 * DreamLand service worker — offline app shell only.
 *
 * It caches the static shell (HTML, CSS, JS, fonts and bundled artwork) so the login
 * screen and the application chrome load without a network. It never caches chat,
 * character or secret data: anything under `/api/` (the legacy API and `/api/v1`),
 * any cross-origin request (model providers, TTS/STT extras servers) and every
 * non-GET request are always passed straight to the network.
 */

const CACHE_NAME = 'dreamland-shell-v5-async-startup';
const STATIC_FRESH_MS = 5 * 60 * 1000;

/** Asset extensions that belong to the shell and are safe to cache. */
const STATIC_EXTENSION = /\.(?:html|css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|json|map)$/i;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(['/', '/app', '/login', '/index.html', '/manifest.json']))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Writes and preflight requests never belong in the shell cache.
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    // Never cache another origin: model providers and extras servers are not the shell.
    if (url.origin !== self.location.origin) {
        return;
    }
    // Never cache account/chat/character/secret data.
    if (url.pathname.startsWith('/api/')) {
        return;
    }
    // Only cache the shell's static assets (or the bare app root).
    if (!['/', '/app', '/login'].includes(url.pathname) && !STATIC_EXTENSION.test(url.pathname)) {
        return;
    }

    // Navigations refresh online. Static assets reuse a short fresh window, then
    // refresh in the background; API responses never enter this cache.
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(request);
            const navigation = request.mode === 'navigate' || ['/', '/app', '/login', '/index.html'].includes(url.pathname);
            const cachedAt = cached ? Date.parse(cached.headers.get('date') || '') : NaN;
            if (!navigation && cached && Date.now() - cachedAt < STATIC_FRESH_MS) return cached;
            const network = fetch(request)
                .then(async (response) => {
                    if (response && response.ok) {
                        await cache.put(request, response.clone());
                    }
                    return response;
                })
                .catch(() => cached || Response.error());
            event.waitUntil(network);
            return navigation ? network : (cached || network);
        }),
    );
});
