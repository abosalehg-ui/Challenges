// ============================================================
// SERVICE WORKER — offline-first cache strategy
// ============================================================
// CACHE_NAME must be bumped on every release that changes any cached asset,
// and ASSETS must list every deployable file (checked by scripts/validate-sw.mjs)
const CACHE_NAME = 'mind-challenge-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/utils.js',
  './js/storage.js',
  './js/audio.js',
  './js/scene.js',
  './js/game.js',
  './data/questions.json',
  './lib/three.min.js',
  './fonts/fonts.css',
  './fonts/amiri-400-arabic.woff2',
  './fonts/amiri-400-latin-ext.woff2',
  './fonts/amiri-400-latin.woff2',
  './fonts/amiri-700-arabic.woff2',
  './fonts/amiri-700-latin-ext.woff2',
  './fonts/amiri-700-latin.woff2',
  './fonts/tajawal-400-arabic.woff2',
  './fonts/tajawal-400-latin.woff2',
  './fonts/tajawal-500-arabic.woff2',
  './fonts/tajawal-500-latin.woff2',
  './fonts/tajawal-700-arabic.woff2',
  './fonts/tajawal-700-latin.woff2',
  './fonts/tajawal-800-arabic.woff2',
  './fonts/tajawal-800-latin.woff2',
  './fonts/tajawal-900-arabic.woff2',
  './fonts/tajawal-900-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/favicon.svg'
];

// Icons and the heavier Latin font subsets may fail without breaking the
// app (Arabic subsets and fonts.css are what the UI actually needs);
// everything else is critical.
const OPTIONAL = new Set([
  './fonts/amiri-400-latin-ext.woff2',
  './fonts/amiri-400-latin.woff2',
  './fonts/amiri-700-latin-ext.woff2',
  './fonts/amiri-700-latin.woff2',
  './fonts/tajawal-400-latin.woff2',
  './fonts/tajawal-500-latin.woff2',
  './fonts/tajawal-700-latin.woff2',
  './fonts/tajawal-800-latin.woff2',
  './fonts/tajawal-900-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/favicon.svg'
]);

self.addEventListener('install', (event) => {
  const core = ASSETS.filter((a) => !OPTIONAL.has(a));
  const optional = ASSETS.filter((a) => OPTIONAL.has(a));
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll is atomic: if any critical asset fails, install fails and the
      // old worker keeps serving — no half-cached, partially-broken release.
      cache.addAll(core).then(() =>
        Promise.all(
          optional.map((url) =>
            cache.add(url).catch((err) => console.warn('Failed to cache', url, err))
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first: precached assets are served straight from the cache with no
  // per-request background revalidation, so a single load can't mix a new
  // index.html with a stale game.js. Updates ship via a CACHE_NAME bump.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
