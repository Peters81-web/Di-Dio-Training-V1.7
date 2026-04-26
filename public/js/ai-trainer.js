/**
 * AI Trainer - DiDio Training App
 */
document.addEventListener('DOMContentLoaded', async function () {
  const supabaseClient = window.supabaseClient || createSupabaseClient();
  let currentUser = null;
  let workoutActivities = [];
  let generatedWorkouts = [];

  const elements = {
    planType: document.getElementById('planType'),
    fitnessLevel: document.getElementById('fitnessLevel'),
    activityType: document.getElementById('activityType'),
    aiPrompt: document.getElementById('aiPrompt'),
    generatePlanBtn: document.getElementById('generatePlanBtn'),
    aiResponseContainer: document.getElementById('aiResponseContainer'),
    aiResponse: document.getElementById('aiResponse'),
    saveWorkoutsBtn: document.getElementById('saveWorkoutsBtn'),
    regenerateBtn: document.getElementById('regenerateBtn'),
    newPlanBtn: document.getElementById('newPlanBtn'),
    workoutPreviewContainer: document.getElementById('workoutPreviewContainer'),
    workoutPreviewList: document.getElementById('workoutPreviewList'),
    confirmSaveBtn: document.getElementById('confirmSaveBtn'),
    cancelSaveBtn: document.getElementById('cancelSaveBtn'),
    aiLoadingOverlay: document.getElementById('aiLoadingOverlay'),
    logoutBtn: document.getElementById('logoutBtn')
  };

  async function init() {
    try {
      const session = await checkAuth();
      if (session) {
        currentUser = session.user;
        setupEventListeners();
        await loadActivities();
      }
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  async function checkAuth() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!session) { window.location.href = '/'; return null; }
      return session;
    } catch (error) {
      console.error('Auth error:', error);
      return null;
    }
  }

  async function loadActivities() {
    try {
      const { data, error } = await supabaseClient.from('activities').select('*').order('name');
      if (error) throw error;
      workoutActivities = data || [];
      if (elements.activityType) {
        workoutActivities.forEach(activity => {
          const option = document.createElement('option');
          option.value = activity.id;
          option.textContent = `${activity.icon || ''} ${activity.name}`.trim();
          elements.activityType.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading activities:', error);
    }
  }

  function setupEventListeners() {
    if (elements.generatePlanBtn) elements.generatePlanBtn.addEventListener('click', generatePlan);
    if (elements.saveWorkoutsBtn) elements.saveWorkoutsBtn.addEventListener('click', showWorkoutPreview);
    if (elements.regenerateBtn) elements.regenerateBtn.addEventListener('click', generatePlan);
    if (elements.newPlanBtn) elements.newPlanBtn.addEventListener('click', resetForm);
    if (elements.confirmSaveBtn) elements.confirmSaveBtn.addEventListener('click', saveWorkouts);
    if (elements.cancelSaveBtn) elements.cancelSaveBtn.addEventListener('click', cancelPreview);
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', async () => {
        try {
          await supabaseClient.auth.signOut();
          window.location.href = '/';
        } catch (error) {
          console.error('Logout error:', error);
        }
      });
    }
  }

  async function generatePlan() {
    const prompt = elements.aiPrompt ? elements.aiPrompt.value.trim() : '';
    const planType = elements.planType ? elements.planType.value : 'weekly';
    const fitnessLevel = elements.fitnessLevel ? elements.fitnessLevel.value : 'beginner';
    const activityType = elements.activityType ? elements.activityType.value : '';

    if (!prompt) {
      alert('Descrivi il tuo obiettivo per generare un piano.');
      if (elements.aiPrompt) elements.aiPrompt.focus();
      return;
    }

    if (elements.aiLoadingOverlay) elements.aiLoadingOverlay.style.display = 'flex';
    if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'none';

    try {
      const aiText = await callGeneratePlanAPI(prompt, planType, fitnessLevel, activityType);
      generatedWorkouts = parseAIResponse(aiText, planType, activityType);
      displayAIResponse(aiText);
      if (elements.aiResponseContainer) {
        elements.aiResponseContainer.style.display = 'block';
        elements.aiResponseContainer.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (error) {
      console.error('Error generating plan:', error);
      alert('Errore nella generazione del piano: ' + error.message);
    } finally {
      if (elements.aiLoadingOverlay) elements.aiLoadingOverlay.style.display = 'none';
    }
  }

  async function callGeneratePlanAPI(prompt, planType, fitnessLevel, activityType) {
    const response = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, planType, fitnessLevel, activityType })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Errore HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.text) throw new Error('Risposta vuota dal server.');
    return data.text;
  }

  function parseAIResponse(response, planType, activityType) {
    const workouts = [];
    const dayMatches = [...response.matchAll(/### Giorno (\d+): ([^\n]+)/g)];
    for (const match of dayMatches) {
      const dayNumber = parseInt(match[1]);
      const workoutName = match[2].trim();
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() + dayNumber - 1);
      const activityId = activityType || resolveActivityId(workoutName);
      const dayContent = extractDayContent(response, dayNumber);
      const warmup = extractSection(dayContent, 'Riscaldamento');
      const mainPhase = extractSection(dayContent, 'Fase Principale');
      const cooldown = extractSection(dayContent, 'Defaticamento');
      const notes = extractSection(dayContent, 'Note');
      if (workoutName.toLowerCase().includes('riposo') && !warmup && !mainPhase) continue;
      workouts.push({
        name: workoutName,
        scheduled_date: startDate.toISOString().split('T')[0],
        activity_id: activityId,
        warmup,
        main_phase: mainPhase,
        cooldown,
        notes,
        total_duration: 45,
        objective: `Piano ${planType} generato dall'AI Trainer`
      });
    }
    return workouts;
  }

  function extractDayContent(response, dayNumber) {
    const start = response.indexOf(`### Giorno ${dayNumber}:`);
    if (start === -1) return '';
    const nextMatch = response.indexOf('### Giorno', start + 1);
    return nextMatch === -1 ? response.slice(start) : response.slice(start, nextMatch);
  }

  function extractSection(content, sectionTitle) {
    const marker = `#### ${sectionTitle}`;
    const idx = content.indexOf(marker);
    if (idx === -1) return '';
    const after = content.slice(idx + marker.length);
    const nextSection = after.indexOf('####');
    return (nextSection === -1 ? after : after.slice(0, nextSection)).trim();
  }

  function resolveActivityId(workoutName) {
    const name = workoutName.toLowerCase();
    const find = (keyword) => workoutActivities.find(a => a.name.toLowerCase().includes(keyword))?.id;
    if (name.includes('cardio') || name.includes('corsa') || name.includes('ciclismo')) return find('cardio');
    if (name.includes('forza') || name.includes('peso')) return find('forza');
    if (name.includes('flessibilit') || name.includes('yoga') || name.includes('stretching')) return find('flessibilit');
    if (name.includes('hiit')) return find('hiit');
    if (name.includes('nuoto')) return find('nuoto');
    if (name.includes('riposo')) return find('recupero');
    return workoutActivities[0]?.id || null;
  }

  function displayAIResponse(response) {
    if (!elements.aiResponse) return;
    const html = response
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^#### (.+)$/gm, '<h5>$1</h5>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    elements.aiResponse.innerHTML = html;
  }

  function showWorkoutPreview() {
    if (generatedWorkouts.length === 0) {
      alert('Nessun allenamento da salvare.');
      return;
    }
    if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'block';
    if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'none';
    if (!elements.workoutPreviewList) return;
    elements.workoutPreviewList.innerHTML = '';
    generatedWorkouts.forEach((workout, index) => {
      const workoutDate = new Date(workout.scheduled_date);
      const formattedDate = workoutDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
      const activity = workoutActivities.find(a => a.id === workout.activity_id);
      const activityName = activity ? activity.name : 'Attività non specificata';
      const item = document.createElement('div');
      item.className = 'workout-preview-item';
      item.dataset.index = index;
      item.innerHTML = `
        <h4>${workout.name}</h4>
        <p><strong>Data:</strong> ${formattedDate}</p>
        <p><strong>Attività:</strong> ${activityName}</p>
        ${workout.warmup ? `<p><strong>Riscaldamento:</strong> ${workout.warmup}</p>` : ''}
        ${workout.main_phase ? `<p><strong>Fase Principale:</strong> ${workout.main_phase}</p>` : ''}
        ${workout.cooldown ? `<p><strong>Defaticamento:</strong> ${workout.cooldown}</p>` : ''}
        ${workout.notes ? `<p><strong>Note:</strong> ${workout.notes}</p>` : ''}
      `;
      elements.workoutPreviewList.appendChild(item);
    });
    if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.scrollIntoView({ behavior: 'smooth' });
  }

  async function saveWorkouts() {
    if (generatedWorkouts.length === 0) {
      alert('Nessun allenamento da salvare.');
      return;
    }
    if (elements.aiLoadingOverlay) elements.aiLoadingOverlay.style.display = 'flex';
    try {
      const workoutsWithUserId = generatedWorkouts.map(workout => ({
        ...workout,
        user_id: currentUser.id,
        created_at: new Date().toISOString()
      }));
      const { error } = await supabaseClient.from('workout_plans').insert(workoutsWithUserId);
      if (error) throw error;
      alert('Piano di allenamento salvato con successo!');
      if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'none';
      resetForm();
      setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
    } catch (error) {
      console.error('Error saving workouts:', error);
      alert('Errore nel salvataggio: ' + error.message);
    } finally {
      if (elements.aiLoadingOverlay) elements.aiLoadingOverlay.style.display = 'none';
    }
  }

  function cancelPreview() {
    if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'none';
    if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'block';
  }

  function resetForm() {
    if (elements.aiPrompt) elements.aiPrompt.value = '';
    if (elements.planType) elements.planType.value = 'weekly';
    if (elements.fitnessLevel) elements.fitnessLevel.value = 'beginner';
    if (elements.activityType) elements.activityType.value = '';
    if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'none';
    if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'none';
    generatedWorkouts = [];
    if (elements.aiPrompt) elements.aiPrompt.focus();
  }

  init();
});
