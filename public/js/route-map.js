/**
 * route-map.js — Mappa dei percorsi
 *
 * Disegna la traccia GPS di un'attività importata da Garmin.
 *
 * I dati arrivano da workout_plans.gps_track (vedi
 * migrations/001-gps-track.sql): un array JSON di coppie [lat, lon]
 * sottocampionato a 500 punti da tcx-import.js.
 *
 * Uso: mettere nel DOM un contenitore
 *     <div class="arc-map" data-track="[[45.46,9.18],...]"></div>
 * e poi chiamare window.routeMapRenderAll(radice). La chiamata va fatta
 * DOPO l'inserimento nel DOM: Leaflet calcola lo zoom dalle dimensioni
 * reali dell'elemento e su un div di altezza zero fallisce.
 *
 * Leaflet viene caricato da cdnjs, già consentito dalla CSP; i tile di
 * OpenStreetMap passano da img-src https:. Nessuna modifica ai security
 * header è necessaria.
 */
(function () {
  'use strict';

  var rendered = new WeakSet(); // evita di reinizializzare la stessa mappa

  function hasLeaflet() {
    return typeof window.L !== 'undefined' && typeof window.L.map === 'function';
  }

  // ── Disegna una singola mappa ────────────────────────────────────────
  function renderOne(el) {
    if (!el || rendered.has(el)) return;

    var raw = el.getAttribute('data-track');
    if (!raw) return;

    var track;
    try {
      track = JSON.parse(raw);
    } catch (e) {
      fallback(el, 'Traccia non leggibile.');
      return;
    }
    if (!Array.isArray(track) || track.length < 2) {
      fallback(el, 'Traccia troppo corta per essere disegnata.');
      return;
    }

    if (!hasLeaflet()) {
      // Leaflet non è arrivato (offline, CDN bloccato): meglio un
      // messaggio chiaro che un rettangolo grigio muto.
      fallback(el, 'Mappa non disponibile: libreria non caricata.');
      return;
    }

    rendered.add(el);

    try {
      var map = L.map(el, {
        scrollWheelZoom: false,   // non rubare lo scroll della pagina
        attributionControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      var line = L.polyline(track, {
        color: '#4e54c8',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(map);

      // Partenza e arrivo, così si legge il verso del percorso
      var start = track[0];
      var end   = track[track.length - 1];
      L.circleMarker(start, {
        radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1
      }).addTo(map).bindPopup('Partenza');
      L.circleMarker(end, {
        radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1
      }).addTo(map).bindPopup('Arrivo');

      map.fitBounds(line.getBounds(), { padding: [18, 18] });

      // Il contenitore può essere stato creato mentre era ancora nascosto
      // (il dettaglio giorno parte con display:none): a quel punto Leaflet
      // ha misurato zero. invalidateSize lo forza a rimisurare.
      setTimeout(function () {
        map.invalidateSize();
        map.fitBounds(line.getBounds(), { padding: [18, 18] });
      }, 120);

    } catch (err) {
      rendered.delete(el);
      fallback(el, 'Impossibile disegnare la mappa.');
      if (window.console) console.error('route-map:', err);
    }
  }

  function fallback(el, msg) {
    el.classList.add('arc-map--fallback');
    el.textContent = msg;
  }

  // ── Disegna tutte le mappe dentro una radice ─────────────────────────
  function renderAll(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('.arc-map[data-track]');
    for (var i = 0; i < els.length; i++) renderOne(els[i]);
  }

  // ── CSS iniettato (modulo autonomo) ──────────────────────────────────
  function injectCss() {
    if (document.getElementById('routeMapCss')) return;
    var s = document.createElement('style');
    s.id = 'routeMapCss';
    s.textContent = [
      '.arc-map{height:220px;width:100%;border-radius:10px;margin-top:.75rem;overflow:hidden;background:#eef1f6;z-index:0}',
      '.arc-map--fallback{display:flex;align-items:center;justify-content:center;height:70px;color:#94a3b8;font-size:.8rem;text-align:center;padding:0 1rem}',
      '.arc-map .leaflet-control-attribution{font-size:.62rem}',
      '@media(max-width:520px){.arc-map{height:180px}}'
    ].join('');
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectCss();
    renderAll(document); // eventuali mappe già presenti a fine caricamento
  });

  window.routeMapRenderAll = renderAll;

})();
