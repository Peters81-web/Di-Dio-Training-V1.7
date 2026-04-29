'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var sc = window.supabaseClient;
  var currentUser  = null;
  var allWorkouts  = [];
  var activePeriod = 7;
  var bpmChart     = null;
  var actChart     = null;
  var weekChart    = null;

  var ACT = {
    running:  { label: 'Corsa',     color: '#4e54c8' },
    gym:      { label: 'Palestra',  color: '#28a745' },
    yoga:     { label: 'Yoga',      color: '#f57c00' },
    cycling:  { label: 'Ciclismo',  color: '#17a2b8' },
    mobility: { label: 'Mobilita',  color: '#9c27b0' },
    walking:  { label: 'Camminata', color: '#fd7e14' }
  };

  // ── INIT ──────────────────────────────────────────────
  function init() {
    sc.auth.getSession().then(function (res) {
      if (res.error || !res.data.session) {
        window.location.href = '/';
        return;
      }
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
      sc.auth.signOut().then(function () {
        window.location.href = '/';
      });
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

  // ── FETCH ────────────────────────────────────────────
  function fetchData() {
    sc.from('workout_plans')
      .select('id,name,scheduled_date,completed,completed_at,average_heart_rate,activity_type,total_duration,difficulty')
      .eq('user_id', currentUser.id)
      .order('scheduled_date', { ascending: true })
      .then(function (res) {
        if (res.error) { console.error('Fetch error', res.error); return; }
        allWorkouts = res.data || [];
        renderAll();
      });
  }

  function getFiltered() {
    if (activePeriod === 0) return allWorkouts;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - activePeriod);
    return allWorkouts.filter(function (w) {
      return new Date(w.scheduled_date) >= cutoff;
    });
  }

  function renderAll() {
    var w = getFiltered();
    renderKPI(w);
    renderBpm(w);
    renderActivity(w);
    renderWeekly(w);
    renderTable(w);
  }

  // ── KPI ──────────────────────────────────────────────
  function renderKPI(ws) {
    var done    = ws.filter(function (w) { return w.completed; });
    var bpmList = done.map(function (w) { return w.average_heart_rate; }).filter(function (v) { return v && v > 0; });
    var mins    = ws.reduce(function (a, w) { return a + (w.total_duration || 0); }, 0);
    var avgBpm  = bpmList.length ? Math.round(bpmList.reduce(function (a, b) { return a + b; }, 0) / bpmList.length) + ' bpm' : '-';
    setText('kpiTotale',    ws.length);
    setText('kpiCompletati', done.length);
    setText('kpiBpm',       avgBpm);
    setText('kpiDurata',    mins > 0 ? mins + ' min' : '-');
  }

  // ── BPM CHART ────────────────────────────────────────
  function renderBpm(ws) {
    var data = ws.filter(function (w) {
      return w.completed && w.average_heart_rate > 0;
    }).map(function (w) {
      return { x: fmtDate(w.completed_at || w.scheduled_date), y: w.average_heart_rate, n: w.name || 'Allenamento' };
    });
    toggleBlock('bpmChartWrapper', 'bpmEmptyState', data.length > 0);
    if (!data.length) return;
    if (bpmChart) { bpmChart.destroy(); bpmChart = null; }
    var ctx = document.getElementById('bpmChart').getContext('2d');
    bpmChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(function (d) { return d.x; }),
        datasets: [
          {
            label: 'BPM medio',
            data: data.map(function (d) { return d.y; }),
            borderColor: '#e53935',
            backgroundColor: 'rgba(229,57,53,0.08)',
            borderWidth: 2.5,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: '#e53935',
            tension: 0.35,
            fill: true
          },
          {
            label: 'Zona aerobica (140 bpm)',
            data: data.map(function () { return 140; }),
            borderColor: '#4e54c8',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              title: function (items) { return data[items[0].dataIndex] ? data[items[0].dataIndex].n : items[0].label; },
              label: function (item) { return item.dataset.label === 'BPM medio' ? ' ' + item.raw + ' bpm' : ' Rif: ' + item.raw + ' bpm'; }
            }
          }
        },
        scales: {
          y: { min: 60, title: { display: true, text: 'BPM', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── ACTIVITY CHART ───────────────────────────────────
  function renderActivity(ws) {
    var counts = {};
    ws.forEach(function (w) {
      var t = (w.activity_type || 'altro').toLowerCase();
      counts[t] = (counts[t] || 0) + 1;
    });
    var keys = Object.keys(counts);
    toggleBlock('activityChartWrapper', 'activityEmptyState', keys.length > 0);
    if (!keys.length) return;
    if (actChart) { actChart.destroy(); actChart = null; }
    var labels = keys.map(function (k) { return ACT[k] ? ACT[k].label : 'Altro'; });
    var colors = keys.map(function (k) { return ACT[k] ? ACT[k].color : '#aaa'; });
    var ctx = document.getElementById('activityChart').getContext('2d');
    actChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: keys.map(function (k) { return counts[k]; }), backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 14 } },
          tooltip: { callbacks: { label: function (item) { return ' ' + item.label + ': ' + item.raw + ' allenamenti'; } } }
        }
      }
    });
  }

  // ── WEEKLY CHART ─────────────────────────────────────
  function renderWeekly(ws) {
    var done = ws.filter(function (w) { return w.completed && w.completed_at; });
    toggleBlock('weeklyChartWrapper', 'weeklyEmptyState', done.length > 0);
    if (!done.length) return;
    var weekMap = {};
    done.forEach(function (w) {
      var d   = new Date(w.completed_at);
      var mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      var key = mon.toISOString().slice(0, 10);
      weekMap[key] = (weekMap[key] || 0) + 1;
    });
    var sortedKeys = Object.keys(weekMap).sort();
    var labels = sortedKeys.map(function (k) {
      var d = new Date(k + 'T12:00:00');
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    });
    if (weekChart) { weekChart.destroy(); weekChart = null; }
    var ctx = document.getElementById('weeklyChart').getContext('2d');
    weekChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Allenamenti completati',
          data: sortedKeys.map(function (k) { return weekMap[k]; }),
          backgroundColor: 'rgba(78,84,200,0.75)',
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (item) { return ' ' + item.raw + (item.raw === 1 ? ' allenamento' : ' allenamenti'); } } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── TABLE ────────────────────────────────────────────
  function renderTable(ws) {
    var wrapper = document.getElementById('recentTableWrapper');
    if (!wrapper) return;
    var recent = ws.slice().sort(function (a, b) {
      return new Date(b.scheduled_date) - new Date(a.scheduled_date);
    }).slice(0, 10);
    if (!recent.length) {
      wrapper.innerHTML = '<div class="state-box"><i class="fas fa-inbox"></i><p>Nessun allenamento nel periodo selezionato</p></div>';
      return;
    }
    var rows = recent.map(function (w) {
      var act  = ACT[(w.activity_type || '').toLowerCase()] || { label: 'Altro' };
      var diff = w.difficulty === 'avanzato' ? 'badge-diff-avanzato'
               : w.difficulty === 'intermedio' ? 'badge-diff-intermedio'
               : 'badge-diff-facile';
      return '<tr>'
        + '<td>' + esc(fmtDate(w.scheduled_date)) + '</td>'
        + '<td>' + esc(w.name || 'Allenamento') + '</td>'
        + '<td>' + esc(act.label) + '</td>'
        + '<td><span class="badge ' + diff + '">' + esc(w.difficulty || '-') + '</span></td>'
        + '<td>' + (w.total_duration ? w.total_duration + ' min' : '-') + '</td>'
        + '<td>' + (w.average_heart_rate ? w.average_heart_rate + ' bpm' : '-') + '</td>'
        + '<td><span class="badge ' + (w.completed ? 'badge-done' : 'badge-todo') + '">'
        + (w.completed ? 'Completato' : 'Da fare') + '</span></td>'
        + '</tr>';
    }).join('');
    wrapper.innerHTML = '<table class="recent-table">'
      + '<thead><tr>'
      + '<th>Data</th><th>Nome</th><th>Attivita</th>'
      + '<th>Difficolta</th><th>Durata</th><th>BPM medio</th><th>Stato</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  }

  // ── UTILITY ─────────────────────────────
