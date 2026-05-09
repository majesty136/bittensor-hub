const CACHE = 'mining-hub-v5';
const PRECACHE = [
  '/bittensor-hub/app.html',
  '/bittensor-hub/config.js',
  '/bittensor-hub/mining-core.js',
  '/bittensor-hub/icons/icon-180.png',
  '/bittensor-hub/icons/icon-192.png',
  '/bittensor-hub/icons/icon-512.png',
];

// Install : met en cache toutes les ressources statiques (versions fraîches)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate : supprime les anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Status JSON — network first, cache fallback offline
  if (url.pathname.includes('/status/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML + JS — stale-while-revalidate :
  //   → sert le cache immédiatement (jamais vide)
  //   → met à jour le cache en arrière-plan
  //   → le prochain chargement aura la version fraîche
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const update = fetch(e.request).then(r => {
            cache.put(e.request, r.clone());
            return r;
          }).catch(() => null);
          return cached || update;
        })
      )
    );
    return;
  }

  // Icônes — cache first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
