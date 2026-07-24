/* Backrooms Field Manual service worker.
 * The build/precache placeholders below are injected by scripts/finalize_sw.mjs
 * at build time; a new deploy gets a new VERSION and old caches are purged.
 */

const VERSION = '86d2fac-1784874236';
const BASE = '/backrooms-wiki/';
const CACHE = `etb-${VERSION}`;
const PRECACHE = ["/backrooms-wiki/","/backrooms-wiki/levels/","/backrooms-wiki/entities/","/backrooms-wiki/items/","/backrooms-wiki/guides/","/backrooms-wiki/progress/","/backrooms-wiki/offline/","/backrooms-wiki/search-index.json","/backrooms-wiki/manifest.webmanifest","/backrooms-wiki/fonts/ibm-plex-mono-latin-400.woff2","/backrooms-wiki/fonts/ibm-plex-mono-latin-600.woff2","/backrooms-wiki/icons/icon-192.png","/backrooms-wiki/_astro/BaseLayout.astro_astro_type_script_index_0_lang.DWAI6fe1.js","/backrooms-wiki/_astro/_id_.BBig3o26.css","/backrooms-wiki/_astro/_id_.astro_astro_type_script_index_0_lang.C46Hxk36.js","/backrooms-wiki/_astro/_id_.astro_astro_type_script_index_0_lang.Qee1_yWW.js","/backrooms-wiki/_astro/index.astro_astro_type_script_index_0_lang.BYO0RK9N.js","/backrooms-wiki/_astro/index.astro_astro_type_script_index_1_lang.Cucl0wHQ.js","/backrooms-wiki/_astro/personal.ChS9U3yj.js","/backrooms-wiki/_astro/progress.DRstuqxw.js","/backrooms-wiki/_astro/progress.astro_astro_type_script_index_0_lang.CB5ACdhk.js","/backrooms-wiki/_astro/toast.z_aDff4Z.js","/backrooms-wiki/images/levels/level-0/thumb.png","/backrooms-wiki/images/levels/level-1/thumb.png","/backrooms-wiki/images/levels/the-hub/thumb.jpg","/backrooms-wiki/images/levels/level-2/thumb.jpg","/backrooms-wiki/images/levels/level-3/thumb.jpg","/backrooms-wiki/images/levels/level-4/thumb.png","/backrooms-wiki/images/levels/level-5/thumb.png","/backrooms-wiki/images/levels/level-fun/thumb.jpg","/backrooms-wiki/images/levels/level-37/thumb.jpg","/backrooms-wiki/images/levels/level-exclamation/thumb.jpg","/backrooms-wiki/images/levels/the-end/thumb.png","/backrooms-wiki/images/levels/level-94/thumb.jpg","/backrooms-wiki/images/levels/level-6/thumb.jpg","/backrooms-wiki/images/levels/level-7/thumb.png","/backrooms-wiki/images/levels/level-8/thumb.png","/backrooms-wiki/images/levels/level-0-11/thumb.png","/backrooms-wiki/images/levels/level-9/thumb.png","/backrooms-wiki/images/levels/level-10/thumb.png","/backrooms-wiki/images/levels/level-3999/thumb.png","/backrooms-wiki/images/levels/level-0-2/thumb.png","/backrooms-wiki/images/levels/the-snackrooms/thumb.png","/backrooms-wiki/images/levels/level-exclamation-tilde-exclamation/thumb.jpg","/backrooms-wiki/images/levels/level-188/thumb.png","/backrooms-wiki/images/levels/level-37-2/thumb.png","/backrooms-wiki/images/levels/level-fun-plus/thumb.jpg","/backrooms-wiki/images/levels/level-52/thumb.jpg","/backrooms-wiki/images/levels/level-55-1/thumb.png"];

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
