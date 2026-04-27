// =========================
// STATO GLOBALE AI TRAINER
// =========================
let generatedPlanText = '';
let generatedWorkouts = [];
let currentGeneratedActivityType = 'running';

// =========================
// HELPERS
// =========================
function getSelectedActivityType() {
  const el = document.getElementById('activityType');
  return el ? el.value : 'running';
}

function inferActivityTypeFromText(workout) {
  const text = [
    workout?.activity_type,
    workout?.name,
    workout?.objective,
    workout?.main_phase,
    workout?.notes,
    workout?.rawText
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(corsa|running|ripetute|resistenza|velocit|jogging|fartlek)/.test(text)) return 'running';
  if (/(palestra|gym|forza|manubri|bilanciere|squat|stacchi|push|pull)/.test(text)) return 'gym';
  if (/(yoga)/.test(text)) return 'yoga';
  if (/(cicl|bike|cycling|bici|spin)/.test(text)) return 'cycling';
  if (/(mobilit|stretching|flessibilit|mobility)/.test(text)) return 'mobility';
  if (/(cammin|walking|passeggiata)/.test(text)) return 'walking';

  return currentGeneratedActivityType || 'gym';
}

function normalizeWorkout(workout, fallbackType) {
  return {
    ...workout,
    activity_type: workout.activity_type || inferActivityTypeFromText(workout) || fallbackType || 'gym'
  };
}
