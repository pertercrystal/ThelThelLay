// sw.js - Service Worker (fast install + background caching + stale-while-revalidate)

const CACHE = 'moneyflow-v1';
const CORE_ASSETS = [
  // critical assets required to start the app quickly.
  './index.html',
  './css/app.css',
  './css/ui-polish.css',
  './js/app.js',
  './manifest.webmanifest'
];

// optional assets we want cached eventually (background)
const OTHER_ASSETS = [
  './',
  './js/loan-logic.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Combined list (used by fallback if needed)
const ASSETS = CORE_ASSETS.concat(OTHER_ASSETS);

// Install: cache only core assets (fast). Do background caching of others (non-blocking).
self.addEventListener('install', event => {
  // Try to cache core assets but don't fail install if some fail.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch (err) {
      // swallow errors so install still completes quickly
      console.warn('sw: core asset caching partially failed', err);
    }
    // Start caching other assets in background (non-blocking)
    OTHER_ASSETS.forEach(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && res.ok) {
          await cache.put(url, res.clone());
        }
      } catch (e) {
        // ignore network errors for optional assets
      }
    });
  })());
  // Activate new SW immediately
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Claim clients so this SW becomes active immediately.
    await self.clients.claim();
    // Optionally remove old caches here if you version caches in future
    // const keys = await caches.keys();
    // await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  })());
});

// Fetch: serve from cache quickly, update cache in background (stale-while-revalidate)
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET navigation & same-origin requests; let others pass through.
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Try cache first
    const cached = await cache.match(req);
    // Kick off a network fetch to update the cache in background
    const networkUpdate = fetch(req).then(async (res) => {
      // Only cache successful same-origin responses
      try {
        if (res && res.ok) {
          await cache.put(req, res.clone());
        }
      } catch (e) {
        // ignore cache put errors
      }
      return res;
    }).catch(() => null);

    // If we have a cached response, return it immediately and still update cache in background
    if (cached) {
      // ensure networkUpdate runs but don't await it (stale-while-revalidate)
      networkUpdate.catch(()=>{});
      return cached;
    }

    // No cache: wait for network (or fallback to offline)
    const netRes = await networkUpdate;
    if (netRes) return netRes;

    // final fallback to root page from cache
    const fallback = await cache.match('./') || cache.match('./index.html');
    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
