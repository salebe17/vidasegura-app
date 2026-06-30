// ============================================
// VidaSegura - Service Worker v1
// Cache-first para assets, Network-first para API
// ============================================

const CACHE_NAME = 'vidasegura-v7';

const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/manifest.json',
  '/js/app.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/geofence.js',
  '/js/map.js',
  '/js/sos.js',
  '/js/profile.js',
  '/js/family.js',
  '/js/chat.js',
  '/js/alerts.js',
  '/js/resources.js',
  '/js/qr.js',
  '/js/utils.js',
  '/js/gps.js',
  '/js/stats.js',
  '/js/notifications.js',
  '/data/hospitals-vzla.json',
  '/data/emergency-protocols.json',
  '/assets/icon.svg',
  // CDN - Leaflet
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // CDN - QRCode
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  // CDN - HTML5 QR Scanner
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

// ── Instalación: cachear recursos estáticos ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cache abierto, almacenando recursos...');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[SW] Todos los recursos cacheados exitosamente');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Error al cachear recursos:', error);
      })
  );
});

// ── Activación: limpiar caches antiguos ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Eliminando cache antiguo:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker activado');
        return self.clients.claim();
      })
  );
});

// ── Fetch: estrategias de cache ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solicitudes de navegación → responder con index.html cacheado (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Llamadas a API → Network-first
  if (url.pathname.startsWith('/api/') || url.hostname.includes('api.')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cachear respuesta exitosa de API
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // Assets del mismo origen y CDN → Cache-first
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname.includes('unpkg.com') ||
                url.hostname.includes('cdn.jsdelivr.net') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('fonts.gstatic.com');

  if (isSameOrigin || isCDN) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request).then((response) => {
            // Solo cachear respuestas válidas
            if (!response || response.status !== 200) {
              return response;
            }
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
            return response;
          });
        })
    );
    return;
  }

  // Todo lo demás → Network con fallback a cache
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request))
  );
});
