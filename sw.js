// CryptoFlow Service Worker
const CACHE_VERSION = 'cryptoflow-v1.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Archivos que SIEMPRE estarán en caché (la app misma)
const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Instalación: cachear archivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('SW: error cacheando algunos archivos', err));
    }).then(() => self.skipWaiting())
  );
});

// Activación: limpiar cachés viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: estrategia inteligente
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar GET
  if (req.method !== 'GET') return;

  // APIs (CoinGecko, alternative.me): network-first con fallback a caché
  // Esto permite usar la app offline con últimos precios conocidos
  if (url.hostname.includes('coingecko.com') || url.hostname.includes('alternative.me')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Cachear respuesta exitosa para uso offline
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(req, clone).catch(() => {});
            });
          }
          return res;
        })
        .catch(() => {
          // Sin conexión: devolver caché si existe
          return caches.match(req);
        })
    );
    return;
  }

  // Imágenes (logos de monedas): cache-first (no cambian)
  if (req.destination === 'image' || url.hostname.includes('coin-images') || url.pathname.includes('/coins/')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(DYNAMIC_CACHE).then(cache => cache.put(req, clone).catch(() => {}));
          }
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Archivos estáticos (HTML, JS, CSS): cache-first con actualización en background
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(req, clone).catch(() => {}));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Mensajes desde la app (para forzar actualización)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
