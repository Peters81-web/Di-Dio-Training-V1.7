document.addEventListener('DOMContentLoaded', async function () {
 const SUPABASE_URL = 'https://szybzycjdqlhpgdlcoou.supabase.co';
 const SUPABASE_ANON_KEY = 'sb_publishable_9PWi6QX0YsUBx5RoaleQ1g_FQz82pmn';

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUser = null;
  let heartRateChartInstance = null;

  const elements = {
    heartRateChart: document.getElementById('heartRateChart'),
    logoutBtn: document.getElementById('logoutBtn')
  };

  async function init() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;

      if (!session) {
        window.location.href = '/';
        return;
      }

      currentUser = session.user;
      bindGlobalEvents();
      await renderHeartRateChart();
    } catch (error) {
      console.error('Errore inizializzazione statistiche:', error);
    }
  }

  function bindGlobalEvents() {
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/';
      });
    }
  }

  async function loadAverageHeartRateData() {
    try {
      const { data, error } = await supabaseClient
        .from('workout_plans')
        .select('id, name, scheduled_date, completed_at, average_heart_rate, completed')
        .eq('user_id', currentUser.id)
        .eq('completed', true)
        .order('scheduled_date', { ascending: true });

      if (error) throw error;

      return (data || [])
        .filter(item => item.average_heart_rate !== null && item.average_heart_rate !== undefined)
        .map(item => ({
          labelDate: item.scheduled_date || (item.completed_at ? item.completed_at.split('T')[0] : null),
          bpm: item.average_heart_rate,
          workoutName: item.name || 'Allenamento'
        }))
        .filter(item => item.labelDate);
    } catch (error) {
      console.error('Errore caricamento dati frequenza cardiaca:', error);
      return [];
    }
  }

  function buildEmptyState() {
    const container = elements.heartRateChart?.parentElement;
    if (!container) return;

    container.innerHTML = `
      <div class="stats-empty-state">
        <p>Nessun dato di frequenza cardiaca media disponibile.</p>
        <p>Completa almeno un allenamento e inserisci i BPM medi.</p>
      </div>
    `;
  }

  async function renderHeartRateChart() {
    const chartData = await loadAverageHeartRateData();

    if (!elements.heartRateChart) {
      console.error('Canvas #heartRateChart non trovato');
      return;
    }

    if (!chartData.length) {
      buildEmptyState();
      return;
    }

    const labels = chartData.map(item => {
      const date = new Date(item.labelDate + 'T12:00:00');
      return date.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      });
    });

    const values = chartData.map(item => item.bpm);

    if (heartRateChartInstance) {
      heartRateChartInstance.destroy();
    }

    heartRateChartInstance = new Chart(elements.heartRateChart, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Frequenza cardiaca media',
            data: values,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.18)',
            borderWidth: 3,
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#22c55e',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Frequenza cardiaca media'
          },
          legend: {
            display: true
          },
          tooltip: {
            callbacks: {
              title: function (tooltipItems) {
                return `Data: ${tooltipItems[0].label}`;
              },
              label: function (context) {
                const item = chartData[context.dataIndex];
                return `${item.workoutName}: ${context.parsed.y} BPM`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Data'
            }
          },
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: 'BPM'
            },
            suggestedMin: 80,
            suggestedMax: 180
          }
        }
      }
    });
  }

  await init();
});
