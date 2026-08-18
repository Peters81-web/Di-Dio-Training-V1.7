/**
 * daily-metrics.js — Metriche giornaliere di recupero
 *
 * Variabilità cardiaca, sonno, FC a riposo e VO2max: i dati che il
 * banner del recupero dichiara oggi di non avere, e su cui Garmin fonda
 * il proprio indice.
 *
 * Richiede migrations/007-daily-metrics.sql. Se la migrazione non è
 * stata eseguita il modulo si spegne da solo: niente sezione, niente
 * errori a schermo, un solo avviso in console.
 *
 * DA DOVE ARRIVANO I DATI
 * Per ora si inseriscono a mano, leggendoli dall'orologio. In seguito
 * arriveranno da Health Connect tramite l'app Android, che scriverà
 * sulle stesse righe con source = 'health_connect'. Il formato è già
 * quello, così quando l'app arriverà non ci sarà nulla da migrare.
 *
 * PERCHÉ LA LINEA DI BASE
 * Un valore di RMSSD da solo non dice niente: 45 ms può essere ottimo
 * per una persona e scarso per un'altra. Conta lo scostamento dalla
 * PROPRIA media recente — è così che lavorano tutti gli indici seri,
 * Garmin compresa. Qui la media si calcola sui giorni precedenti,
 * escludendo quello che si sta guardando, altrimenti il valore
 * influenzerebbe il metro con cui viene giudicato.
 *
 * Espone window.DailyMetrics.
 */
