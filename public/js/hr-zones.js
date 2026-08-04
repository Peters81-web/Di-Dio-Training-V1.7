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

  // Definizione delle zone: anch'essa dal modello condiviso, così nome,
  // colore e percentuali non possono divergere fra questa pagina e la
  // stima di recupero sulla dashboard.
  var ZONES = window.HrModel.ZONES;

  var maxHr  = null;   // FC massima: misurata se disponibile, altrimenti stimata
  var restHr = null;   // FC a riposo: abilita il metodo Karvonen
  var age    = null;
  var maxIsMeasured = false;
  var profileLoaded = false;
  var lastWorkouts  = null; // per ri-renderizzare quando arriva il profilo

  // Confini e formula vivono in hr-model.js, condiviso con la stima di
  // recupero sulla dashboard: due copie della stessa formula potrebbero
  // divergere, e la stessa sessione finirebbe in zone diverse fra una
  // pagina e l'altra senza che nulla lo segnali.
  function hrAt(pct) {
    return window.HrModel.hrAt(pct, maxHr, restHr);
  }

  function usingKarvonen() {
    return window.HrModel.usingKarvonen(maxHr, restHr);
  }

  // Anche queste vengono dal modello condiviso.
  function ageFromBirthdate(b) { return window.HrModel.ageFromBirthdate(b); }
  function estimateMaxHr(a)    { return window.HrModel.estimateMaxHr(a); }

  // ── Carica il profilo una volta sola ─────────────────────────────────────
  function loadProfile() {
    var sc = window.supabaseClient;
    if (!sc) return;

    sc.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;

      // max_heart_rate e resting_heart_rate esistono solo dopo
      // migrations/002-hr-settings.sql: se manca, la query fallirebbe in
      // blocco e le zone sparirebbero. Al primo errore ripieghiamo sulla
      // sola data di nascita.
      var uid = session.user.id;

      function apply(row) {
        profileLoaded = true;
        row = row || {};
        if (row.birthdate) age = ageFromBirthdate(row.birthdate);

        if (row.max_heart_rate > 0) {
          maxHr = row.max_heart_rate;
          maxIsMeasured = true;
        } else if (age) {
          maxHr = estimateMaxHr(age);
          maxIsMeasured = false;
        }

        if (row.resting_heart_rate > 0) restHr = row.resting_heart_rate;

        if (lastWorkouts) render(lastWorkouts); // ridisegna ora che sappiamo i parametri
      }

      sc.from('profiles')
        .select('birthdate, max_heart_rate, resting_heart_rate')
        .eq('id', uid).single()
        .then(function (r) {
          if (!r.error) return apply(r.data);
          console.warn('Zone cardio: colonne FC non disponibili, eseguire ' +
                       'migrations/002-hr-settings.sql. Ripiego sulla stima dall\'età.', r.error);
          sc.from('profiles').select('birthdate').eq('id', uid).single()
            .then(function (r2) { apply(r2.error ? null : r2.data); });
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
    // Confini in bpm, calcolati una volta sola con il metodo attivo
    // (Karvonen se abbiamo la FC a riposo, altrimenti % della massima).
    var bounds = ZONES.map(function (z) {
      return { lo: hrAt(z.lo), hi: hrAt(z.hi) };
    });

    var acc = ZONES.map(function (z) { return { z: z, min: 0, count: 0 }; });
    withHr.forEach(function (w) {
      var bpm = w.average_heart_rate;
      var idx = 0;
      for (var i = 0; i < ZONES.length; i++) {
        // sotto Z1 viene assorbito in Z1: è comunque lavoro rigenerante
        if (bpm < bounds[i].hi) { idx = i; break; }
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

    var rows = acc.map(function (a, i) {
      var loBpm = bounds[i].lo;
      var hiBpm = bounds[i].hi;
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
        methodNote() + ' ' +
        'Ogni sessione viene attribuita per intero alla zona della sua <em>media</em>: ' +
        'un intervallato che alterna Z2 e Z5 risulterà tutto in Z3. ' +
        'Serve a leggere l\'orientamento degli allenamenti, non il tempo reale in ciascuna zona.' +
      '</p>';
  }

  // Spiega da dove escono i confini, e se manca qualcosa dice come
  // ottenere le stesse zone di Garmin.
  function methodNote() {
    var src = maxIsMeasured
      ? 'FC massima ' + maxHr + ' bpm (inserita da te).'
      : 'FC massima ' + maxHr + ' bpm, stimata dall\'età con la formula di Tanaka (208 − 0,7 × ' + age + ').';

    if (usingKarvonen()) {
      return src + ' Zone calcolate sulla riserva cardiaca (Karvonen, riposo ' +
             restHr + ' bpm): lo stesso metodo di Garmin.';
    }
    return src + ' Zone calcolate come percentuale della massima. ' +
           '<strong>Garmin usa invece la riserva cardiaca</strong>, quindi lì i valori risultano più alti: ' +
           'aggiungi la tua FC a riposo nel <a href="/profile">profilo</a> per far coincidere le zone.';
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
