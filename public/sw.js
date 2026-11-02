/*
 * Service worker: makes the game playable with no signal once it has been
 * opened once.
 *
 * Vite hashes the built filenames, so there is no point listing them here -
 * the shell below is only what is needed to boot, and everything else is
 * cached the first time it is fetched. Hashed files never change under a
 * given name, so cache-first is safe for them; a new build simply asks for
 * new names.
 *
 * Bump VERSION to throw away every cached file on the next visit.
 */

const VERSION = 'hex-island-v1';

/** Enough to render the menu offline. Paths are relative to the SW's own URL. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // One missing file must not fail the whole install, so these go in
      // one at a time rather than through addAll.
      await Promise.allSettled(
        SHELL.map((path) => cache.add(new Request(path, { cache: 'reload' }))),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations go to the network first, so a new build is picked up as soon
  // as there is a connection, and fall back to the cached shell when there
  // is not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // Opaque and error responses are not worth keeping.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
