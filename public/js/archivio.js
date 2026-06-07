/**
 * archivio.js
 * Pagina Archivio: calendario mensile navigabile + dettaglio per giorno
 * degli allenamenti completati. Riusa il pattern modifica/annulla di /stats.
 *
 * Dati: completed_workouts (join workout_plans per nome + activity_type).
 */
'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var sc = window.supabaseClient;
  var currentUser = null;

  // Stato vista
  var viewYear, viewMonth;            // mese mostrato (0-11)
  var allCompleted = [];              // tutti i completamenti dell'utente
  var byDay = {};                     // 'YYYY-MM-DD' → [completion, ...]
  var selectedDay = null;             // giorno aperto nel dettaglio

  var MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  var ACT = {
    running:  { label: 'Corsa',     icon: 'fa-person-running' },
    gym:      { label: 'Palestra',  icon: 'fa-dumbbell' },
    yoga:     { label: 'Yoga',      icon: 'fa-spa' },
    cycling:  { label: 'Ciclismo',  icon: 'fa-person-biking' },
    mobility: { label: 'Mobilità',  icon: 'fa-child-reaching' },
    walking:  { label: 'Camminata', icon: 'fa-person-walking' }
  };

  // ── Init ──────────────────────────────────────────────────────
  sc.auth.getSession().then(function (res) {
    if (res.error || !res.data.session) { window.location.href = '/'; return; }
    currentUser = res.data.session.user;

    var now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();

    bindUI();
    fetchData();
  });

  function bindUI() {
    document.getElementById('arcPrev').addEventListener('click', function () { changeMonth(-1); });
    document.getElementById('arcNext').addEventListener('click', function () { changeMonth(1); });
    document.getElementById('arcToday').addEventListener('click', function () {
      var now = new Date();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      render();
    });
    document.getElementById('arcDetailClose').addEventListener('click', closeDetail);
    var logout = document.getElementById('logoutBtn');
    if (logout) logout.addEventListener('click', function () {
      sc.auth.signOut().then(function () { window.location.href = '/'; });
    });
  }

  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
    closeDetail();
    render();
  }

  // ── Fetch completamenti ───────────────────────────────────────
  function fetchData() {
    sc.from('completed_workouts')
      .select('id,workout_id,completed_at,actual_duration,calories_burned,distance,heart_rate_avg,perceived_difficulty,rating,notes,workout_plans(name,activity_type)')
      .eq('user_id', currentUser.id)
      .order('completed_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          console.error('Archivio: errore caricamento', res.error);
          document.getElementById('arcGrid').innerHTML =
            '<div class="arc-loading" style="color:#dc2626;">Errore nel caricamento. Riprova.</div>';
          return;
        }
        allCompleted = res.data || [];
        indexByDay();
        render();
      });
  }

  function indexByDay() {
    byDay = {};
    allCompleted.forEach(function (c) {
      if (!c.completed_at) return;
      var key = toLocalDayKey(c.completed_at);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(c);
    });
  }

  // ── Render completo ───────────────────────────────────────────
  function render() {
    renderMonthLabel();
    renderMonthSummary();
    renderGrid();
    // se un giorno selezionato è in questo mese, riaprilo aggiornato
    if (selectedDay && selectedDay.indexOf(monthPrefix()) === 0) {
      openDetail(selectedDay);
    }
  }

  function renderMonthLabel() {
    document.getElementById('arcMonthLabel').textContent = MONTHS[viewMonth] + ' ' + viewYear;
  }

  function monthPrefix() {
    return viewYear + '-' + pad(viewMonth + 1);
  }

  function renderMonthSummary() {
    var prefix = monthPrefix();
    var monthEntries = allCompleted.filter(function (c) {
      return c.completed_at && toLocalDayKey(c.completed_at).indexOf(prefix) === 0;
    });
    var days = {};
    var kcal = 0, mins = 0;
    monthEntries.forEach(function (c) {
      days[toLocalDayKey(c.completed_at)] = true;
      kcal += (c.calories_burned || 0);
      mins += (c.actual_duration || 0);
    });
    var el = document.getElementById('arcMonthSummary');
    el.innerHTML =
      kpi('blue',   'fa-calendar-check', Object.keys(days).length, 'Giorni attivi') +
      kpi('green',  'fa-dumbbell',       monthEntries.length,      'Allenamenti') +
      kpi('orange', 'fa-fire',           kcal,                     'Calorie') +
      kpi('blue',   'fa-clock',          mins + ' min',            'Tempo totale');
  }

  function kpi(color, icon, val, lbl) {
    return '<div class="arc-kpi">' +
      '<div class="arc-kpi-icon ' + color + '"><i class="fas ' + icon + '"></i></div>' +
      '<div><div class="arc-kpi-val">' + val + '</div><div class="arc-kpi-lbl">' + lbl + '</div></div>' +
      '</div>';
  }

  function renderGrid() {
    var grid = document.getElementById('arcGrid');
    var todayKey = toLocalDayKey(new Date().toISOString());

    // primo giorno del mese e offset (lun=0)
    var first = new Date(viewYear, viewMonth, 1);
    var startOffset = (first.getDay() + 6) % 7; // lun=0 ... dom=6
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    var html = '';
    // celle vuote iniziali
    for (var i = 0; i < startOffset; i++) {
      html += '<div class="arc-day arc-day--empty"></div>';
    }
    // giorni del mese
    for (var d = 1; d <= daysInMonth; d++) {
      var key = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(d);
      var entries = byDay[key] || [];
      var hasWork = entries.length > 0;
      var kcal = entries.reduce(function (s, c) { return s + (c.calories_burned || 0); }, 0);

      var cls = 'arc-day';
      if (hasWork) cls += ' arc-day--done';
      if (key === todayKey) cls += ' arc-day--today';
      if (key === selectedDay) cls += ' arc-day--selected';

      var attr = hasWork ? ' onclick="arcOpenDay(\'' + key + '\')" role="button" tabindex="0"' : '';
      html += '<div class="' + cls + '"' + attr + '>' +
        (hasWork ? '<span class="arc-day-count">' + entries.length + '</span>' : '') +
        '<span class="arc-day-num">' + d + '</span>' +
        (hasWork && kcal > 0 ? '<span class="arc-day-kcal">' + kcal + ' kcal</span>' : '') +
        '</div>';
    }
    grid.innerHTML = html;
  }

  // ── Dettaglio giorno ──────────────────────────────────────────
  function openDetail(dayKey) {
    selectedDay = dayKey;
    var entries = (byDay[dayKey] || []).slice().sort(function (a, b) {
      return new Date(a.completed_at) - new Date(b.completed_at);
    });

    var card = document.getElementById('arcDetailCard');
    var dateEl = document.getElementById('arcDetailDate');
    var body = document.getElementById('arcDetailBody');

    dateEl.textContent = formatLongDate(dayKey);

    if (!entries.length) {
      body.innerHTML = '<div class="arc-empty"><i class="fas fa-inbox"></i><p>Nessun allenamento questo giorno</p></div>';
    } else {
      body.innerHTML = entries.map(renderEntry).join('');
    }

    card.style.display = 'block';
    // evidenzia la cella
    renderGrid();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  window.arcOpenDay = openDetail;

  function closeDetail() {
    selectedDay = null;
    var card = document.getElementById('arcDetailCard');
    if (card) card.style.display = 'none';
    renderGrid();
  }

  function renderEntry(c) {
    var plan = c.workout_plans || {};
    var act = ACT[(plan.activity_type || '').toLowerCase()] || { label: plan.activity_type || 'Allenamento', icon: 'fa-dumbbell' };
    var time = c.completed_at ? new Date(c.completed_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';

    var metrics = [];
    if (c.actual_duration) metrics.push(metric('fa-clock', c.actual_duration + ' min', 'durata'));
    if (c.calories_burned) metrics.push(metric('fa-fire', c.calories_burned + ' kcal', 'calorie'));
    if (c.distance)        metrics.push(metric('fa-route', c.distance + ' km', 'distanza'));
    if (c.heart_rate_avg)  metrics.push(metric('fa-heart-pulse', c.heart_rate_avg + ' bpm', 'FC media'));
    if (c.rating)          metrics.push(metric('fa-star', c.rating + '/5', 'voto'));

    return '<div class="arc-entry">' +
      '<div class="arc-entry-top">' +
        '<div>' +
          '<div class="arc-entry-name"><i class="fas ' + act.icon + '"></i>' + esc(plan.name || 'Allenamento') + '</div>' +
          '<div class="arc-entry-time">' + esc(act.label) + (time ? ' · ore ' + time : '') + '</div>' +
        '</div>' +
        '<div class="arc-entry-actions">' +
          '<button class="arc-act arc-act--edit" onclick="arcEdit(\'' + esc(c.id) + '\')" title="Modifica"><i class="fas fa-pen"></i></button>' +
          '<button class="arc-act arc-act--cancel" onclick="arcCancel(\'' + esc(c.id) + '\')" title="Elimina"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      (metrics.length ? '<div class="arc-entry-metrics">' + metrics.join('') + '</div>' : '') +
      (c.notes ? '<div class="arc-entry-note">' + esc(c.notes) + '</div>' : '') +
      '</div>';
  }

  function metric(icon, val, lbl) {
    return '<span class="arc-metric"><i class="fas ' + icon + '"></i><strong>' + esc(String(val)) + '</strong> ' + esc(lbl) + '</span>';
  }

  // ── AZIONI: Annulla + Modifica (pattern condiviso con /stats) ──
  function findCompletion(id) {
    return allCompleted.find(function (c) { return c.id === id; });
  }

  function cancelCompletion(completionId) {
    var c = findCompletion(completionId);
    if (!c) return;
    var plan = c.workout_plans || {};
    if (!confirm('Eliminare il completamento di "' + (plan.name || 'questo allenamento') + '"?\n\n' +
                 'I dati di svolgimento verranno cancellati e la scheda tornerà "Da fare". Operazione irreversibile.')) {
      return;
    }

    Promise.all([
      sc.from('completed_workouts').delete().eq('id', completionId),
      c.workout_id
        ? sc.from('workout_plans').update({ completed: false, completed_at: null, average_heart_rate: null })
            .eq('id', c.workout_id).eq('user_id', currentUser.id)
        : Promise.resolve({ error: null })
    ]).then(function (results) {
      var errs = results.filter(function (r) { return r.error; });
      if (errs.length) { toast('Errore: ' + (errs[0].error.message || 'riprova'), 'error'); return; }
      toast('Allenamento eliminato dall\'archivio.', 'success');
      fetchData(); // ricarica + ridisegna (mantiene il giorno aperto se ha ancora entry)
    });
  }
  window.arcCancel = cancelCompletion;

  function editCompletion(completionId) {
    var c = findCompletion(completionId);
    if (!c) return;
    openEditModal(c);
  }
  window.arcEdit = editCompletion;

  function openEditModal(c) {
    var modal = document.getElementById('editCompletionModal');
    var plan = c.workout_plans || {};
    document.getElementById('ecmTitle').textContent = plan.name || 'Allenamento';

    var d = c.completed_at ? new Date(c.completed_at) : new Date();
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    document.getElementById('ecmDate').value      = local.toISOString().slice(0, 16);
    document.getElementById('ecmDuration').value  = c.actual_duration || '';
    document.getElementById('ecmCalories').value  = c.calories_burned || '';
    document.getElementById('ecmDistance').value  = c.distance || '';
    document.getElementById('ecmHeartRate').value = c.heart_rate_avg || '';
    document.getElementById('ecmNotes').value     = c.notes || '';

    modal.dataset.completionId = c.id;
    modal.dataset.workoutId = c.workout_id || '';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeEditModal() {
    var modal = document.getElementById('editCompletionModal');
    if (modal) { modal.classList.remove('is-open'); document.body.style.overflow = ''; }
  }
  window.arcCloseEditModal = closeEditModal;

  function saveEditCompletion() {
    var modal = document.getElementById('editCompletionModal');
    var completionId = modal.dataset.completionId;
    var workoutId = modal.dataset.workoutId;
    if (!completionId) return;

    var dateInput = document.getElementById('ecmDate').value.trim();
    var duration  = parseInt(document.getElementById('ecmDuration').value, 10);
    var calories  = parseInt(document.getElementById('ecmCalories').value, 10);
    var distance  = parseFloat(document.getElementById('ecmDistance').value);
    var heartRate = parseInt(document.getElementById('ecmHeartRate').value, 10);
    var notes     = document.getElementById('ecmNotes').value.trim();

    if (!dateInput) { toast('Inserisci la data di svolgimento.', 'error'); return; }
    if (isNaN(duration) || duration <= 0) { toast('Inserisci una durata valida (> 0).', 'error'); return; }

    var completedAtIso = new Date(dateInput).toISOString();
    var payload = {
      completed_at:    completedAtIso,
      actual_duration: duration,
      calories_burned: !isNaN(calories) && calories > 0 ? calories : null,
      distance:        !isNaN(distance) && distance > 0 ? distance : null,
      heart_rate_avg:  !isNaN(heartRate) && heartRate > 0 ? heartRate : null,
      notes:           notes || null
    };

    var btn = document.getElementById('ecmSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvo...'; }

    Promise.all([
      sc.from('completed_workouts').update(payload).eq('id', completionId),
      workoutId
        ? sc.from('workout_plans').update({ completed_at: completedAtIso, average_heart_rate: payload.heart_rate_avg })
            .eq('id', workoutId).eq('user_id', currentUser.id)
        : Promise.resolve({ error: null })
    ]).then(function (results) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salva modifiche'; }
      var errs = results.filter(function (r) { return r.error; });
      if (errs.length) { toast('Errore salvataggio: ' + (errs[0].error.message || 'riprova'), 'error'); return; }
      closeEditModal();
      toast('Modifiche salvate.', 'success');
      fetchData();
    });
  }
  window.arcSaveEditCompletion = saveEditCompletion;

  // ── Utilità ───────────────────────────────────────────────────
  // completed_at è timestamptz; ricavo la data nel fuso LOCALE dell'utente
  function toLocalDayKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatLongDate(dayKey) {
    var parts = dayKey.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12);
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function toast(msg, type) {
    if (window.showToast) { window.showToast(msg, type); return; }
    alert(msg);
  }

  // ESC chiude il modal
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var m = document.getElementById('editCompletionModal');
      if (m && m.classList.contains('is-open')) closeEditModal();
    }
  });
});
