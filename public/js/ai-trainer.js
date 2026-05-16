/**
 * AI Trainer - DiDio Training App
 */
document.addEventListener('DOMContentLoaded', async function () {
  const supabaseClient = window.supabaseClient || createSupabaseClient();
  let currentUser = null;
  let generatedWorkouts = [];
  let currentGeneratedActivityType = 'running';

  const elements = {
    planType: document.getElementById('planType'),
    fitnessLevel: document.getElementById('fitnessLevel'),
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
    logoutBtn: document.getElementById('logoutBtn'),
    activityType: document.getElementById('activityType')
  };

  let workoutContext = null;

  async function init() {
    try {
      const session = await checkAuth();
      if (session) {
        currentUser = session.user;
        setupEventListeners();
        await loadWorkoutContext();
      }
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  async function loadWorkoutContext() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: completed, error } = await supabaseClient
        .from('completed_workouts')
        .select('completed_at, actual_duration, activity_type, workout_plans(name, activity_type)')
        .eq('user_id', currentUser.id)
        .gte('completed_at', thirtyDaysAgo.toISOString())
        .order('completed_at', { ascending: false })
        .limit(30);

      if (error || !completed?.length) return;

      const totalCompleted = completed.length;
      const avgDuration = Math.round(
        completed.reduce((s, w) => s + (w.actual_duration || 45), 0) / totalCompleted
      );

      // Frequenza settimanale (ultimi 30 giorni = ~4.3 settimane)
      const avgPerWeek = (totalCompleted / 4.3).toFixed(1);

      // Attività più frequente
      const actCounts = {};
      completed.forEach(w => {
        const act = w.activity_type || w.workout_plans?.activity_type || 'gym';
        actCounts[act] = (actCounts[act] || 0) + 1;
      });
      const topActivity = Object.entries(actCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

      // Streak (giorni consecutivi)
      const days = new Set(completed.map(w => w.completed_at.slice(0, 10)));
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (days.has(key)) { streak++; } else if (i > 0) { break; }
      }

      // Ultimi nomi allenamenti
      const lastWorkouts = completed.slice(0, 5)
        .map(w => w.workout_plans?.name)
        .filter(Boolean);

      workoutContext = { totalCompleted, avgDuration, avgPerWeek, topActivity, streak, lastWorkouts };
      renderContextCard(workoutContext);
    } catch (err) {
      console.warn('Context load error:', err);
    }
  }

  const ACT_LABELS = {
    running: 'Corsa', gym: 'Palestra', yoga: 'Yoga',
    cycling: 'Ciclismo', mobility: 'Mobilità', walking: 'Camminata'
  };

  function renderContextCard(ctx) {
    const card = document.getElementById('contextCard');
    const stats = document.getElementById('contextStats');
    const badge = document.getElementById('contextBadge');
    const quickPrompts = document.getElementById('quickPrompts');
    if (!card) return;

    badge.textContent = ctx.streak > 0 ? `🔥 ${ctx.streak} giorni di fila` : '';

    stats.innerHTML = `
      <div class="ctx-stat"><i class="fas fa-check-circle"></i><span>${ctx.totalCompleted}</span><small>completati (30gg)</small></div>
      <div class="ctx-stat"><i class="fas fa-calendar-alt"></i><span>${ctx.avgPerWeek}</span><small>sessioni/sett.</small></div>
      <div class="ctx-stat"><i class="fas fa-clock"></i><span>${ctx.avgDuration}m</span><small>durata media</small></div>
      <div class="ctx-stat"><i class="fas fa-running"></i><span>${ACT_LABELS[ctx.topActivity] || ctx.topActivity || '--'}</span><small>attività top</small></div>
    `;

    // Suggerimenti contestuali
    const suggestions = buildSuggestions(ctx);
    quickPrompts.innerHTML = suggestions.map(s =>
      `<button class="quick-prompt-btn" data-prompt="${s.prompt}" data-activity="${s.activity}">${s.label}</button>`
    ).join('');

    quickPrompts.querySelectorAll('.quick-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const promptEl = document.getElementById('aiPrompt');
        if (promptEl) promptEl.value = btn.dataset.prompt;
        const actEl = document.getElementById('activityType');
        if (actEl && btn.dataset.activity) actEl.value = btn.dataset.activity;
      });
    });

    card.style.display = 'block';
  }

  function buildSuggestions(ctx) {
    const suggestions = [];
    const avg = parseFloat(ctx.avgPerWeek);

    if (ctx.streak === 0) {
      suggestions.push({
        label: '🚀 Riparti dopo una pausa',
        prompt: `Ho fatto una pausa e voglio riprendere gradualmente. Negli ultimi 30 giorni ho fatto ${ctx.totalCompleted} allenamenti. Crea un piano soft per rientrare senza infortuni.`,
        activity: ctx.topActivity || 'gym'
      });
    } else if (ctx.streak >= 7) {
      suggestions.push({
        label: '🔥 Sono in forma, alza il livello',
        prompt: `Sono in striscia da ${ctx.streak} giorni e mi sento in forma. Voglio un piano più sfidante. Durata media attuale: ${ctx.avgDuration} min. Aumenta intensità e volume.`,
        activity: ctx.topActivity || 'gym'
      });
    }

    if (avg < 2) {
      suggestions.push({
        label: '📈 Aumenta la frequenza',
        prompt: `Mi alleno circa ${ctx.avgPerWeek} volte a settimana e voglio aumentare la frequenza gradualmente. Crea un piano da 3-4 sessioni settimanali compatibile con i miei impegni.`,
        activity: ctx.topActivity || 'gym'
      });
    } else if (avg >= 4) {
      suggestions.push({
        label: '💪 Ottimizza il recupero',
        prompt: `Mi alleno ${ctx.avgPerWeek} volte a settimana. Voglio un piano che bilanci carico e recupero, includendo sessioni di mobilità e stretching attivo.`,
        activity: 'mobility'
      });
    }

    suggestions.push({
      label: '🎯 Migliora in ' + (ACT_LABELS[ctx.topActivity] || 'palestra'),
      prompt: `Voglio migliorare le mie performance in ${ACT_LABELS[ctx.topActivity] || 'palestra'}. Durata media sessioni: ${ctx.avgDuration} min. Crea un piano progressivo di 4 settimane.`,
      activity: ctx.topActivity || 'gym'
    });

    return suggestions.slice(0, 3);
  }

  async function checkAuth() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!session) {
        window.location.href = '/';
        return null;
      }
      return session;
    } catch (error) {
      console.error('Auth error:', error);
      return null;
    }
  }

  function getSelectedActivityType() {
    return elements.activityType ? elements.activityType.value : 'running';
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
    if (/(yoga|saluto al sole)/.test(text)) return 'yoga';
    if (/(cicl|bike|cycling|bici|spin)/.test(text)) return 'cycling';
    if (/(mobilit|stretching|flessibilit|mobility)/.test(text)) return 'mobility';
    if (/(cammin|walking|passeggiata|passo)/.test(text)) return 'walking';

    return currentGeneratedActivityType || 'gym';
  }

  function setupEventListeners() {
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/';
      });
    }

    if (elements.generatePlanBtn) {
      elements.generatePlanBtn.addEventListener('click', generatePlan);
    }

    if (elements.regenerateBtn) {
      elements.regenerateBtn.addEventListener('click', generatePlan);
    }

    if (elements.newPlanBtn) {
      elements.newPlanBtn.addEventListener('click', () => {
        elements.aiResponseContainer.style.display = 'none';
        elements.workoutPreviewContainer.style.display = 'none';
        elements.aiPrompt.value = '';
        generatedWorkouts = [];
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    if (elements.saveWorkoutsBtn) {
      elements.saveWorkoutsBtn.addEventListener('click', showPreview);
    }

    if (elements.confirmSaveBtn) {
      elements.confirmSaveBtn.addEventListener('click', saveWorkouts);
    }

    if (elements.cancelSaveBtn) {
      elements.cancelSaveBtn.addEventListener('click', () => {
        elements.workoutPreviewContainer.style.display = 'none';
      });
    }
  }

  async function generatePlan() {
    const prompt = elements.aiPrompt ? elements.aiPrompt.value.trim() : '';
    const planType = elements.planType ? elements.planType.value : 'weekly';
    const fitnessLevel = elements.fitnessLevel ? elements.fitnessLevel.value : 'intermediate';
    const activityType = getSelectedActivityType();

    currentGeneratedActivityType = activityType;

    if (!prompt) {
      alert('Per favore descrivi il tuo obiettivo di allenamento.');
      return;
    }

    if (window.showAiLoading) window.showAiLoading();
    generatedWorkouts = [];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, planType, fitnessLevel, activityType, workoutContext }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'HTTP ' + response.status);
      }

      const data = await response.json();

      if (elements.aiResponse && data.text) {
        elements.aiResponse.innerHTML = marked.parse(data.text);
        elements.aiResponseContainer.style.display = 'block';
        generatedWorkouts = parseAIResponse(data.text);
        console.log('Allenamenti parsati:', generatedWorkouts.length, generatedWorkouts);
      }
    } catch (error) {
      console.error('Error generating plan:', error);
      const msg = error.name === 'AbortError'
        ? 'La generazione ha impiegato troppo tempo. Riprova con un obiettivo più breve.'
        : 'Errore: ' + error.message;
      if (elements.aiResponse) {
        elements.aiResponse.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> ${msg}</div>`;
        elements.aiResponseContainer.style.display = 'block';
      }
    } finally {
      if (window.hideAiLoading) window.hideAiLoading();
    }
  }

  function parseAIResponse(text) {
    const workouts = [];
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const dayBlocks = text.split(/(?=^###\s)/m).filter(function (block) {
      return block.trim().startsWith('###');
    });

    console.log('Blocchi giorno trovati:', dayBlocks.length);

    dayBlocks.forEach(function (day) {
      const firstLine = day.split('\n')[0].replace(/^#+\s*/, '').trim();
      const isRest = /riposo/i.test(firstLine);

      function extractSection(sectionName) {
        const regex = new RegExp('####\\s*' + sectionName + '[^\\n]*\\n([\\s\\S]*?)(?=####|$)', 'i');
        const match = day.match(regex);
        return match ? match[1].trim() : '';
      }

      const warmup = extractSection('Riscaldamento');
      const mainPhase = extractSection('Fase Principale');
      const cooldown = extractSection('Defaticamento');
      const notes = extractSection('Note e Consigli');

      if (!isRest && (warmup || mainPhase)) {
        workouts.push({
          name: firstLine.replace(/^Giorno\s*\d+:\s*/i, '').trim() || firstLine,
          scheduled_date: new Date(startDate.getTime() + 12 * 60 * 60 * 1000).toISOString().split('T')[0],
          warmup: warmup,
          main_phase: mainPhase,
          cooldown: cooldown,
          notes: notes,
          total_duration: 45,
          objective: "Piano generato dall'AI Trainer",
          activity_type: currentGeneratedActivityType || inferActivityTypeFromText({
            name: firstLine,
            warmup,
            main_phase: mainPhase,
            cooldown,
            notes,
            rawText: day
          })
        });
      }

      startDate.setDate(startDate.getDate() + 1);
    });

    return workouts;
  }

  function showPreview() {
    if (generatedWorkouts.length === 0) {
      alert('Nessun allenamento da salvare. Genera prima un piano.');
      return;
    }

    if (elements.workoutPreviewList) {
      elements.workoutPreviewList.innerHTML = generatedWorkouts.map(function (w, i) {
        return `
          <div class="preview-item">
            <div class="preview-item-header">
              <span class="preview-item-number">${i + 1}</span>
              <h4>${w.name}</h4>
            </div>
            <div class="preview-item-details">
              <p><strong>Tipo:</strong> ${w.activity_type || 'gym'}</p>
              <p><strong>Data:</strong> ${new Date(w.scheduled_date + 'T12:00:00').toLocaleDateString('it-IT')}</p>
              ${w.warmup ? `<p><strong>Riscaldamento:</strong> ${w.warmup}</p>` : ''}
              ${w.main_phase ? `<p><strong>Fase Principale:</strong> ${w.main_phase}</p>` : ''}
              ${w.cooldown ? `<p><strong>Defaticamento:</strong> ${w.cooldown}</p>` : ''}
              ${w.notes ? `<p><strong>Note:</strong> ${w.notes}</p>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    if (elements.workoutPreviewContainer) {
      elements.workoutPreviewContainer.style.display = 'block';
      elements.workoutPreviewContainer.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function saveWorkouts() {
    if (!currentUser || generatedWorkouts.length === 0) {
      alert('Nessun allenamento da salvare.');
      return;
    }

    const activityType = getSelectedActivityType();

    const workoutsWithUserId = generatedWorkouts.map(function (workout) {
      return Object.assign({}, workout, {
        user_id: currentUser.id,
        activity_id: null,
        activity_type: workout.activity_type || activityType
      });
    });

    try {
      const result = await supabaseClient.from('workout_plans').insert(workoutsWithUserId);
      if (result.error) throw result.error;

      alert('Allenamenti salvati con successo!');
      generatedWorkouts = [];

      if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'none';
      if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'none';
      if (elements.aiPrompt) elements.aiPrompt.value = '';
    } catch (error) {
      console.error('Error saving workouts:', error);
      alert('Errore durante il salvataggio degli allenamenti: ' + error.message);
    }
  }

  await init();
});