(function () {
  'use strict';

  var TABLE = 'daily_metrics';

  // Giorni su cui calcolare la linea di base. 28 è il compromesso
  // abituale: abbastanza da assorbire il rumore quotidiano, abbastanza
  // corto da seguire i cambi di forma.
  var BASELINE_DAYS = 28;
  // Sotto questa soglia la media non è affidabile e non viene mostrata:
  // meglio nessun confronto che un confronto costruito su due giorni.
  var BASELINE_MIN_SAMPLES = 5;

  // ── Riconoscimento "tabella inesistente" ──────────────────────
  // Stessa logica di exercise-log.js: la migrazione si esegue a mano,
  // quindi esiste una finestra in cui il codice gira senza la tabella.
  // SOLO questo errore spegne la sezione: permessi, rete e vincoli
  // devono restare visibili, o un guasto vero sembrerebbe una
  // migrazione mancante.
  function isMissingTableError(err) {
    if (!err) return false;
    if (err.code === 'PGRST205' || err.code === '42P01') return true;
    var m = String(err.message || '').toLowerCase();
    if (m.indexOf('could not find the table') !== -1) return true;
    return m.indexOf('relation') !== -1 && m.indexOf('does not exist') !== -1;
  }

  var tableAvailable = null;

  function markAvailability(err) {
    if (err && isMissingTableError(err)) {
      if (tableAvailable !== false) {
        console.warn('Metriche di recupero: tabella "' + TABLE + '" non presente, ' +
                     'eseguire migrations/007-daily-metrics.sql. Sezione nascosta.');
      }
      tableAvailable = false;
      return false;
    }
    if (!err) tableAvailable = true;
    return true;
  }

  function sc() { return window.supabaseClient; }

  function esc(s) {
    return (typeof window.escapeHtml === 'function')
      ? window.escapeHtml(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
                    '"': '&quot;', "'": '&#39;' })[c];
        });
  }

  function toast(msg, kind, ms) {
    if (window.showToast) window.showToast(msg, kind || 'info', ms);
  }

  // PostgREST restituisce i numeric come stringhe: senza conversione le
  // medie diventano concatenazioni di testo.
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // ── Calcoli puri (verificabili in Node) ───────────────────────

  /**
   * Media dei giorni PRECEDENTI a quello indicato, per ciascuna metrica.
   * Escludere il giorno osservato non è un dettaglio: includerlo
   * significherebbe misurare un valore con un metro che quel valore ha
   * contribuito a costruire, e il confronto tenderebbe sempre a zero.
   *
   * Ritorna null per le metriche con troppi pochi campioni.
   */
  function baseline(rows, excludeDate) {
    var acc = { hrv_rmssd: [], resting_hr: [], sleep_minutes: [] };

    rows.forEach(function (r) {
      if (!r || r.metric_date === excludeDate) return;
      Object.keys(acc).forEach(function (k) {
        var v = num(r[k]);
        if (v !== null) acc[k].push(v);
      });
    });

    var out = {};
    Object.keys(acc).forEach(function (k) {
      var arr = acc[k].slice(0, BASELINE_DAYS);
      if (arr.length < BASELINE_MIN_SAMPLES) { out[k] = null; return; }
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += arr[i];
      out[k] = Math.round((s / arr.length) * 10) / 10;
    });
    out.samples = acc.hrv_rmssd.length;
    return out;
  }

  /** Scostamento percentuale dal riferimento. null se non calcolabile. */
  function deviation(value, base) {
    var v = num(value), b = num(base);
    if (v === null || b === null || b === 0) return null;
    return Math.round(((v - b) / b) * 100);
  }

  /**
   * Lettura dello scostamento della variabilità cardiaca.
   *
   * Le soglie (±10%) sono una convenzione diffusa, non una misura
   * clinica, e l'interfaccia lo dice. Il verso conta: nella variabilità
   * cardiaca PIÙ ALTO è meglio (sistema parasimpatico attivo, corpo
   * riposato), al contrario della FC a riposo dove più basso è meglio.
   * È l'errore più facile da fare leggendo questi numeri.
   */
  function readHrv(value, base) {
    var d = deviation(value, base);
    if (d === null) return null;
    if (d <= -10) return { level: 'low',  delta: d, label: 'sotto la tua media' };
    if (d >=  10) return { level: 'high', delta: d, label: 'sopra la tua media' };
    return { level: 'normal', delta: d, label: 'in linea con la tua media' };
  }

  /** Come readHrv ma con il verso invertito: qui più basso è meglio. */
  function readRestingHr(value, base) {
    var d = deviation(value, base);
    if (d === null) return null;
    if (d >=  5) return { level: 'low',  delta: d, label: 'sopra la tua media' };
    if (d <= -5) return { level: 'high', delta: d, label: 'sotto la tua media' };
    return { level: 'normal', delta: d, label: 'in linea con la tua media' };
  }

  /** 390 -> "6h 30m". null se assente. */
  function fmtSleep(minutes) {
    var m = num(minutes);
    if (m === null || m < 0) return null;
    var h = Math.floor(m / 60);
    var r = Math.round(m % 60);
    if (r === 60) { h++; r = 0; }
    if (h === 0) return r + 'm';
    return h + 'h' + (r ? ' ' + r + 'm' : '');
  }

  /** "6:30" o "6h30" o "390" -> minuti. null se non interpretabile. */
  function parseSleep(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase();
    if (!s) return null;

    var m = s.match(/^(\d{1,2})\s*[:hm]\s*(\d{1,2})?\s*m?$/);
    if (m) {
      var h = parseInt(m[1], 10);
      var mi = m[2] ? parseInt(m[2], 10) : 0;
      if (isNaN(h) || isNaN(mi) || mi > 59) return null;
      return h * 60 + mi;
    }
    // Solo cifre: sono minuti.
    if (/^\d+$/.test(s)) {
      var n = parseInt(s, 10);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  // ── Lettura e scrittura ───────────────────────────────────────

  function loadRecent(userId, days) {
    if (tableAvailable === false) return Promise.resolve([]);

    var since = new Date();
    since.setDate(since.getDate() - (days || BASELINE_DAYS + 2));
    var sinceIso = since.getFullYear() + '-' +
                   String(since.getMonth() + 1).padStart(2, '0') + '-' +
                   String(since.getDate()).padStart(2, '0');

    return sc().from(TABLE)
      .select('metric_date, hrv_rmssd, resting_hr, sleep_minutes, ' +
              'sleep_deep_minutes, sleep_rem_minutes, vo2max, source, notes')
      .eq('user_id', userId)
      .gte('metric_date', sinceIso)
      .order('metric_date', { ascending: false })
      .then(function (r) {
        if (r.error) {
          markAvailability(r.error);
          if (!isMissingTableError(r.error)) {
            console.warn('Metriche di recupero: lettura non riuscita.', r.error);
          }
          return [];
        }
        markAvailability(null);
        return r.data || [];
      })
      .catch(function (e) {
        console.warn('Metriche di recupero: lettura non riuscita.', e);
        return [];
      });
  }

  /**
   * Scrive o aggiorna la riga di un giorno.
   * Il vincolo UNIQUE (user_id, metric_date) di migrations/007 consente
   * un upsert vero: niente cancella-e-reinserisci, quindi nessuna
   * finestra in cui il dato non esiste.
   */
  function saveDay(userId, date, fields) {
    var row = {
      user_id:            userId,
      metric_date:        date,
      hrv_rmssd:          fields.hrv,
      resting_hr:         fields.restingHr,
      sleep_minutes:      fields.sleepMinutes,
      sleep_deep_minutes: fields.sleepDeep,
      sleep_rem_minutes:  fields.sleepRem,
      vo2max:             fields.vo2max,
      source:             'manual',
      updated_at:         new Date().toISOString()
    };

    return sc().from(TABLE)
      .upsert(row, { onConflict: 'user_id,metric_date' })
      .then(function (r) {
        if (r.error) throw r.error;
        return r;
      });
  }

  // ── Stile ─────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('dm-styles')) return;
    var s = document.createElement('style');
    s.id = 'dm-styles';
    s.textContent = [
      '.dm-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}',
      '.dm-chip{display:flex;align-items:baseline;gap:6px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:9px;padding:6px 10px;font-size:.8rem}',
      '.dm-chip-l{color:#9ca3af;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600}',
      '.dm-chip-v{font-weight:700;color:#1a1a2e}',
      '.dm-chip-d{font-size:.72rem;font-weight:600}',
      '.dm-chip-d.up{color:#15803d}',
      '.dm-chip-d.down{color:#b45309}',
      '.dm-chip-d.flat{color:#9ca3af}',
      '.dm-empty{font-size:.82rem;color:#6b7280;margin:0 0 10px}',
      '.dm-btn{padding:6px 12px;border-radius:9px;font-size:.8rem;font-weight:600;cursor:pointer;border:1.5px solid #e5e7eb;background:#fff;color:#4b5563;font-family:inherit}',
      '.dm-btn:hover{background:#f3f4f6}',
      '.dm-btn--pri{background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff;border-color:transparent}',
      '.dm-btn--pri:hover{opacity:.92}',
      '.dm-btn--pri:disabled{opacity:.6;cursor:not-allowed}',
      /* modal */
      '.dm-ov{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .2s}',
      '.dm-ov.is-open{opacity:1}',
      '.dm-dlg{background:#fff;border-radius:18px;max-width:440px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.35);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}',
      '.dm-ov.is-open .dm-dlg{transform:none}',
      '.dm-head{display:flex;align-items:center;gap:12px;padding:18px 22px;background:linear-gradient(135deg,#1e3a5f,#4361ee);color:#fff;flex-shrink:0}',
      '.dm-head i{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.dm-head h3{margin:0;font-size:1.02rem;font-weight:700}',
      '.dm-head small{opacity:.85;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}',
      '.dm-body{padding:20px 22px;overflow-y:auto;flex:1}',
      '.dm-field{margin-bottom:14px}',
      '.dm-label{display:block;font-size:.78rem;font-weight:600;color:#4b5563;margin-bottom:5px}',
      '.dm-input{width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:.92rem;font-family:inherit;color:#1a1a2e;background:#fff}',
      '.dm-input:focus{outline:none;border-color:#4361ee;box-shadow:0 0 0 3px rgba(67,97,238,.12)}',
      '.dm-hint{font-size:.73rem;color:#9ca3af;margin:4px 0 0}',
      '.dm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.dm-note{font-size:.76rem;color:#6b7280;line-height:1.45;background:#f9fafb;border-left:3px solid #4361ee;border-radius:6px;padding:9px 11px;margin:0 0 16px}',
      '.dm-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;flex-shrink:0}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Sezione nella dashboard ───────────────────────────────────

  function chip(label, value, read) {
    var d = '';
    if (read && read.delta !== null && read.delta !== 0) {
      var cls = read.level === 'high' ? 'up' : (read.level === 'low' ? 'down' : 'flat');
      d = '<span class="dm-chip-d ' + cls + '">' +
          (read.delta > 0 ? '+' : '') + read.delta + '%</span>';
    }
    return '<span class="dm-chip">' +
             '<span class="dm-chip-l">' + esc(label) + '</span>' +
             '<span class="dm-chip-v">' + esc(value) + '</span>' + d +
           '</span>';
  }

  /**
   * Disegna la striscia sopra il recupero. Chiamata dopo che la sezione
   * del recupero è nel DOM.
   */
  function render(container, userId, onChanged) {
    if (!container) return;
    ensureStyles();

    var host = document.createElement('div');
    host.id = 'dailyMetricsStrip';
    var existing = document.getElementById('dailyMetricsStrip');
    if (existing) existing.remove();
    container.insertBefore(host, container.firstChild);

    loadRecent(userId).then(function (rows) {
      if (tableAvailable === false) { host.remove(); return; }

      var today = todayIso();
      var latest = rows[0] || null;
      var base   = baseline(rows, latest ? latest.metric_date : today);

      var parts = [];
      if (latest) {
        var hrv = num(latest.hrv_rmssd);
        if (hrv !== null) parts.push(chip('Variabilità', hrv + ' ms', readHrv(hrv, base.hrv_rmssd)));

        var rhr = num(latest.resting_hr);
        if (rhr !== null) parts.push(chip('FC riposo', rhr + ' bpm', readRestingHr(rhr, base.resting_hr)));

        var sl = fmtSleep(latest.sleep_minutes);
        if (sl) parts.push(chip('Sonno', sl, null));

        var vo = num(latest.vo2max);
        if (vo !== null) parts.push(chip('VO2max', String(vo), null));
      }

      var head;
      if (!parts.length) {
        head = '<p class="dm-empty">Nessun dato di recupero registrato. ' +
               'Aggiungi variabilità cardiaca, sonno e FC a riposo dal tuo orologio ' +
               'per una stima meno cieca.</p>';
      } else {
        var when = (latest.metric_date === today)
          ? 'oggi'
          : 'del ' + esc(latest.metric_date.split('-').reverse().join('/'));
        head = '<div class="dm-strip">' + parts.join('') +
               '<span class="dm-chip-l" style="margin-left:2px">' + when + '</span>' +
               '</div>';
      }

      host.innerHTML = head +
        '<button type="button" class="dm-btn' + (parts.length ? '' : ' dm-btn--pri') + '" ' +
        'data-dm-edit>' +
          '<i class="fas fa-heart-pulse" aria-hidden="true"></i> ' +
          (parts.length ? 'Aggiorna dati di recupero' : 'Aggiungi dati di recupero') +
        '</button>';

      host.querySelector('[data-dm-edit]').addEventListener('click', function () {
        openEditor(userId, latest, function () {
          render(container, userId, onChanged);
          if (typeof onChanged === 'function') onChanged();
        });
      });
    }).catch(function (e) {
      console.warn('Metriche di recupero: rendering non riuscito.', e);
      if (host) host.remove();
    });
  }

  // ── Editor ────────────────────────────────────────────────────

  function openEditor(userId, existing, onDone) {
    ensureStyles();

    var date = (existing && existing.metric_date === todayIso())
      ? existing.metric_date : todayIso();
    var pre = (existing && existing.metric_date === date) ? existing : {};

    var ov = document.createElement('div');
    ov.className = 'dm-ov';
    ov.innerHTML =
      '<div class="dm-dlg" role="dialog" aria-modal="true" aria-label="Dati di recupero">' +
        '<div class="dm-head">' +
          '<i class="fas fa-heart-pulse" aria-hidden="true"></i>' +
          '<div><small>Recupero</small><h3>Dati dall\'orologio</h3></div>' +
        '</div>' +
        '<div class="dm-body">' +
          '<p class="dm-note">Sono i valori del <strong>risveglio</strong>, quelli che ' +
            'l\'app non riesce a leggere da sola. Li trovi in Garmin Connect. ' +
            'Lascia vuoto ciò che non hai: un campo vuoto resta vuoto, non diventa zero.</p>' +

          '<div class="dm-field">' +
            '<label class="dm-label" for="dmDate">Giorno</label>' +
            '<input class="dm-input" type="date" id="dmDate" value="' + esc(date) + '">' +
          '</div>' +

          '<div class="dm-grid">' +
            '<div class="dm-field">' +
              '<label class="dm-label" for="dmHrv">Variabilità (RMSSD)</label>' +
              '<input class="dm-input" type="number" id="dmHrv" min="1" max="300" step="0.1" ' +
                'inputmode="decimal" placeholder="ms" value="' +
                (pre.hrv_rmssd == null ? '' : esc(pre.hrv_rmssd)) + '">' +
            '</div>' +
            '<div class="dm-field">' +
              '<label class="dm-label" for="dmRhr">FC a riposo</label>' +
              '<input class="dm-input" type="number" id="dmRhr" min="30" max="120" ' +
                'inputmode="numeric" placeholder="bpm" value="' +
                (pre.resting_hr == null ? '' : esc(pre.resting_hr)) + '">' +
            '</div>' +
          '</div>' +

          '<div class="dm-field">' +
            '<label class="dm-label" for="dmSleep">Sonno totale</label>' +
            '<input class="dm-input" type="text" id="dmSleep" inputmode="numeric" ' +
              'placeholder="6:30 oppure 390" value="' +
              (pre.sleep_minutes == null ? '' : esc(fmtSleepInput(pre.sleep_minutes))) + '">' +
            '<p class="dm-hint">Ore:minuti, oppure minuti totali.</p>' +
          '</div>' +

          '<div class="dm-grid">' +
            '<div class="dm-field">' +
              '<label class="dm-label" for="dmDeep">Sonno profondo</label>' +
              '<input class="dm-input" type="text" id="dmDeep" inputmode="numeric" ' +
                'placeholder="1:10" value="' +
                (pre.sleep_deep_minutes == null ? '' : esc(fmtSleepInput(pre.sleep_deep_minutes))) + '">' +
            '</div>' +
            '<div class="dm-field">' +
              '<label class="dm-label" for="dmRem">Sonno REM</label>' +
              '<input class="dm-input" type="text" id="dmRem" inputmode="numeric" ' +
                'placeholder="1:25" value="' +
                (pre.sleep_rem_minutes == null ? '' : esc(fmtSleepInput(pre.sleep_rem_minutes))) + '">' +
            '</div>' +
          '</div>' +

          '<div class="dm-field">' +
            '<label class="dm-label" for="dmVo2">VO2max</label>' +
            '<input class="dm-input" type="number" id="dmVo2" min="10" max="100" step="0.1" ' +
              'inputmode="decimal" placeholder="ml/kg/min" value="' +
              (pre.vo2max == null ? '' : esc(pre.vo2max)) + '">' +
          '</div>' +
        '</div>' +
        '<div class="dm-foot">' +
          '<button type="button" class="dm-btn" id="dmCancel">Annulla</button>' +
          '<button type="button" class="dm-btn dm-btn--pri" id="dmSave">Salva</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('is-open'); });

    function close() {
      ov.classList.remove('is-open');
      setTimeout(function () { ov.remove(); }, 200);
    }
    ov.querySelector('#dmCancel').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape' && document.body.contains(ov)) close();
      if (!document.body.contains(ov)) document.removeEventListener('keydown', onKey);
    });

    // Cambiando giorno si ricarica ciò che c'è già per quella data, così
    // non si sovrascrive per sbaglio una riga esistente con campi vuoti.
    ov.querySelector('#dmDate').addEventListener('change', function () {
      var d = this.value;
      if (!d) return;
      loadRecent(userId, 400).then(function (rows) {
        var row = rows.filter(function (r) { return r.metric_date === d; })[0] || {};
        ov.querySelector('#dmHrv').value   = row.hrv_rmssd == null ? '' : row.hrv_rmssd;
        ov.querySelector('#dmRhr').value   = row.resting_hr == null ? '' : row.resting_hr;
        ov.querySelector('#dmSleep').value = row.sleep_minutes == null ? '' : fmtSleepInput(row.sleep_minutes);
        ov.querySelector('#dmDeep').value  = row.sleep_deep_minutes == null ? '' : fmtSleepInput(row.sleep_deep_minutes);
        ov.querySelector('#dmRem').value   = row.sleep_rem_minutes == null ? '' : fmtSleepInput(row.sleep_rem_minutes);
        ov.querySelector('#dmVo2').value   = row.vo2max == null ? '' : row.vo2max;
      });
    });

    ov.querySelector('#dmSave').addEventListener('click', function () {
      var btn = this;
      var v = function (id) { return ov.querySelector(id).value.trim(); };

      var day = v('#dmDate');
      if (!day) { toast('Indica il giorno.', 'warning'); return; }

      var fields = {
        hrv:          v('#dmHrv')  === '' ? null : parseFloat(v('#dmHrv').replace(',', '.')),
        restingHr:    v('#dmRhr')  === '' ? null : parseInt(v('#dmRhr'), 10),
        sleepMinutes: parseSleep(v('#dmSleep')),
        sleepDeep:    parseSleep(v('#dmDeep')),
        sleepRem:     parseSleep(v('#dmRem')),
        vo2max:       v('#dmVo2')  === '' ? null : parseFloat(v('#dmVo2').replace(',', '.'))
      };

      // Stessi limiti dei vincoli in migrations/007: intercettarli qui
      // evita un errore grezzo del database, ma il database resta
      // l'ultima parola.
      var bad = validate(fields, v('#dmSleep'), v('#dmDeep'), v('#dmRem'));
      if (bad) { toast(bad, 'warning', 5000); return; }

      var anything = Object.keys(fields).some(function (k) { return fields[k] !== null; });
      if (!anything) { toast('Inserisci almeno un valore.', 'warning'); return; }

      btn.disabled = true;
      btn.textContent = 'Salvataggio…';

      saveDay(userId, day, fields)
        .then(function () {
          toast('Dati di recupero salvati', 'success');
          close();
          if (typeof onDone === 'function') onDone();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Salva';
          if (isMissingTableError(err)) {
            markAvailability(err);
            toast('Questa funzione richiede una migrazione del database non ancora ' +
                  'eseguita (migrations/007).', 'warning', 7000);
            close();
            return;
          }
          console.error('Metriche di recupero: salvataggio non riuscito.', err);
          toast('Salvataggio non riuscito: ' +
                (err && err.message ? err.message : 'errore sconosciuto'), 'error', 7000);
        });
    });
  }

  function fmtSleepInput(minutes) {
    var m = num(minutes);
    if (m === null) return '';
    return Math.floor(m / 60) + ':' + String(Math.round(m % 60)).padStart(2, '0');
  }

  /**
   * Validazione lato client. Ritorna il messaggio del primo problema, o
   * null se va tutto bene.
   */
  function validate(f, sleepRaw, deepRaw, remRaw) {
    if (f.hrv !== null && (isNaN(f.hrv) || f.hrv < 1 || f.hrv > 300)) {
      return 'La variabilità cardiaca deve stare fra 1 e 300 ms.';
    }
    if (f.restingHr !== null && (isNaN(f.restingHr) || f.restingHr < 30 || f.restingHr > 120)) {
      return 'La FC a riposo deve stare fra 30 e 120 bpm.';
    }
    if (f.vo2max !== null && (isNaN(f.vo2max) || f.vo2max < 10 || f.vo2max > 100)) {
      return 'Il VO2max deve stare fra 10 e 100.';
    }
    // Testo scritto ma non interpretabile: va segnalato, altrimenti il
    // campo verrebbe salvato come vuoto senza che nessuno lo dica.
    if (sleepRaw && f.sleepMinutes === null) return 'Sonno non riconosciuto: usa "6:30" o i minuti totali.';
    if (deepRaw  && f.sleepDeep    === null) return 'Sonno profondo non riconosciuto: usa "1:10" o i minuti.';
    if (remRaw   && f.sleepRem     === null) return 'Sonno REM non riconosciuto: usa "1:25" o i minuti.';

    var vals = [f.sleepMinutes, f.sleepDeep, f.sleepRem];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] !== null && (vals[i] < 0 || vals[i] > 1440)) {
        return 'Le durate del sonno devono stare fra 0 e 24 ore.';
      }
    }
    if (f.sleepMinutes !== null) {
      var phases = (f.sleepDeep || 0) + (f.sleepRem || 0);
      if (phases > f.sleepMinutes) {
        return 'Profondo e REM insieme superano il sonno totale.';
      }
    }
    return null;
  }

  // ── API pubblica ──────────────────────────────────────────────
  window.DailyMetrics = {
    render: render,
    openEditor: openEditor,
    loadRecent: loadRecent,
    // esportate per i test in Node
    _internals: {
      isMissingTableError: isMissingTableError,
      baseline: baseline,
      deviation: deviation,
      readHrv: readHrv,
      readRestingHr: readRestingHr,
      fmtSleep: fmtSleep,
      parseSleep: parseSleep,
      validate: validate,
      BASELINE_MIN_SAMPLES: BASELINE_MIN_SAMPLES
    }
  };

})();
