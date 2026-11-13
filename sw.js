const CACHE_NAME = 'manna-static-v30-lazy-qr';
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
    './wallet-utils.js',
    './image-preview.js',
    './image-loader.js',
    './theme.css',
    './theme-utils.js',
    './maintenance-mode.js',
    './maintenance-utils.mjs',
    './network-utils.mjs',
    './product-variant-utils.mjs',
    './customization-utils.mjs',
    './password-toggle.js',
    './pwa-install.js',
    './images/logo/marketplace-logo.svg',
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
    const isTrustedExternalScript = event.request.destination === 'script'
        && (
            (requestUrl.hostname === 'www.gstatic.com'
                && /^\/firebasejs\/10\.12\.2\/firebase-(?:app|auth|firestore|functions)-compat\.js$/.test(requestUrl.pathname))
            || (requestUrl.hostname === 'cdn.jsdelivr.net'
                && requestUrl.pathname === '/npm/qrcodejs@1.0.0/qrcode.min.js')
        );
    if ((requestUrl.origin !== self.location.origin && !isTrustedExternalScript) || event.request.method !== 'GET') {
        return;
    }

    const isStaticAsset = isTrustedExternalScript
        || event.request.mode === 'navigate'
        || /\.(?:html|js|mjs|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(requestUrl.pathname);
    if (!isStaticAsset) return;

    const cacheRequest = async (cache, response) => {
        if (response.redirected
            || (response.type === 'opaque' && !isTrustedExternalScript)
            || (response.type !== 'opaque' && !response.ok)
            || /no-store/i.test(response.headers.get('Cache-Control') || '')) {
            return response;
        }
        try {
            await cache.put(event.request, response.clone());
        } catch (error) {
            console.warn('[Manna Marketplace] Static cache update failed:', error);
        }
        return response;
    };

    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
            return await fetch(event.request).then((response) => cacheRequest(cache, response));
        } catch (error) {
            console.warn('[Manna Marketplace] Static asset request failed:', error);
            if (event.request.mode === 'navigate') {
                const appShell = await cache.match('./index.html');
                if (appShell) return appShell;
            }
            return new Response(
                event.request.mode === 'navigate' ? 'This page is unavailable offline.' : '',
                { status: 503, statusText: 'Service Unavailable' }
            );
        }
    }));
});
