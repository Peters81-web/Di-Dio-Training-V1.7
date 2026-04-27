/**
 * AI Trainer - DiDio Training App
 */

document.addEventListener('DOMContentLoaded', async function () {
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    let currentUser = null;
    let generatedWorkouts = [];

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
        logoutBtn: document.getElementById('logoutBtn')
    };

    async function init() {
        try {
            const session = await checkAuth();
            if (session) {
                currentUser = session.user;
                setupEventListeners();
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

        if (!prompt) {
            alert('Per favore descrivi il tuo obiettivo di allenamento.');
            return;
        }

        elements.aiLoadingOverlay.style.display = 'flex';
        generatedWorkouts = [];

        try {
            const response = await fetch('/api/generate-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, planType, fitnessLevel })
            });

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
            if (elements.aiResponse) {
                elements.aiResponse.innerHTML = '<div class="error-message">Errore: ' + error.message + '</div>';
            }
            alert('Si \u00e8 verificato un errore durante la generazione del piano. Riprova.');
        } finally {
            elements.aiLoadingOverlay.style.display = 'none';
        }
    }

    function parseAIResponse(text) {
        const workouts = [];
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);

        // Divide il testo su ogni riga che inizia con ### (con eventuale spazio prima)
        // Usa lookahead per preservare il delimitatore
        const dayBlocks = text.split(/(?=^###\s)/m).filter(function(block) {
            return block.trim().startsWith('###');
        });

        console.log('Blocchi giorno trovati:', dayBlocks.length);

        dayBlocks.forEach(function(day) {
            // Estrai il nome del giorno dalla prima riga (es. "### Giorno 1: Corsa")
            const firstLine = day.split('\n')[0].replace(/^#+\s*/, '').trim();

            // Salta i giorni di riposo attivo
            const isRest = /riposo/i.test(firstLine);

            // Estrai le sezioni con regex case-insensitive
            function extractSection(sectionName) {
                const regex = new RegExp('####\\s*' + sectionName + '[^\\n]*\\n([\\s\\S]*?)(?=####|$)', 'i');
                const match = day.match(regex);
                return match ? match[1].trim() : '';
            }

            const warmup    = extractSection('Riscaldamento');
            const mainPhase = extractSection('Fase Principale');
            const cooldown  = extractSection('Defaticamento');
            const notes     = extractSection('Note e Consigli');

            // Salva solo se c\'e\' almeno riscaldamento o fase principale (non i giorni riposo puri)
            if (!isRest && (warmup || mainPhase)) {
                workouts.push({
                    name: firstLine.replace(/^Giorno\s*\d+:\s*/i, '').trim() || firstLine,
                    scheduled_date: new Date(startDate).toISOString().split('T')[0],
                    warmup: warmup,
                    main_phase: mainPhase,
                    cooldown: cooldown,
                    notes: notes,
                    total_duration: 45,
                    objective: "Piano generato dall'AI Trainer"
                });
            }

            // Avanza di un giorno per ogni blocco (riposo incluso)
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
            elements.workoutPreviewList.innerHTML = generatedWorkouts.map(function(w, i) {
                return '<div class="preview-item"><div class="preview-item-header"><span class="preview-item-number">' + (i + 1) + '</span><h4>' + w.name + '</h4></div><div class="preview-item-details"><p><strong>Data:</strong> ' + new Date(w.scheduled_date + 'T12:00:00').toLocaleDateString('it-IT') + '</p>' + (w.warmup ? '<p><strong>Riscaldamento:</strong> ' + w.warmup + '</p>' : '') + (w.main_phase ? '<p><strong>Fase Principale:</strong> ' + w.main_phase + '</p>' : '') + (w.cooldown ? '<p><strong>Defaticamento:</strong> ' + w.cooldown + '</p>' : '') + (w.notes ? '<p><strong>Note:</strong> ' + w.notes + '</p>' : '') + '</div></div>';
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

        var workoutsWithUserId = generatedWorkouts.map(function(workout) {
            return Object.assign({}, workout, { user_id: currentUser.id });
        });

        try {
            var result = await supabaseClient.from('workout_plans').insert(workoutsWithUserId);
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
}());
