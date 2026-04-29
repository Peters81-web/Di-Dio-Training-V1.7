document.addEventListener('DOMContentLoaded', async function () {
  const supabaseClient = window.supabaseClient || window.createSupabaseClient();
  let currentUser = null;

  const elements = {
    workoutCardsContainer: document.getElementById('workoutCardsContainer'),
    logoutBtn:             document.getElementById('logoutBtn'),
  };

  // ─── Init ────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!session) { window.location.href = '/'; return; }
      currentUser = session.user;
      bindGlobalEvents();
      await loadWorkouts();
    } catch (err) {
      console.error('Errore inizializzazione workout:', err);
    }
  }

  // ─── Eventi globali ───────────────────────────────────────────────────────
  function bindGlobalEvents() {
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/';
      });
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  function formatDate(dateString) {
    if (!dateString) return 'Data non disponibile';
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function escapeHtml(text) {
    return (text || '')
      .toString()
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

  // Mappe centralizzate — aggiungere nuovi tipi qui, non sparsi nel codice
  const ACTIVITY_MAP = {
    running:  { label: 'Corsa',      icon: 'fas fa-running'        },
    gym:      { label: 'Palestra',   icon: 'fas fa-dumbbell'       },
    yoga:     { label: 'Yoga',       icon: 'fas fa-spa'            },
    cycling:  { label: 'Ciclismo',   icon: 'fas fa-biking'         },
    mobility: { label: 'Mobilità',   icon: 'fas fa-child-reaching' },
    walking:  { label: 'Camminata',  icon: 'fas fa-walking'        },
  };
  const DEFAULT_ACTIVITY = { label: 'Allenamento', icon: 'fas fa-dumbbell' };

  function getActivityInfo(workout) {
    const type = (workout.activity_type || '').toLowerCase();
    return ACTIVITY_MAP[type] || DEFAULT_ACTIVITY;
  }

  // ─── Completamento workout ────────────────────────────────────────────────
  async function completeWorkout(workoutId, existingHeartRate = '') {
    const input = prompt('Inserisci la frequenza cardiaca media (BPM):', existingHeartRate);
    if (input === null) return; // utente ha annullato

    const averageHeartRate = parseInt(input.trim(), 10);
    if (Number.isNaN(averageHeartRate) || averageHeartRate < 40 || averageHeartRate > 240) {
      alert('Inserisci un valore valido tra 40 e 240 BPM.');
      return;
    }

    try {
      const { error } = await supabaseClient
        .from('workout_plans')
        .update({
          completed:           true,
          completed_at:        new Date().toISOString(),
          average_heart_rate:  averageHeartRate,
        })
        .eq('id', workoutId)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      alert('Allenamento completato con successo.');
      await loadWorkouts();
    } catch (err) {
      console.error('Errore completamento allenamento:', err);
      alert('Errore durante il completamento: ' + err.message);
    }
  }

  async function markWorkoutIncomplete(workoutId) {
    try {
      const { error } = await supabaseClient
        .from('workout_plans')
        .update({ completed: false, completed_at: null, average_heart_rate: null })
        .eq('id', workoutId)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      alert('Allenamento riportato a non completato.');
      await loadWorkouts();
    } catch (err) {
      console.error('Errore reset allenamento:', err);
      alert('Errore durante il reset: ' + err.message);
    }
  }

  // ─── Rendering card ───────────────────────────────────────────────────────
  function createWorkoutCard(workout) {
    const { label: typeLabel, icon: iconClass } = getActivityInfo(workout);

    return `
      <div class="workout-card ${workout.completed ? 'completed' : ''}">
        <div class="workout-card-header">
          <i class="${escapeHtml(iconClass)}"></i>
          <span class="workout-type-label">${escapeHtml(typeLabel)}</span>
        </div>
        <div class="workout-card-body">
          <h3>${escapeHtml(workout.name || 'Allenamento')}</h3>
          <p><strong>Data:</strong> ${escapeHtml(formatDate(workout.scheduled_date))}</p>
          <p><strong>Obiettivo:</strong> ${escapeHtml(workout.objective || 'Nessun obiettivo')}</p>
          <p><strong>Difficoltà:</strong> ${escapeHtml(workout.difficulty || 'intermedio')}</p>
          <p><strong>Stato:</strong> ${workout.completed ? 'Completato ✅' : 'Da completare'}</p>
          ${workout.average_heart_rate
            ? `<p><strong>FC media:</strong> ${escapeHtml(String(workout.average_heart_rate))} BPM</p>`
            : ''}
        </div>
        <div class="workout-card-actions">
          ${workout.completed
            ? `<button class="reset-workout-btn"    data-workout-id="${escapeHtml(String(workout.id))}">Annulla completamento</button>`
            : `<button class="complete-workout-btn" data-workout-id="${escapeHtml(String(workout.id))}" data-heart-rate="${escapeHtml(String(workout.average_heart_rate || ''))}">Completa</button>`
          }
        </div>
      </div>`;
  }

  // ─── Binding azioni card ──────────────────────────────────────────────────
  function bindWorkoutActions() {
    document.querySelectorAll('.complete-workout-btn').forEach((btn) => {
      btn.addEventListener('click', async function () {
        const { workoutId, heartRate } = this.dataset;
        if (!workoutId) { alert('ID allenamento mancante.'); return; }
        await completeWorkout(workoutId, heartRate || '');
      });
    });

    document.querySelectorAll('.reset-workout-btn').forEach((btn) => {
      btn.addEventListener('click', async function () {
        await markWorkoutIncomplete(this.dataset.workoutId);
      });
    });
  }

  // ─── Caricamento workout (colonne esplicite, no select *) ─────────────────
  async function loadWorkouts() {
    try {
      const { data, error } = await supabaseClient
        .from('workout_plans')
        .select('id, name, scheduled_date, objective, difficulty, completed, completed_at, average_heart_rate, activity_type')
        .eq('user_id', currentUser.id)
        .order('scheduled_date', { ascending: true });

      if (error) throw error;

      if (!elements.workoutCardsContainer) return;

      if (!data || data.length === 0) {
        elements.workoutCardsContainer.innerHTML = `
          <div class="empty-state">
            <p>Nessun allenamento disponibile.</p>
          </div>`;
        return;
      }

      elements.workoutCardsContainer.innerHTML = data.map(createWorkoutCard).join('');
      bindWorkoutActions();
    } catch (err) {
      console.error('Errore caricamento workout:', err);
      if (elements.workoutCardsContainer) {
        elements.workoutCardsContainer.innerHTML = `
          <div class="error-state">
            <p>Errore nel caricamento degli allenamenti. Riprova.</p>
          </div>`;
      }
    }
  }

  // ─── Avvio ────────────────────────────────────────────────────────────────
  await init();
});
