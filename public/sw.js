/* Backrooms Field Manual service worker.
 * The build/precache placeholders below are injected by scripts/finalize_sw.mjs
 * at build time; a new deploy gets a new VERSION and old caches are purged.
 */

const VERSION = '__BUILD__';
const BASE = '/backrooms-wiki/';
const CACHE = `etb-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      caches.match(request).then((hit) => {
        if (!settled && hit) {
          settled = true;
          resolve(hit);
        }
      });
    }, timeoutMs);

    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        if (!settled) {
          settled = true;
          resolve(res);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        caches.match(request).then((hit) => {
          if (settled) return;
          settled = true;
          resolve(hit ?? caches.match(BASE + 'offline/'));
        });
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;

  // hashed build assets: cache-first (immutable)
  if (url.pathname.startsWith(BASE + '_astro/') || url.pathname.startsWith(BASE + 'fonts/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // images: stale-while-revalidate
  if (url.pathname.startsWith(BASE + 'images/') || url.pathname.startsWith(BASE + 'icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const refresh = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit ?? refresh;
      }),
    );
    return;
  }

  // navigations + data: network-first with a 3s cache fallback
  if (request.mode === 'navigate' || url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(request, 3000));
  }
});
