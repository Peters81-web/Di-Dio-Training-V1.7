/**
 * hr-zones.js — Zone cardio
 *
 * Distribuisce gli allenamenti completati nelle 5 zone di frequenza cardiaca.
 *
 * Nessuna colonna nuova nel database: usa dati che ci sono già.
 *   - profiles.birthdate            -> età -> FC massima stimata
 *   - workout_plans.average_heart_rate -> FC media della sessione (dall'import Garmin)
 *   - workout_plans.total_duration     -> minuti da attribuire alla zona
 *
 * LIMITE DA TENERE PRESENTE (ed è dichiarato anche nell'interfaccia):
 * abbiamo una sola FC media per sessione, non il tracciato secondo per secondo.
 * Quindi l'intera durata viene attribuita alla zona in cui cade quella media.
 * È una stima dell'orientamento dell'allenamento, non una misura reale del
 * tempo trascorso in ciascuna zona: un intervallato che alterna Z2 e Z5 ha
 * una media in Z3 e comparirà tutto in Z3.
 *
 * Si aggancia a stats-fixed.js tramite window.hrZonesRender(workouts), che
 * viene chiamata a ogni render con la lista già filtrata per il periodo attivo.
 */
(function () {
  'use strict';

  // Percentuali di FCmax. Sono i confini classici a 5 zone.
  var ZONES = [
    { n: 1, lo: 0.50, hi: 0.60, name: 'Recupero',  desc: 'Rigenerante, respirazione facile', color: '#94a3b8' },
    { n: 2, lo: 0.60, hi: 0.70, name: 'Fondo',     desc: 'Aerobico, si può conversare',      color: '#3b82f6' },
    { n: 3, lo: 0.70, hi: 0.80, name: 'Medio',     desc: 'Impegnativo ma sostenibile',       color: '#22c55e' },
    { n: 4, lo: 0.80, hi: 0.90, name: 'Soglia',    desc: 'Duro, parlare diventa difficile',  color: '#f59e0b' },
    { n: 5, lo: 0.90, hi: 1.01, name: 'Massimale', desc: 'Massimo sforzo, breve durata',     color: '#ef4444' }
  ];

  var maxHr = null;   // FC massima stimata
  var age   = null;
  var profileLoaded = false;
  var lastWorkouts  = null; // per ri-renderizzare quando arriva il profilo

  // ── Età dalla data di nascita ────────────────────────────────────────────
  function ageFromBirthdate(birthdate) {
    if (!birthdate) return null;
    var bd = new Date(String(birthdate).slice(0, 10));
    if (isNaN(bd.getTime())) return null;
    var today = new Date();
    var a = today.getFullYear() - bd.getFullYear();
    var m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) a--;
    return (a > 0 && a < 120) ? a : null;
  }

  // Formula di Tanaka (2001): più accurata della classica 220-età, che
  // sovrastima nei giovani e sottostima negli over 40.
  function estimateMaxHr(a) {
    return Math.round(208 - 0.7 * a);
  }

  // ── Carica il profilo una volta sola ─────────────────────────────────────
  function loadProfile() {
    var sc = window.supabaseClient;
    if (!sc) return;

    sc.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;

      sc.from('profiles')
        .select('birthdate')
        .eq('id', session.user.id)
        .single()
        .then(function (r) {
          profileLoaded = true;
          if (!r.error && r.data && r.data.birthdate) {
            age = ageFromBirthdate(r.data.birthdate);
            if (age) maxHr = estimateMaxHr(age);
          }
          if (lastWorkouts) render(lastWorkouts); // ridisegna ora che sappiamo la FCmax
        });
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render(workouts) {
    lastWorkouts = workouts || [];
    var box = document.getElementById('hrZonesBody');
    if (!box) return;

    if (!profileLoaded) {
      box.innerHTML = msgBox('fa-spinner fa-spin', 'Carico il profilo...');
      return;
    }

    // Senza data di nascita non possiamo stimare la FC massima.
    if (!maxHr) {
      box.innerHTML = msgBox(
        'fa-user-clock',
        'Per calcolare le zone serve la tua data di nascita.',
        '<a class="hrz-cta" href="/profile">Aggiungila nel profilo</a>'
      );
      return;
    }

    var withHr = (lastWorkouts || []).filter(function (w) {
      return w.completed && w.average_heart_rate > 0;
    });

    if (withHr.length === 0) {
      box.innerHTML = msgBox(
        'fa-heart-broken',
        'Nessun allenamento con frequenza cardiaca nel periodo selezionato.',
        '<span class="hrz-hint">Importa un\'attività da Garmin o inserisci i BPM quando completi un allenamento.</span>'
      );
      return;
    }

    // Accumula minuti e sessioni per zona
    var acc = ZONES.map(function (z) { return { z: z, min: 0, count: 0 }; });
    withHr.forEach(function (w) {
      var pct = w.average_heart_rate / maxHr;
      var idx = 0;
      for (var i = 0; i < ZONES.length; i++) {
        // sotto Z1 viene assorbito in Z1: è comunque lavoro rigenerante
        if (pct < ZONES[i].hi) { idx = i; break; }
        idx = ZONES.length - 1;
      }
      acc[idx].min   += (w.total_duration || 0);
      acc[idx].count += 1;
    });

    var totMin = acc.reduce(function (s, a) { return s + a.min; }, 0);
    var totSes = withHr.length;

    // Zona prevalente (per minuti; a parità, per numero di sessioni)
    var top = acc.slice().sort(function (a, b) {
      return (b.min - a.min) || (b.count - a.count);
    })[0];

    var rows = acc.map(function (a) {
      var loBpm = Math.round(a.z.lo * maxHr);
      var hiBpm = Math.round(a.z.hi * maxHr);
      var share = totMin > 0 ? (a.min / totMin * 100) : 0;
      return '' +
        '<div class="hrz-row">' +
          '<div class="hrz-badge" style="background:' + a.z.color + '">Z' + a.z.n + '</div>' +
          '<div class="hrz-info">' +
            '<div class="hrz-line">' +
              '<span class="hrz-name">' + a.z.name + '</span>' +
              '<span class="hrz-range">' + loBpm + '-' + hiBpm + ' bpm</span>' +
            '</div>' +
            '<div class="hrz-bar"><span style="width:' + share.toFixed(1) + '%;background:' + a.z.color + '"></span></div>' +
            '<div class="hrz-desc">' + a.z.desc + '</div>' +
          '</div>' +
          '<div class="hrz-num">' +
            '<div class="hrz-min">' + (a.min > 0 ? a.min + ' min' : '-') + '</div>' +
            '<div class="hrz-cnt">' + (a.count === 1 ? '1 sessione' : a.count + ' sessioni') + '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    box.innerHTML =
      '<div class="hrz-head">' +
        '<div class="hrz-max">' +
          '<span class="hrz-max-val">' + maxHr + '</span>' +
          '<span class="hrz-max-lbl">bpm max stimati</span>' +
        '</div>' +
        '<div class="hrz-meta">' +
          '<div><strong>' + totSes + '</strong> sessioni con FC · <strong>' + totMin + '</strong> min</div>' +
          '<div class="hrz-top">Prevalenza: <span style="color:' + top.z.color + '">Z' + top.z.n + ' ' + top.z.name + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="hrz-rows">' + rows + '</div>' +
      '<p class="hrz-note">' +
        '<i class="fas fa-circle-info" aria-hidden="true"></i> ' +
        'FC massima stimata con la formula di Tanaka (208 − 0,7 × ' + age + ' anni). ' +
        'Ogni sessione viene attribuita per intero alla zona della sua <em>media</em>: ' +
        'un intervallato che alterna Z2 e Z5 risulterà tutto in Z3. ' +
        'Serve a leggere l\'orientamento degli allenamenti, non il tempo reale in ciascuna zona.' +
      '</p>';
  }

  function msgBox(icon, text, extra) {
    return '<div class="hrz-empty">' +
      '<i class="fas ' + icon + '" aria-hidden="true"></i>' +
      '<p>' + text + '</p>' + (extra || '') +
    '</div>';
  }

  // ── CSS iniettato (modulo autonomo, come tcx-import.js) ──────────────────
  function injectCss() {
    if (document.getElementById('hrZonesCss')) return;
    var s = document.createElement('style');
    s.id = 'hrZonesCss';
    s.textContent = [
      '.hrz-head{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;padding:0 0 1rem;border-bottom:1px solid #eef1f6;margin-bottom:1rem}',
      '.hrz-max{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:92px;padding:.6rem 1rem;background:linear-gradient(135deg,#4e54c8,#7c3aed);border-radius:12px;color:#fff}',
      '.hrz-max-val{font-size:1.6rem;font-weight:800;line-height:1}',
      '.hrz-max-lbl{font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;opacity:.9;margin-top:.2rem;text-align:center}',
      '.hrz-meta{font-size:.86rem;color:#475569;line-height:1.7}',
      '.hrz-top{font-weight:600}',
      '.hrz-rows{display:flex;flex-direction:column;gap:.7rem}',
      '.hrz-row{display:flex;align-items:center;gap:.85rem}',
      '.hrz-badge{width:38px;height:38px;flex-shrink:0;border-radius:10px;color:#fff;font-weight:800;font-size:.85rem;display:flex;align-items:center;justify-content:center}',
      '.hrz-info{flex:1;min-width:0}',
      '.hrz-line{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem}',
      '.hrz-name{font-weight:700;font-size:.9rem;color:#1e293b}',
      '.hrz-range{font-size:.75rem;color:#94a3b8;font-variant-numeric:tabular-nums}',
      '.hrz-bar{height:7px;background:#eef1f6;border-radius:99px;overflow:hidden;margin:.3rem 0 .25rem}',
      '.hrz-bar span{display:block;height:100%;border-radius:99px;transition:width .35s ease}',
      '.hrz-desc{font-size:.72rem;color:#94a3b8}',
      '.hrz-num{text-align:right;flex-shrink:0;min-width:72px}',
      '.hrz-min{font-weight:700;font-size:.9rem;color:#1e293b;font-variant-numeric:tabular-nums}',
      '.hrz-cnt{font-size:.7rem;color:#94a3b8}',
      '.hrz-note{margin-top:1rem;padding-top:.85rem;border-top:1px solid #eef1f6;font-size:.74rem;color:#94a3b8;line-height:1.6}',
      '.hrz-empty{text-align:center;padding:1.75rem 1rem;color:#94a3b8}',
      '.hrz-empty i{font-size:1.7rem;margin-bottom:.6rem;display:block;opacity:.55}',
      '.hrz-empty p{margin:0 0 .5rem;font-size:.87rem}',
      '.hrz-cta{display:inline-block;padding:.45rem .9rem;background:#4e54c8;color:#fff;border-radius:8px;font-size:.8rem;font-weight:600;text-decoration:none}',
      '.hrz-hint{font-size:.75rem}',
      '@media(max-width:520px){.hrz-desc{display:none}.hrz-num{min-width:62px}}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── Avvio ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('hrZonesBody')) return; // non siamo su /stats
    injectCss();
    loadProfile();
  });

  // Chiamata da stats-fixed.js a ogni render, con i workout già filtrati
  // per il periodo selezionato.
  window.hrZonesRender = render;

})();
