const CACHE_NAME = 'manna-static-v3-current';
const ASSETS_TO_CACHE = [
    '/',
    './index.html',
    './admin.html',
    './seller.html',
    './customer.html',
    './delivery.html',
    './style.css',
    './app.js',
    './auth.js',
    './button-utils.js',
    './password-toggle.js',
    './images/logo/logo.svg',
    './favicon.ico',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);
    const isAppCode = requestUrl.origin === self.location.origin &&
        (event.request.mode === 'navigate' || /\.(?:html|js|mjs)$/.test(requestUrl.pathname));

    if (isAppCode) {
        event.respondWith(
            fetch(event.request).then((response) => {
                const responseCopy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
