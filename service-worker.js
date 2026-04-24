/**
 * service-worker.js — CNR Seguimiento PWA
 * Estrategia: Cache First para assets, Network First para API
 */

'use strict';

const CACHE_NAME    = 'cnr-seguimiento-v1';
const OFFLINE_URLS  = [
  '/cnr-seguimiento',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/camera.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
];

/* ── Instalación: pre-cachear assets ────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cachear archivos locales (ignorar errores en Google Fonts offline)
      const localUrls = OFFLINE_URLS.filter(url => !url.startsWith('http'));
      return cache.addAll(localUrls).catch(err => {
        console.warn('[SW] Algunos recursos no se cachearon:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── Activación: limpiar caches viejos ──────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache First para assets locales ─────────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar peticiones a APIs externas (Google Drive, OAuth)
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('gstatic.com') ||
    event.request.method !== 'GET'
  ) {
    return; // deja que el navegador maneje normalmente
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cachear solo respuestas válidas de assets locales
          if (
            response &&
            response.status === 200 &&
            response.type !== 'opaque' &&
            (url.pathname.includes('/css/') ||
             url.pathname.includes('/js/') ||
             url.pathname === '/' ||
             url.pathname.endsWith('.html') ||
             url.pathname.endsWith('.json') ||
             url.pathname.endsWith('.png') ||
             url.pathname.endsWith('.svg'))
          ) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Sin conexión y sin cache: retornar página offline básica
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

/* ── Background Sync (soporte limitado en Android Chrome) ── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'cnr-sync') {
    // La sincronización real se maneja en app.js via online event
    // Este handler existe para compatibilidad futura
    event.waitUntil(Promise.resolve());
  }
});

/* ── Mensajes desde la app ──────────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
