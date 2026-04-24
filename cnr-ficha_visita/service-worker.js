/**
 * service-worker.js — CNR PWA (Seguimiento + Ficha Visita Terreno)
 * Estrategia: Cache First para assets locales, pass-through para APIs
 * v2 — Agrega rutas cnr-ficha_visita
 */

'use strict';

const CACHE_NAME   = 'cnr-app-v2';
const OFFLINE_URLS = [
  // ── Ficha Seguimiento (ya existente) ──
  '/cnr-seguimiento/',
  '/cnr-seguimiento/index.html',
  '/cnr-seguimiento/css/styles.css',
  '/cnr-seguimiento/js/app.js',
  '/cnr-seguimiento/js/camera.js',
  '/cnr-seguimiento/manifest.json',
  '/cnr-seguimiento/icons/icon-192.png',
  '/cnr-seguimiento/icons/icon-512.png',

  // ── Ficha Visita Terreno (nueva) ──
  '/cnr-ficha_visita/',
  '/cnr-ficha_visita/index.html',
  '/cnr-ficha_visita/styles_demanda.css',
  '/cnr-ficha_visita/app_demanda.js',
  '/cnr-ficha_visita/manifest_demanda.json',
];

/* ── Instalación ─────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS).catch(err => {
        console.warn('[SW] Algunos recursos no cacheados:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── Activación: limpiar caches anteriores ───────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando cache antiguo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache First para assets locales ──────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Pass-through para APIs externas y métodos no-GET
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('gstatic.com') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type !== 'opaque' &&
            (url.pathname.includes('/cnr-seguimiento/') ||
             url.pathname.includes('/cnr-ficha_visita/'))
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            // Intentar la raíz de la app correspondiente
            if (url.pathname.includes('/cnr-ficha_visita/')) {
              return caches.match('/cnr-ficha_visita/index.html');
            }
            return caches.match('/cnr-seguimiento/index.html');
          }
        });
    })
  );
});

/* ── Mensajes desde la app ───────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
