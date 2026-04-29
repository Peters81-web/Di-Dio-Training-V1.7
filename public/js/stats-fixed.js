document.addEventListener('DOMContentLoaded', async function () {
  // Usa il client globale già inizializzato da supabase-config.js
  const supabaseClient = window.supabaseClient || window.createSupabaseClient();
  let currentUser  = null;
  let allWorkouts  = [];
  let activePeriod = 7;

  // ─── Chart instances (per poterle distruggere al refresh) ──────────────────
  let bpmChartInstance      = null;
  let activityChartInstance = null;
  let weeklyChartInstance   = null;

  // ─── Mappa attività ────────────────────────────────────────────────────────
  const ACTIVITY_MAP = {
    running:  { label: 'Corsa',     color: '#4e54c8' },
    gym:      { label: 'Palestra',  color: '#28a745' },
    yoga:     { label: 'Yoga',      color: '#f57c00' },
    cycling:  { label: 'Ciclismo',  color: '#17a2b8' },
    mobility: { label: 'Mobilità',  color: '#9c27b0' },
    walking:  { label: 'Camminata', color: '#fd7e14' },
  };
  const DEFAULT_ACTIVITY = { label: 'Altro', color: '#aaa' };

  // ─── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error || !session) { window.location.href = '/'; return; }
      currentUser = session.user;

      bindLogout();
      bindPeriodFilter();
      await fetchAndRender();
    } catch (err) {
      console.error('Errore inizializzazione stats:', err);
    }
  }

  // ─── Logout ────────────────────────────────────────────────────────────────
  function bindLogout() {
    const btn = document.getElementById('logoutBtn');
    if (btn) btn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = '/';
    });
  }

  // ─── Filtro periodo ────────────────────────────────────────────────────────
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

  // ─── Fetch dati dal DB ─────────────────────────────────────────────────────
  async function fetchAndRender() {
    try {
      const { data, error } = await supabaseClient
        .from('workout_plans')
        .select('id, name, scheduled_date, completed, completed_at, average_heart_rate, activity_type, total_duration, difficulty')
        .eq('user_id', currentUser.id)
        .order('scheduled_date', { ascending: true });

      if (error) throw error;
      allWorkouts = data || [];
      renderAll();
    } catch (err) {
      console.error('Errore caricamento stats:', err);
    }
  }

  // ─── Filtra per periodo ────────────────────────────────────────────────────
  function getFilteredWorkouts() {
    if (activePeriod === 0) return allWorkouts;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - activePeriod);
    return allWorkouts.filter(w => new Date(w.scheduled_date) >= cutoff);
  }

  // ─── Render tutto ──────────────────────────────────────────────────────────
  function renderAll() {
    const workouts = getFilteredWorkouts();
    renderKPI(workouts);
    renderBpmChart(workouts);
    renderActivityChart(workouts);
    renderWeeklyChart(workouts);
    renderRecentTable(workouts);
  }

  // ─── KPI Cards ─────────────────────────────────────────────────────────────
  function renderKPI(workouts) {
    const completati = workouts.filter(w => w.completed);
    const bpmList    = completati.map(w => w.average_heart_rate).filter(v => v && v > 0);
    const durata     = workouts.reduce((acc, w) => acc + (w.total_duration || 0), 0);

    setText('kpiTotale',    workouts.length);
    setText('kpiCompletati', completati.length);
    setText('kpiBpm',       bpmList.length > 0
      ? Math.round(bpmList.reduce((a, b) => a + b, 0) / bpmList.length) + ' bpm'
      : '—');
    setText('kpiDurata',    durata > 0 ? durata + ' min' : '—');
  }

  // ─── Grafico BPM ──────────────────────────────────────────────────────────
  function renderBpmChart(workouts) {
    const bpmData = workouts
      .filter(w => w.completed && w.average_heart_rate > 0)
      .map(w => ({
        x: formatDate(w.completed_at || w.scheduled_date),
        y: w.average_heart_rate,
        name: w.name || 'Allenamento',
      }));

    const wrapper   = document.getElementById('bpmChartWrapper');
    const emptyState = document.getElementById('bpmEmptyState');

    if (bpmData.length === 0) {
      wrapper.style.display    = 'none';
      emptyState.style.display = 'block';
      return;
    }
    wrapper.style.display    = 'block';
    emptyState.style.display = 'none';

    if (bpmChartInstance) bpmChartInstance.destroy();

    const ctx = document.getElementById('bpmChart').getContext('2d');
    bpmChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: bpmData.map(d => d.x),
        datasets: [
          {
            label: 'BPM medio',
            data: bpmData.map(d => d.y),
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
            // Linea di riferimento zona aerobica
            label: 'Zona aerobica (140 bpm)',
            data: bpmData.map(() => 140),
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
              title: (items) => bpmData[items[0].dataIndex]?.name || items[0].label,
              label: (item) => item.dataset.label === 'BPM medio'
                ? ` ${item.raw} bpm`
                : ` Riferimento: ${item.raw} bpm`,
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

  // ─── Grafico distribuzione attività (donut) ────────────────────────────────
  function renderActivityChart(workouts) {
    const counts = {};
    workouts.forEach(w => {
      const type = (w.activity_type || 'altro').toLowerCase();
      counts[type] = (counts[type] || 0) + 1;
    });

    const wrapper    = document.getElementById('activityChartWrapper');
    const emptyState = document.getElementById('activityEmptyState');

    if (Object.keys(counts).length === 0) {
      wrapper.style.display    = 'none';
      emptyState.style.display = 'block';
      return;
    }
    wrapper.style.display    = 'block';
    emptyState.style.display = 'none';

    if (activityChartInstance) activityChartInstance.destroy();

    const labels = Object.keys(counts).map(k => (ACTIVITY_MAP[k] || DEFAULT_ACTIVITY).label);
    const colors = Object.keys(counts).map(k => (ACTIVITY_MAP[k] || DEFAULT_ACTIVITY).color);

    const ctx = document.getElementById('activityChart').getContext('2d');
    activityChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: Object.values(counts),
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
              label: (item) => ` ${item.label}: ${item.raw} allenamenti`
            }
          }
        }
      }
    });
  }

  // ─── Grafico allenamenti per settimana (bar) ───────────────────────────────
  function renderWeeklyChart(workouts) {
    const completati = workouts.filter(w => w.completed && w.completed_at);

    const wrapper    = document.getElementById('weeklyChartWrapper');
    const emptyState = document.getElementById('weeklyEmptyState');

    if (completati.length === 0) {
      wrapper.style.display    = 'none';
      emptyState.style.display = 'block';
      return;
    }
    wrapper.style.display    = 'block';
    emptyState.style.display = 'none';

    // Raggruppa per settimana (lunedì)
    const weekMap = {};
    completati.forEach(w => {
      const d = new Date(w.completed_at);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      weekMap[key] = (weekMap[key] || 0) + 1;
    });

    const sortedKeys   = Object.keys(weekMap).sort();
    const labels       = sortedKeys.map(k => {
      const d = new Date(k + 'T12:00:00');
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    });

    if (weeklyChartInstance) weeklyChartInstance.destroy();

    const ctx = document.getElementById('weeklyChart').getContext('2d');
    weeklyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Allenamenti completati',
          data: sortedKeys.map(k => weekMap[k]),
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
              label: (item) => ` ${item.raw} allenament${item.raw === 1 ? 'o' : 'i'}`
            }
          }
        },
        scales: {
          y: {
            begi
