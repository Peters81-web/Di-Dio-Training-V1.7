document.addEventListener('DOMContentLoaded', async function () {
  // window.supabaseClient è già inizializzato da supabase-config.js
  const sc = window.supabaseClient;
  let currentUser  = null;
  let allWorkouts  = [];
  let activePeriod = 7;

  let bpmChart      = null;
  let activityChart = null;
  let weeklyChart   = null;

  const ACTIVITY_MAP = {
    running:  { label: 'Corsa',     color: '#4e54c8' },
    gym:      { label: 'Palestra',  color: '#28a745' },
    yoga:     { label: 'Yoga',      color: '#f57c00' },
    cycling:  { label: 'Ciclismo',  color: '#17a2b8' },
    mobility: { label: 'Mobilità',  color: '#9c27b0' },
    walking:  { label: 'Camminata', color: '#fd7e14' },
  };
  const DEFAULT_ACT = { label: 'Altro', color: '#aaa' };

  // ── INIT ──────────────────────────────────────────────────
  async function init() {
    const { data: { session }, error } = await sc.auth.getSession();
    if (error || !session) { window.location.href = '/'; return; }
    currentUser = session.user;
    bindLogout();
    bindPeriodFilter();
    await fetchAndRender();
  }

  function bindLogout() {
    const btn = document.getElementById('logoutBtn');
    if (btn) btn.addEventListener('click', async () => {
      await sc.auth.signOut();
      window.location.href = '/';
    });
  }

  function bindPeriodFilter() {
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        activePeriod = parseInt(this.dataset.period, 10);
        renderAll();
      });
    });
  }

  // ── FETCH ────────────────────────────────────────────────
  async function fetchAndRender() {
    const { data, error } = await sc
      .from('workout_plans')
      .select('id, name, scheduled_date, completed, completed_at, average_heart_rate, activity_type, total_duration, difficulty')
      .eq('user_id', currentUser.id)
      .order('scheduled_date', { ascending: true });

    if (error) { console.error('Errore fetch stats:', error); return; }
    allWorkouts = data || [];
    renderAll();
  }

  function getFiltered() {
    if (activePeriod === 0) return allWorkouts;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - activePeriod);
    return allWorkouts.filter(w => new Date(w.scheduled_date) >= cutoff);
  }

  function renderAll() {
    const w = getFiltered();
    renderKPI(w);
    renderBpmChart(w);
    renderActivityChart(w);
    renderWeeklyChart(w);
    renderRecentTable(w);
  }

  // ── KPI ──────────────────────────────────────────────────
  function renderKPI(workouts) {
    const done    = workouts.filter(w => w.completed);
    const bpmList = done.map(w => w.average_heart_rate).filter(v => v && v > 0);
    const mins    = workouts.reduce((a, w) => a + (w.total_duration || 0), 0);

    set('kpiTotale',    workouts.length);
    set('kpiCompletati', done.length);
    set('kpiBpm',       bpmList.length
      ? Math.round(bpmList.reduce((a, b) => a + b, 0) / bpmList.length) + ' bpm'
      : '—');
    set('kpiDurata', mins > 0 ? mins + ' min' : '—');
  }

  // ── GRAFICO BPM ──────────────────────────────────────────
  function renderBpmChart(workouts) {
    const data = workouts
      .filter(w => w.completed && w.average_heart_rate > 0)
      .map(w => ({
        label: fmtDate(w.completed_at || w.scheduled_date),
        bpm:   w.average_heart_rate,
        name:  w.name || 'Allenamento',
      }));

    toggle('bpmChartWrapper', 'bpmEmptyState', data.length > 0);
    if (!data.length) return;

    if (bpmChart) bpmChart.destroy();
    bpmChart = new Chart(document.getElementById('bpmChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'BPM medio',
            data: data.map(d => d.bpm),
            borderColor: '#e53935',
            backgroundColor: 'rgba(229,57,53,0.08)',
            borderWidth: 2.5,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: '#e53935',
            tension: 0.35,
            fill: true,
          },
          {
            label: 'Zona aerobica (140 bpm)',
            data: data.map(() => 140),
            borderColor: '#4e54c8',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
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
              title: (items) => data[items[0].dataIndex]?.name || items[0].label,
              label: (item) => item.dataset.label === 'BPM medio'
                ? ' ' + item.raw + ' bpm'
                : ' Riferimento: ' + item.raw + ' bpm',
            }
          }
        },
        scales: {
          y: {
            min: 60,
            title: { display: true, text: 'BPM', font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── GRAFICO ATTIVITÀ (donut) ─────────────────────────────
  function renderActivityChart(workouts) {
    const counts = {};
    workouts.forEach(w => {
      const t = (w.activity_type || 'altro').toLowerCase();
      counts[t] = (counts[t] || 0) + 1;
    });

    toggle('activityChartWrapper', 'activityEmptyState', Object.keys(counts).length > 0);
    if (!Object.keys(counts).length) return;

    if (activityChart) activityChart.destroy();
    const keys   = Object.keys(counts);
    const labels = keys.map(k => (ACTIVITY_MAP[k] || DEFAULT_ACT).label);
    const colors = keys.map(k => (ACTIVITY_MAP[k] || DEFAULT_ACT).color);

    activityChart = new Chart(document.getElementById('activityChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: keys.map(k => counts[k]),
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 14 } },
          tooltip: {
            callbacks: {
              label: (item) => ' ' + item.label + ': ' + item.raw + ' allenamenti'
            }
          }
        }
      }
    });
  }

  // ── GRAFICO SETTIMANALE (bar) ────────────────────────────
  function renderWeeklyChart(workouts) {
    const done = workouts.filter(w => w.completed && w.completed_at);
    toggle('weeklyChartWrapper', 'weeklyEmptyState', done.length > 0);
    if (!done.length) return;

    const weekMap = {};
    done.forEach(w => {
      const d      = new Date(w.completed_at);
      const mon    = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key    = mon.toISOString().slice(0, 10);
      weekMap[key] = (weekMap[key] || 0) + 1;
    });

    const keys   = Object.keys(weekMap).sort();
    const labels = keys.map(k => {
      const d = new Date(k + 'T12:00:00');
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    });

    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(document.getElementById('weeklyChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Allenamenti completati',
          data: keys.map(k => weekMap[k]),
          backgroundColor: 'rgba(78,84,200,0.75)',
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ' ' + item.raw + (item.raw === 1 ? ' allenamento' : ' allenamenti')
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── TABELLA RECENTI ──────────────────────────────────────
  function renderRecentTable(workouts) {
    const wrapper = document.getElementById('recentTableWrapper');
    if (!wrapper) return;

    const recent = [...workouts]
      .sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date))
      .slice(0, 10);

    if (!recent.length) {
      wrapper.innerHTML = '<div class="state-box"><i class="fas fa-inbox"></i><p>Nessun allenamento nel periodo selezionato</p></div>';
      return;
    }

    const rows = recent.map(w => {
      const act  = ACTIVITY_MAP[(w.activity_type || '').toLowerCase()] || DEFAULT_ACT;
      const diff = w.difficulty === 'avanzato' ? 'badge-diff-avanzato'
                 : w.difficulty === 'intermedio' ? 'badge-diff-intermedio'
                 : 'badge-diff-facile';
      return '<tr>' +
        '<td>' + esc(fmtDate(w.scheduled_date)) + '</td>' +
        '<td>' + esc(w.name || 'Allenamento') + '</td>' +
        '<td>' + esc(act.label) + '</td>' +
        '<td><span class="badge ' + diff + '">' + esc(w.difficulty || '—') + '</span></td>' +
        '<td>' + (w.total_duration ? w.total_duration + ' min' : '—') + '</td>' +
        '<td>' + (w.average_heart_rate ? w.average_heart_rate + ' bpm' : '—') + '</td>' +
        '<td><span class="badge ' + (w.completed ? 'badge-done' : 'badge-todo') + '">' +
          (w.completed ? 'Completato' : 'Da fare') + '</span></td>' +
        '</tr>';
    }).join('');

    wrapper.innerHTML =
      '<table class="recent-table">' +
        '<thead><tr>' +
          '<th>Data</th><th>Nome</th><th>Attività</th>' +
          '<th>Difficoltà</th><th>Durata</th><th>BPM medio</th><th>Stato</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
  
