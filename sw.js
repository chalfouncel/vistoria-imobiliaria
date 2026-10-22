const CACHE_NAME = 'vistoria-pro-v2'; // Mudamos para v2 para forçar a quebra do cache antigo

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Força o novo Service Worker a assumir imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/logo.png',
        '/marca-dagua.png'
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Limpa os caches antigos (v1) quando uma nova versão (v2, v3...) for instalada
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
