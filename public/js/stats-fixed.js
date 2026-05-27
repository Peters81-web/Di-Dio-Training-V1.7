'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var sc = window.supabaseClient;
  var currentUser  = null;
  var allWorkouts  = [];
  var activePeriod = 7;
  var bpmChart = null;
  var actChart = null;
  var weekChart = null;
  var durationChart = null;
  var calChart = null;
  var allCompleted = [];

  var ACT = {
    running:  { label: 'Corsa',     color: '#4e54c8' },
    gym:      { label: 'Palestra',  color: '#28a745' },
    yoga:     { label: 'Yoga',      color: '#f57c00' },
    cycling:  { label: 'Ciclismo',  color: '#17a2b8' },
    mobility: { label: 'Mobilita',  color: '#9c27b0' },
    walking:  { label: 'Camminata', color: '#fd7e14' }
  };

  function init() {
    sc.auth.getSession().then(function (res) {
      if (res.error || !res.data.session) { window.location.href = '/'; return; }
      currentUser = res.data.session.user;
      bindLogout();
      bindPeriod();
      fetchData();
    });
  }

  function bindLogout() {
    var btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      sc.auth.signOut().then(function () { window.location.href = '/'; });
    });
  }

  function bindPeriod() {
    var btns = document.querySelectorAll('.period-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activePeriod = parseInt(btn.dataset.period, 10);
        renderAll();
      });
    });
  }

  function fetchData() {
    Promise.all([
      sc.from('workout_plans')
        // created_at incluso per usarlo come fallback quando scheduled_date è NULL
        // (caso comune per le schede generate da AI Trainer / inserite manualmente)
        .select('id,name,scheduled_date,completed,completed_at,average_heart_rate,activity_type,total_duration,difficulty,created_at')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: true }),
      sc.from('completed_workouts')
        .select('completed_at,actual_duration,calories_burned,distance,workout_plans(name,activity_type)')
        .eq('user_id', currentUser.id)
        .order('completed_at', { ascending: true })
        .limit(200)
    ]).then(function (results) {
      if (!results[0].error) allWorkouts  = results[0].data || [];
      if (!results[1].error) allCompleted = results[1].data || [];
      renderAll();
      renderProgressCharts();
      renderPersonalRecords();
    });
  }

  // Restituisce la data di riferimento "logica" della scheda per il
  // filtro temporale. Priorità:
  //   1. scheduled_date — quando l'allenamento era pianificato
  //   2. completed_at   — quando è stato effettivamente completato
  //   3. created_at     — fallback se nessuno dei due è valorizzato
  // Le schede generate da AI / inserite senza pianificazione hanno
  // scheduled_date = NULL: senza fallback venivano escluse silenziosamente
  // da TUTTI i KPI quando il filtro tempo non era "Tutto".
  function getReferenceDate(w) {
    return w.scheduled_date || w.completed_at || w.created_at || null;
  }

  function getFiltered() {
    if (activePeriod === 0) return allWorkouts;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - activePeriod);
    return allWorkouts.filter(function (w) {
      var ref = getReferenceDate(w);
      if (!ref) return false;
      var d = new Date(ref);
      if (isNaN(d.getTime())) return false;
      return d >= cutoff;
    });
  }

  function renderAll() {
    var w = getFiltered();
    renderKPI(w); renderBpm(w); renderActivity(w); renderWeekly(w); renderTable(w);
  }

  // Filtra allCompleted per lo stesso periodo selezionato (activePeriod).
  // Usata sia da renderKPI (calorie) che potenzialmente da future logiche.
  function getFilteredCompleted() {
    if (activePeriod === 0) return allCompleted;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - activePeriod);
    return allCompleted.filter(function (c) {
      if (!c.completed_at) return false;
      return new Date(c.completed_at) >= cutoff;
    });
  }

  function renderKPI(ws) {
    var done = ws.filter(function (w) { return w.completed; });
    var bpmList = done.map(function (w) { return w.average_heart_rate; }).filter(function (v) { return v && v > 0; });
    var mins = ws.reduce(function (a, w) { return a + (w.total_duration || 0); }, 0);
    var avg = bpmList.length ? Math.round(bpmList.reduce(function (a, b) { return a + b; }, 0) / bpmList.length) + ' bpm' : '-';

    // Calorie: somma da allCompleted (completed_workouts.calories_burned)
    // filtrato per il periodo attivo. Più accurato di sommare da workout_plans
    // che non ha la colonna calories_burned.
    var completedInPeriod = getFilteredCompleted();
    var kcal = completedInPeriod.reduce(function (sum, c) { return sum + (c.calories_burned || 0); }, 0);

    setText('kpiTotale', ws.length);
    setText('kpiCompletati', done.length);
    setText('kpiBpm', avg);
    setText('kpiDurata', mins > 0 ? mins + ' min' : '-');
    setText('kpiCalorie', kcal > 0 ? kcal + ' kcal' : '-');
  }

  function renderBpm(ws) {
    var data = ws.filter(function (w) { return w.completed && w.average_heart_rate > 0; })
      .map(function (w) { return { x: fmtDate(w.completed_at || w.scheduled_date), y: w.average_heart_rate, n: w.name || 'Allenamento' }; });
    toggleBlock('bpmChartWrapper', 'bpmEmptyState', data.length > 0);
    if (!data.length) return;
    if (bpmChart) { bpmChart.destroy(); bpmChart = null; }
    var ctx = document.getElementById('bpmChart').getContext('2d');
    bpmChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(function (d) { return d.x; }),
        datasets: [
          { label: 'BPM medio', data: data.map(function (d) { return d.y; }),
            borderColor: '#e53935', backgroundColor: 'rgba(229,57,53,0.08)',
            borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7,
            pointBackgroundColor: '#e53935', tension: 0.35, fill: true },
          { label: 'Zona aerobica (140 bpm)', data: data.map(function () { return 140; }),
            borderColor: '#4e54c8', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: { callbacks: {
            title: function (it) { return data[it[0].dataIndex] ? data[it[0].dataIndex].n : it[0].label; },
            label: function (it) { return it.dataset.label === 'BPM medio' ? ' ' + it.raw + ' bpm' : ' Rif: ' + it.raw + ' bpm'; }
          }}
        },
        scales: {
          y: { min: 60, title: { display: true, text: 'BPM', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderActivity(ws) {
    var counts = {};
    ws.forEach(function (w) { var t = (w.activity_type || 'altro').toLowerCase(); counts[t] = (counts[t] || 0) + 1; });
    var keys = Object.keys(counts);
    toggleBlock('activityChartWrapper', 'activityEmptyState', keys.length > 0);
    if (!keys.length) return;
    if (actChart) { actChart.destroy(); actChart = null; }
    var ctx = document.getElementById('activityChart').getContext('2d');
    actChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: keys.map(function (k) { return ACT[k] ? ACT[k].label : 'Altro'; }),
        datasets: [{ data: keys.map(function (k) { return counts[k]; }),
          backgroundColor: keys.map(function (k) { return ACT[k] ? ACT[k].color : '#aaa'; }),
          borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 14 } },
          tooltip: { callbacks: { label: function (it) { return ' ' + it.label + ': ' + it.raw + ' allenamenti'; } } }
        }
      }
    });
  }

  function renderWeekly(ws) {
    var done = ws.filter(function (w) { return w.completed && w.completed_at; });
    toggleBlock('weeklyChartWrapper', 'weeklyEmptyState', done.length > 0);
    if (!done.length) return;
    var weekMap = {};
    done.forEach(function (w) {
      // Usa ora locale (non UTC) per evitare shift di data col fuso orario
      var d = new Date(w.completed_at);
      var localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dayOfWeek = localDate.getDay();
      var monOffset = (dayOfWeek + 6) % 7;
      var mon = new Date(localDate);
      mon.setDate(localDate.getDate() - monOffset);
      var key = mon.getFullYear() + '-'
        + String(mon.getMonth() + 1).padStart(2, '0') + '-'
        + String(mon.getDate()).padStart(2, '0');
      weekMap[key] = (weekMap[key] || 0) + 1;
    });
    var sk = Object.keys(weekMap).sort();
    // Label: mostra intervallo settimana "11–17 mag" per chiarezza
    var lb = sk.map(function (k) {
      var mon = new Date(k + 'T12:00:00');
      var sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      var fmtMon = mon.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
      var fmtSun = sun.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
      return fmtMon + '–' + fmtSun;
    });
    if (weekChart) { weekChart.destroy(); weekChart = null; }
    var ctx = document.getElementById('weeklyChart').getContext('2d');
    weekChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: lb, datasets: [{ label: 'Completati',
        data: sk.map(function (k) { return weekMap[k]; }),
        backgroundColor: 'rgba(78,84,200,0.75)', borderRadius: 6, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (it) { return ' ' + it.raw + (it.raw === 1 ? ' allenamento' : ' allenamenti'); } } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderTable(ws) {
    var wrapper = document.getElementById('recentTableWrapper');
    if (!wrapper) return;
    // Ordina: completati per data effettiva (completed_at), da fare per data pianificata
    var recent = ws.slice().sort(function (a, b) {
      var da = a.completed && a.completed_at ? new Date(a.completed_at) : new Date(a.scheduled_date);
      var db = b.completed && b.completed_at ? new Date(b.completed_at) : new Date(b.scheduled_date);
      return db - da;
    }).slice(0, 10);
    if (!recent.length) {
      wrapper.innerHTML = '<div class="state-box"><i class="fas fa-inbox"></i><p>Nessun allenamento nel periodo</p></div>';
      return;
    }
    var rows = recent.map(function (w) {
      var act = ACT[(w.activity_type || '').toLowerCase()] || { label: 'Altro' };
      var dc  = w.difficulty === 'avanzato' ? 'badge-diff-avanzato' : w.difficulty === 'intermedio' ? 'badge-diff-intermedio' : 'badge-diff-facile';
      var sc2 = w.completed ? 'badge-done' : 'badge-todo';
      // Mostra data effettiva per completati, data pianificata per da fare
      var displayDate = w.completed && w.completed_at ? w.completed_at : w.scheduled_date;
      return '<tr>'
        + '<td>' + esc(fmtDate(displayDate)) + '</td>'
        + '<td>' + esc(w.name || 'Allenamento') + '</td>'
        + '<td>' + esc(act.label) + '</td>'
        + '<td><span class="badge ' + dc + '">' + esc(w.difficulty || '-') + '</span></td>'
        + '<td>' + (w.total_duration ? w.total_duration + ' min' : '-') + '</td>'
        + '<td>' + (w.average_heart_rate ? w.average_heart_rate + ' bpm' : '-') + '</td>'
        + '<td><span class="badge ' + sc2 + '">' + (w.completed ? 'Completato' : 'Da fare') + '</span></td>'
        + '</tr>';
    }).join('');
    wrapper.innerHTML = '<table class="recent-table">'
      + '<thead><tr><th>Data</th><th>Nome</th><th>Attività</th><th>Difficoltà</th><th>Durata</th><th>BPM</th><th>Stato</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>';
  }

  // ── Trend durata per attività ───────────────────────────
  function renderProgressCharts() {
    var data = allCompleted.filter(function (w) { return w.actual_duration > 0; });

    // Trend durata: ultimi 12 completamenti, raggruppati per settimana
    if (!data.length) {
      toggleBlock('durationTrendEmpty', 'durationTrendWrapper', true);
      toggleBlock('calWeekEmpty', 'calWeekWrapper', true);
      return;
    }

    // Duration trend — raggruppato per settimana (ora locale)
    var weekDur = {};
    data.forEach(function (w) {
      var d = new Date(w.completed_at);
      var localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var mon = new Date(localDate);
      mon.setDate(localDate.getDate() - ((localDate.getDay() + 6) % 7));
      var key = mon.getFullYear() + '-' + String(mon.getMonth()+1).padStart(2,'0') + '-' + String(mon.getDate()).padStart(2,'0');
      if (!weekDur[key]) weekDur[key] = { total: 0, count: 0 };
      weekDur[key].total += w.actual_duration;
      weekDur[key].count++;
    });
    var durKeys = Object.keys(weekDur).sort().slice(-10);
    var durData = durKeys.map(function (k) { return Math.round(weekDur[k].total / weekDur[k].count); });

    toggleBlock('durationTrendWrapper', 'durationTrendEmpty', true);
    if (durationChart) { durationChart.destroy(); durationChart = null; }
    var ctx1 = document.getElementById('durationTrendChart');
    if (ctx1) {
      durationChart = new Chart(ctx1.getContext('2d'), {
        type: 'line',
        data: {
          labels: durKeys.map(function (k) { return fmtDate(k); }),
          datasets: [{
            label: 'Durata media (min)', data: durData,
            borderColor: '#4e54c8', backgroundColor: 'rgba(78,84,200,0.08)',
            borderWidth: 2.5, pointRadius: 5, fill: true, tension: 0.35
          }]
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: false } }
        }
      });
    }

    // Calorie per settimana (ora locale)
    var weekCal = {};
    allCompleted.filter(function (w) { return w.calories_burned > 0; }).forEach(function (w) {
      var d = new Date(w.completed_at);
      var localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var mon = new Date(localDate);
      mon.setDate(localDate.getDate() - ((localDate.getDay() + 6) % 7));
      var key = mon.getFullYear() + '-' + String(mon.getMonth()+1).padStart(2,'0') + '-' + String(mon.getDate()).padStart(2,'0');
      weekCal[key] = (weekCal[key] || 0) + w.calories_burned;
    });
    var calKeys = Object.keys(weekCal).sort().slice(-10);

    if (!calKeys.length) {
      toggleBlock('calWeekEmpty', 'calWeekWrapper', true);
    } else {
      toggleBlock('calWeekWrapper', 'calWeekEmpty', true);
      if (calChart) { calChart.destroy(); calChart = null; }
      var ctx2 = document.getElementById('calWeekChart');
      if (ctx2) {
        calChart = new Chart(ctx2.getContext('2d'), {
          type: 'bar',
          data: {
            labels: calKeys.map(function (k) { return fmtDate(k); }),
            datasets: [{
              label: 'Calorie', data: calKeys.map(function (k) { return weekCal[k]; }),
              backgroundColor: 'rgba(255,107,53,0.75)', borderRadius: 6
            }]
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    }
  }

  // ── Personal Records ────────────────────────────────────
  function renderPersonalRecords() {
    var container = document.getElementById('personalRecords');
    if (!container) return;

    var data = allCompleted;
    if (!data.length) {
      container.innerHTML = '<div class="state-box"><i class="fas fa-medal"></i><p>Nessun allenamento completato</p></div>';
      return;
    }

    var maxDur  = data.reduce(function (m, w) { return w.actual_duration > (m.actual_duration || 0) ? w : m; }, {});
    var maxCal  = data.filter(function (w) { return w.calories_burned > 0; })
                      .reduce(function (m, w) { return w.calories_burned > (m.calories_burned || 0) ? w : m; }, {});
    var maxDist = data.filter(function (w) { return w.distance > 0; })
                      .reduce(function (m, w) { return w.distance > (m.distance || 0) ? w : m; }, {});
    var total   = data.reduce(function (s, w) { return s + (w.actual_duration || 0); }, 0);
    var totalCal = data.reduce(function (s, w) { return s + (w.calories_burned || 0); }, 0);

    var records = [
      { icon: '⏱️', value: maxDur.actual_duration ? maxDur.actual_duration + ' min' : '--', label: 'Sessione più lunga', date: maxDur.completed_at },
      { icon: '🔥', value: maxCal.calories_burned ? maxCal.calories_burned + ' kcal' : '--', label: 'Più calorie in una sessione', date: maxCal.completed_at },
      { icon: '📏', value: maxDist.distance ? maxDist.distance.toFixed(1) + ' km' : '--', label: 'Distanza record', date: maxDist.completed_at },
      { icon: '💪', value: data.length + ' sessioni', label: 'Totale completati', date: null },
      { icon: '⏰', value: total > 0 ? Math.round(total / 60) + ' ore' : '--', label: 'Ore totali allenamento', date: null },
      { icon: '🏋️', value: totalCal > 0 ? totalCal.toLocaleString('it-IT') + ' kcal' : '--', label: 'Calorie totali bruciate', date: null },
    ];

    container.innerHTML = records.map(function (r) {
      return '<div class="pr-card">'
        + '<div class="pr-icon">' + r.icon + '</div>'
        + '<div class="pr-value">' + esc(r.value) + '</div>'
        + '<div class="pr-label">' + esc(r.label) + '</div>'
        + (r.date ? '<div class="pr-date">' + fmtDate(r.date) + '</div>' : '')
        + '</div>';
    }).join('');
  }

  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  function toggleBlock(showId, hideId, show) {
    var s = document.getElementById(showId);
    var h = document.getElementById(hideId);
    if (s) s.style.display = show ? 'block' : 'none';
    if (h) h.style.display = show ? 'none'  : 'block';
  }

  function fmtDate(ds) {
    if (!ds) return '-';
    return new Date(ds).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  init();

});