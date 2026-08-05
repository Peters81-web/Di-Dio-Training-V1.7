/* ================================================
   Di Dio Training — Service Worker
   Strategie:
   - Font e immagini  → Cache-First   (non cambiano a parità di nome)
   - CSS e JS         → Network-First (devono restare allineati all'HTML)
   - Pagine HTML      → Network-First con fallback offline
   - Chiamate /api/   → Network-Only  (mai in cache)
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
//   v7 → Rebrand: icona runner + nome app "Vortex Stride" + credito
//        "Di Dio Pietro" su ogni pagina (bump per rinfrescare icone+JS)
//   v8 → Pagina Archivio (calendario mensile + dettaglio giorno)
//   v9 → Icone maskable separate (runner 60% safe-zone, niente tagli)
//   v10 → Icona "any" finale: runner + scritta VORTEX STRIDE (Opzione B)
//   v11 → Icona: runner avvicinato alla scritta (meno spazio bianco)
//   v12 → Icona: gruppo runner+scritta ingrandito per riempire il canvas
//   v13 → Fix mobile: bottone empty-state "Crea primo allenamento" centrato
//   v14 → Dashboard: allenamenti raggruppati per mese (cartelle collassabili)
//   v15 → Sfondo: rimosso pattern "+", gradiente tenue grigio-azzurro
//   v16 → Sostituiti alert() nativi con toast eleganti (no dominio in popup)
//   v17 → Fix: rimossa barra bianca card "Calorie oggi" + cartelle mese
//         che ora si chiudono del tutto (max-height invece di grid 0fr)
//   v18 → confirm() nativi sostituiti con popup elegante window.showConfirm
//   v19 → Import attività da file TCX (Garmin) su pagina Statistiche
//   v20 → Import GPX + Share Target Android (condividi attività → app)
//   v21 → Grafici barre /stats più leggibili (larghezza max, etichette,
//         tooltip) — una sola settimana non sembra più un blocco
//   v22 → Trend durata: barra con 1 sola settimana + asse da 0 (no zoom)
//   v23 → Grafici settimanali: etichette con intervallo "8 giu – 14 giu"
//   v24 → Import: nome con orario + momento giornata (mattina/sera)
//   v25 → Sicurezza: auth sull'endpoint AI, sanitizzazione XSS AI Trainer,
//         CDN pinnati, rimossa pagina di test
//   v26 → Accessibilità (skip link, focus visibile, aria-live sui toast,
//         etichette sui bottoni icona) + dark mode rotta rimossa +
//         2653 righe di codice morto eliminate + shortcuts nel manifest
//   v27 → Zone cardio su /stats (FCmax da birthdate, nessuna colonna nuova)
//   v28 → Mappa dei percorsi nell'Archivio (traccia GPS salvata
//         dall'import Garmin) + FC massima. Richiede migrations/001.
//   v29 → Zone cardio con Karvonen (come Garmin) + FC max/riposo nel
//         profilo + calorie stimate per i GPX. Richiede migrations/002.
//   v30 → Fix mappa: veniva disegnata su un contenitore ancora nascosto
//   v31 → Fix profilo: il salvataggio falliva senza migrations/002
//   v32 → Mappa anche nel dettaglio allenamento della dashboard
//   v33 → Dashboard riordinata (sezione Oggi) + Cancella Dati nel Profilo
//   v34 → Temperatura dagli import + meteo manuale. Richiede migrations/003.
//   v35 → CSS/JS passano a network-first: cache-first serviva codice
//         vecchio con HTML nuovo dopo ogni deploy, e il riquadro "Oggi"
//         restava in caricamento finché non si ricaricava la pagina.
const CACHE_NAME  = 'didio-v47';
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
  '/css/archivio.css',
  '/js/utils.js',
  '/js/app-core.js',
  '/js/app-nav.js',
  '/js/archivio.js',
  '/js/tcx-import.js',
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

  // ── Share Target (Android): ricezione file condiviso da Garmin ──
  // Android invia un POST multipart a /share-target. Salviamo il file
  // in cache 'shared-file' e reindirizziamo a /stats?shared=1, dove la
  // pagina lo legge e apre l'anteprima di import (tcx-import.js).
  if (request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (file) {
          const cache = await caches.open('shared-file');
          await cache.put('/__shared_activity', new Response(file));
        }
      } catch (e) { /* ignora: reindirizza comunque */ }
      return Response.redirect('/stats?shared=1', 303);
    })());
    return;
  }

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // API calls → Network-Only
  if (url.pathname.startsWith('/api/')) return;

  // Font e immagini → Cache-First (non cambiano mai a parità di nome)
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // CSS e JS → Network-First: devono restare allineati all'HTML,
  // che è già servito network-first. Cache solo come fallback offline.
  if (isCodeAsset(url.pathname)) {
    event.respondWith(networkFirst(request));
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

// Font e immagini: il contenuto non cambia mai a parità di nome, quindi
// cache-first è sicuro e velocissimo.
function isImmutableAsset(pathname) {
  return /\.(woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(pathname);
}

// CSS e JS: cache-first era la causa di un intero filone di bug. Il codice
// cambia a ogni deploy MANTENENDO lo stesso nome, e cache-first non
// rivalida mai: al primo caricamento dopo un aggiornamento la pagina
// riceveva HTML nuovo (servito network-first) e JavaScript vecchio, con
// risultati incoerenti — riquadri che restavano in caricamento, funzioni
// assenti — che sparivano "magicamente" ricaricando.
//
// Ora vanno in network-first: si paga qualche centinaio di millisecondi
// sulla prima richiesta, ma il codice è sempre allineato all'HTML. La
// cache resta come fallback offline.
function isCodeAsset(pathname) {
  return /\.(css|js)$/i.test(pathname);
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
