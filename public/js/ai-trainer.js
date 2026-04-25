/**
 * AI Trainer - DiDio Training App
 * Genera piani di allenamento personalizzati tramite OpenAI GPT-4o-mini.
 * La chiave API è gestita lato server (/api/generate-plan) — zero segreti nel client.
 */

document.addEventListener('DOMContentLoaded', async function () {
    const supabaseClient = window.supabaseClient || createSupabaseClient();

    let currentUser = null;
    let workoutActivities = [];
    let generatedWorkouts = [];

    const elements = {
        planType:                  document.getElementById('planType'),
        fitnessLevel:              document.getElementById('fitnessLevel'),
        aiPrompt:                  document.getElementById('aiPrompt'),
        generatePlanBtn:           document.getElementById('generatePlanBtn'),
        aiResponseContainer:       document.getElementById('aiResponseContainer'),
        aiResponse:                document.getElementById('aiResponse'),
        saveWorkoutsBtn:           document.getElementById('saveWorkoutsBtn'),
        regenerateBtn:             document.getElementById('regenerateBtn'),
        newPlanBtn:                document.getElementById('newPlanBtn'),
        workoutPreviewContainer:   document.getElementById('workoutPreviewContainer'),
        workoutPreviewList:        document.getElementById('workoutPreviewList'),
        confirmSaveBtn:            document.getElementById('confirmSaveBtn'),
        cancelSaveBtn:             document.getElementById('cancelSaveBtn'),
        aiLoadingOverlay:          document.getElementById('aiLoadingOverlay'),
        logoutBtn:                 document.getElementById('logoutBtn')
    };

    // ─── Init ───────────────────────────────────────────────────────────────
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
            showToast('Errore durante l\'inizializzazione', 'error');
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
            showToast('Errore di autenticazione', 'error');
            return null;
        }
    }

    async function loadActivities() {
        try {
            const { data, error } = await supabaseClient
                .from('activities')
                .select('*')
                .order('name');
            if (error) throw error;
            workoutActivities = data || [];
        } catch (error) {
            console.error('Error loading activities:', error);
        }
    }

    // ─── Event listeners ─────────────────────────────────────────────────
    function setupEventListeners() {
        elements.generatePlanBtn.addEventListener('click', generatePlan);
        elements.saveWorkoutsBtn.addEventListener('click', showWorkoutPreview);
        elements.regenerateBtn.addEventListener('click', generatePlan);
        elements.newPlanBtn.addEventListener('click', resetForm);
        elements.confirmSaveBtn.addEventListener('click', saveWorkouts);
        elements.cancelSaveBtn.addEventListener('click', cancelPreview);

        elements.logoutBtn.addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signOut();
                if (error) throw error;
                window.location.href = '/';
            } catch (error) {
                console.error('Logout error:', error);
                showToast('Errore durante il logout', 'error');
            }
        });
    }

    // ─── Genera piano via API server ────────────────────────────────────────
    async function generatePlan() {
        const prompt       = elements.aiPrompt.value.trim();
        const planType     = elements.planType.value;
        const fitnessLevel = elements.fitnessLevel.value;

        if (!prompt) {
            showToast('Descrivi il tuo obiettivo per generare un piano', 'warning');
            elements.aiPrompt.focus();
            return;
        }

        elements.aiLoadingOverlay.style.display = 'flex';
        elements.aiResponseContainer.style.display = 'none';

        try {
            const aiText = await callGeneratePlanAPI(prompt, planType, fitnessLevel);

            generatedWorkouts = parseAIResponse(aiText, planType);
            displayAIResponse(aiText);

            elements.aiResponseContainer.style.display = 'block';
            elements.aiResponseContainer.scrollIntoView({ behavior: 'smooth' });
        } catch (error) {
            console.error('Error generating plan:', error);
            showToast('Errore nella generazione del piano: ' + error.message, 'error');
        } finally {
            elements.aiLoadingOverlay.style.display = 'none';
        }
    }

    /**
     * Chiama il backend Express che a sua volta chiama OpenAI.
     * La chiave API non viene mai esposta al browser.
     */
    async function callGeneratePlanAPI(prompt, planType, fitnessLevel) {
        const response = await fetch('/api/generate-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, planType, fitnessLevel })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Errore HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.text) throw new Error('Risposta vuota dal server.');
        return data.text;
    }

    // ─── Parsing risposta Markdown ───────────────────────────────────────────
    function parseAIResponse(response, planType) {
        const workouts = [];

        const dayMatches = [...response.matchAll(/### Giorno (\d+): ([^\n]+)/g)];

        for (const match of dayMatches) {
            const dayNumber   = parseInt(match[1]);
            const workoutName = match[2].trim();

            // Calcola data di partenza
            const startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() + dayNumber - 1);

            // Individua l'attività più appropriata
            const activityId = resolveActivityId(workoutName);

            // Estrai le sezioni del giorno
            const dayContent  = extractDayContent(response, dayNumber);
            const warmup      = extractSection(dayContent, 'Riscaldamento');
            const mainPhase   = extractSection(dayContent, 'Fase Principale');
            const cooldown    = extractSection(dayContent, 'Defaticamento');
            const notes       = extractSection(dayContent, 'Note');

            // Salta i puri giorni di riposo senza contenuto
            if (workoutName.toLowerCase().includes('riposo') && !warmup && !mainPhase) continue;

            workouts.push({
                name:           workoutName,
                date:           startDate.toISOString(),
                activity_id:    activityId,
                warmup,
                main_phase:     mainPhase,
                cooldown,
                notes,
                total_duration: 45,
                objective:      `Piano ${planType} generato dall\'AI Trainer`
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
        if (name.includes('forza') || name.includes('peso'))  return find('forza');
        if (name.includes('flessibilit') || name.includes('yoga') || name.includes('stretching')) return find('flessibilit');
        if (name.includes('hiit'))    return find('hiit');
        if (name.includes('nuoto'))   return find('nuoto');
        if (name.includes('riposo'))  return find('recupero');
        return workoutActivities[0]?.id || null;
    }

    // ─── Visualizzazione risposta ────────────────────────────────────────────
    function displayAIResponse(response) {
        const html = response
            .replace(/^# (.+)$/gm,   '<h2>$1</h2>')
            .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^#### (.+)$/gm,'<h5>$1</h5>')
            .replace(/^- (.+)$/gm,   '<li>$1</li>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g,     '<em>$1</em>')
            .replace(/\n{2,}/g, '</p><p>')
            .replace(/\n/g, '<br>');
        elements.aiResponse.innerHTML = `<p>${html}</p>`;
    }

    // ─── Anteprima workout ────────────────────────────────────────────────
    function showWorkoutPreview() {
        if (generatedWorkouts.length === 0) {
            showToast('Nessun allenamento da salvare', 'warning');
            return;
        }

        elements.workoutPreviewContainer.style.display = 'block';
        elements.aiResponseContainer.style.display     = 'none';
        elements.workoutPreviewList.innerHTML           = '';

        generatedWorkouts.forEach((workout, index) => {
            const workoutDate   = new Date(workout.date);
            const formattedDate = workoutDate.toLocaleDateString('it-IT', {
                weekday: 'long', day: 'numeric', month: 'long'
            });

            const activity     = workoutActivities.find(a => a.id === workout.activity_id);
            const activityName = activity ? activity.name : 'Attività non specificata';

            const item = document.createElement('div');
            item.className      = 'workout-preview-item';
            item.dataset.index  = index;

            item.innerHTML = `
                <div class="preview-header">
                    <div class="preview-title">${workout.name}</div>
                    <div class="preview-date">${formattedDate}</div>
                </div>
                <div class="preview-section"><h5>Tipo di Attività</h5><p>${activityName}</p></div>
                <div class="preview-section"><h5>Riscaldamento</h5><p>${workout.warmup || 'Non specificato'}</p></div>
                <div class="preview-section"><h5>Fase Principale</h5><p>${workout.main_phase || 'Non specificata'}</p></div>
                <div class="preview-section"><h5>Defaticamento</h5><p>${workout.cooldown || 'Non specificato'}</p></div>
                ${workout.notes ? `<div class="preview-section"><h5>Note</h5><p>${workout.notes}</p></div>` : ''}
            `;
            elements.workoutPreviewList.appendChild(item);
        });

        elements.workoutPreviewContainer.scrollIntoView({ behavior: 'smooth' });
    }

    // ─── Salvataggio ──────────────────────────────────────────────────────────
    async function saveWorkouts() {
        if (generatedWorkouts.length === 0) {
            showToast('Nessun allenamento da salvare', 'warning');
            return;
        }

        elements.aiLoadingOverlay.style.display = 'flex';

        try {
            const workoutsWithUserId = generatedWorkouts.map(workout => ({
                ...workout,
                user_id:    currentUser.id,
                created_at: new Date().toISOString()
            }));

            const { error } = await supabaseClient
                .from('workout_plans')
                .insert(workoutsWithUserId);

            if (error) throw error;

            showToast('Piano di allenamento salvato con successo!', 'success');
            elements.workoutPreviewContainer.style.display = 'none';
            resetForm();

            setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
        } catch (error) {
            console.error('Error saving workouts:', error);
            showToast('Errore nel salvataggio: ' + error.message, 'error');
        } finally {
            elements.aiLoadingOverlay.style.display = 'none';
        }
    }

    // ─── Helpers UI ──────────────────────────────────────────────────────────
    function cancelPreview() {
        elements.workoutPreviewContainer.style.display = 'none';
        elements.aiResponseContainer.style.display     = 'block';
    }

    function resetForm() {
        elements.aiPrompt.value    = '';
        elements.planType.value    = 'weekly';
        elements.fitnessLevel.value = 'beginner';
        elements.aiResponseContainer.style.display     = 'none';
        elements.workoutPreviewContainer.style.display = 'none';
        generatedWorkouts = [];
        elements.aiPrompt.focus();
    }

    // Avvio
    init();
});
