document.addEventListener('DOMContentLoaded', async function () {
const SUPABASE_URL = 'https://szybzycjdqlhpgdlcoou.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9PWi6QX0YsUBx5RoaleQ1g_FQz82pmn';
 const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let currentUser = null;

  const elements = {
    workoutCardsContainer: document.getElementById('workoutCardsContainer'),
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
      await loadWorkouts();
    } catch (error) {
      console.error('Errore inizializzazione workout:', error);
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

  function formatDate(dateString) {
    if (!dateString) return 'Data non disponibile';

    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }

  function escapeHtml(text) {
    return (text || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getWorkoutTypeLabel(workout) {
    const type = (workout.activity_type || '').toLowerCase();

    const labelMap = {
      running: 'Corsa',
      gym: 'Palestra',
      yoga: 'Yoga',
      cycling: 'Ciclismo',
      mobility: 'Mobilità',
      walking: 'Camminata'
    };

    return labelMap[type] || 'Allenamento';
  }

  function getWorkoutIconClass(workout) {
    const type = (workout.activity_type || '').toLowerCase();

    const iconMap = {
      running: 'fas fa-running',
      gym: 'fas fa-dumbbell',
      yoga: 'fas fa-spa',
      cycling: 'fas fa-biking',
      mobility: 'fas fa-child-reaching',
      walking: 'fas fa-walking'
    };

    return iconMap[type] || 'fas fa-dumbbell';
  }

  function askAverageHeartRate(existingValue = '') {
    const input = prompt('Inserisci la frequenza cardiaca media (BPM):', existingValue);

    if (input === null) return null;

    const bpm = parseInt(input.trim(), 10);

    if (Number.isNaN(bpm) || bpm < 40 || bpm > 240) {
      alert('Inserisci un valore valido tra 40 e 240 BPM.');
      return undefined;
    }

    return bpm;
  }

  async function completeWorkout(workoutId, existingHeartRate = '') {
    const averageHeartRate = askAverageHeartRate(existingHeartRate);

    if (averageHeartRate === undefined) return;
    if (averageHeartRate === null) return;

    try {
      const { error } = await supabaseClient
        .from('workout_plans')
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          average_heart_rate: averageHeartRate
        })
        .eq('id', workoutId)
        .eq('user_id', currentUser.id)
        .select();

      if (error) throw error;

      alert('Allenamento completato con successo.');
      await loadWorkouts();
    } catch (error) {
      console.error('Errore completamento allenamento:', error);
      alert('Errore durante il completamento dell’allenamento: ' + error.message);
    }
  }

  async function markWorkoutIncomplete(workoutId) {
    try {
      const { error } = await supabaseClient
        .from('workout_plans')
        .update({
          completed: false,
          completed_at: null,
          average_heart_rate: null
        })
        .eq('id', workoutId)
        .eq('user_id', currentUser.id)
        .select();

      if (error) throw error;

      alert('Allenamento riportato a non completato.');
      await loadWorkouts();
    } catch (error) {
      console.error('Errore reset allenamento:', error);
      alert('Errore durante il reset dell’allenamento: ' + error.message);
    }
  }

  function createWorkoutCard(workout) {
    const iconClass = getWorkoutIconClass(workout);
    const typeLabel = getWorkoutTypeLabel(workout);

    return `
      <div class="workout-card" data-id="${escapeHtml(workout.id)}">
        <div class="workout-card-header">
          <div class="workout-card-icon">
            <i class="${iconClass}"></i>
          </div>
          <div>
            <div class="workout-card-type">${escapeHtml(typeLabel)}</div>
            <h3 class="workout-card-title">${escapeHtml(workout.name || 'Allenamento')}</h3>
          </div>
        </div>

        <div class="workout-card-body">
          <p><strong>Data:</strong> ${escapeHtml(formatDate(workout.scheduled_date))}</p>
          <p><strong>Obiettivo:</strong> ${escapeHtml(workout.objective || 'Nessun obiettivo')}</p>
          <p><strong>Difficoltà:</strong> ${escapeHtml(workout.difficulty || 'intermedio')}</p>
          <p><strong>Stato:</strong> ${workout.completed ? 'Completato' : 'Da completare'}</p>
          ${workout.average_heart_rate ? `<p><strong>FC media:</strong> ${escapeHtml(workout.average_heart_rate)} BPM</p>` : ''}
        </div>

        <div class="workout-card-actions">
          ${
            workout.completed
              ? `
                <button class="btn btn-secondary reset-workout-btn" data-workout-id="${workout.id}">
                  Annulla completamento
                </button>
              `
              : `
                <button class="btn btn-primary complete-workout-btn" data-workout-id="${workout.id}" data-heart-rate="${workout.average_heart_rate || ''}">
                  Completa
                </button>
              `
          }
        </div>
      </div>
    `;
  }

  function bindWorkoutActions() {
    document.querySelectorAll('.complete-workout-btn').forEach((button) => {
      button.addEventListener('click', async function () {
        const workoutId = this.dataset.workoutId;
        const existingHeartRate = this.dataset.heartRate || '';
        await completeWorkout(workoutId, existingHeartRate);
      });
    });

    document.querySelectorAll('.reset-workout-btn').forEach((button) => {
      button.addEventListener('click', async function () {
        const workoutId = this.dataset.workoutId;
        await markWorkoutIncomplete(workoutId);
      });
    });
  }

  async function loadWorkouts() {
    try {
      const { data, error } = await supabaseClient
        .from('workout_plans')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('scheduled_date', { ascending: true });

      if (error) throw error;

      if (!elements.workoutCardsContainer) return;

      if (!data || data.length === 0) {
        elements.workoutCardsContainer.innerHTML = `
          <div class="empty-state">
            <p>Nessun allenamento disponibile.</p>
          </div>
        `;
        return;
      }

      elements.workoutCardsContainer.innerHTML = data.map(createWorkoutCard).join('');
      bindWorkoutActions();
    } catch (error) {
      console.error('Errore caricamento workout:', error);
      if (elements.workoutCardsContainer) {
        elements.workoutCardsContainer.innerHTML = `
          <div class="empty-state">
            <p>Errore nel caricamento degli allenamenti.</p>
          </div>
        `;
      }
    }
  }

  await init();
});
