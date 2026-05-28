/* ================================================
   Di Dio Training — Service Worker  v1.0
   Strategy:
   - Static assets (CSS, JS, fonts, images) → Cache-First
   - HTML pages → Network-First with cache fallback
   - API calls → Network-Only (never cache)
   ================================================ */

// IMPORTANTE: bumpare questa versione ad ogni deploy che modifica CSS/JS,
// altrimenti il Service Worker servirà le versioni cached vecchie causando
// disallineamento (HTML nuovo + asset vecchi → bug visivi imprevedibili).
// Sequenza storica:
//   v1 → setup iniziale PWA
//   v2 → Phase A navbar unificata (.app-nav) + DOMPurify restore + bug fix UX
//   v3 → Step 1 Bilancio Calorico: espansione form misurazioni
//        (height/body_fat/muscle_mass) + merge-per-data
//   v4 → Step 2 Calorie chiare: label espliciti su dashboard + kcal per
//        giorno nel calendario settimanale + nuova KPI calorie su /stats
//   v5 → Step 3a Bilancio Calorico: caloric-math.js + card BMR/TDEE/
//        deficit sulla dashboard
//   v6 → Opzione B: Annulla + Modifica completamento workout su /stats
//        (modal pre-compilato + sync workout_plans/completed_workouts)
const CACHE_NAME  = 'didio-v6';
const OFFLINE_URL = '/offline.html';

const PRECACHE = [
  '/',
  '/offline.html',
  '/css/styles.css',
  '/css/enhanced-design.css',
  '/css/dashboard-enhanced.css',
  '/css/fase1-features.css',
  '/css/fase3-features.css',
  '/css/notifications.css',
  '/css/app-nav.css',
  '/js/utils.js',
  '/js/app-core.js',
  '/js/app-nav.js',
  '/js/caloric-math.js',
  '/js/supabase-config.js',
  '/js/fase1-features.js',
  '/js/fase3-features.js',
];

// ── Install: pre-cache critical assets ───────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ──────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // API calls → Network-Only
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (CSS, JS, fonts, images) → Cache-First
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages → Network-First with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // Everything else → Network-First
  event.respondWith(networkFirst(request));
});

function isStaticAsset(pathname) {
  return /\.(css|js|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset non disponibile offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Non disponibile offline', { status: 503 });
  }
}

async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('<h1>Offline</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
