/**
 * ===== DASHBOARD.JS - VERSIONE COMPLETA E OTTIMIZZATA =====
 * File: public/js/dashboard.js
 * 
 * Gestisce la dashboard principale dell'applicazione Di Dio Training
 * Include: caricamento allenamenti, statistiche, modal, gestione completa
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('Inizializzazione dashboard...');
    
    // ===== VARIABILI GLOBALI =====
    let currentUser = null;
    let workouts = [];
    let supabaseClient = null;
    
    // ===== ELEMENTI DOM =====
    const elements = {
        workoutList: document.getElementById('workout-list'),
        weeklyStats: document.getElementById('weekly-stats'),
        resetDataBtn: document.getElementById('resetDataBtn'),
        logoutBtn: document.getElementById('logoutBtn'),
        configureDashboardBtn: document.getElementById('configureDashboardBtn'),
        completeWorkoutForm: document.getElementById('completeWorkoutForm')
    };
    
    // ===== INIZIALIZZAZIONE PRINCIPALE =====
    
    /**
     * Funzione principale di inizializzazione
     */
    async function init() {
        try {
            // Inizializzazione Supabase
            supabaseClient = window.supabaseClient || createSupabaseClient();
            if (!supabaseClient) {
                throw new Error('Impossibile inizializzare Supabase');
            }
            
            // Verifica autenticazione
            const session = await checkAuthentication();
            if (!session) return;
            
            currentUser = session.user;
            console.log('Utente autenticato:', currentUser.email);
            
            // Setup della dashboard
            setupEventListeners();
            await loadDashboardData();
            
            console.log('Dashboard inizializzata con successo');
            
        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            showToast('Errore durante l\'inizializzazione della dashboard', 'error');
        }
    }
    
    /**
     * Verifica dell'autenticazione utente
     */
    async function checkAuthentication() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error) {
                console.error('Errore autenticazione:', error);
                window.location.href = '/';
                return null;
            }
            
            if (!session || !session.user) {
                console.log('Nessuna sessione valida, reindirizzamento al login');
                window.location.href = '/';
                return null;
            }
            
            return session;
        } catch (error) {
            console.error('Errore controllo autenticazione:', error);
            window.location.href = '/';
            return null;
        }
    }
    
    // ===== CARICAMENTO DATI =====
    
    /**
     * Carica tutti i dati della dashboard
     */
    async function loadDashboardData() {
        try {
            showLoading();
            
            // Carica dati in parallelo per migliori performance
            await Promise.all([
                loadWorkouts(),
                loadWeeklyStats()
            ]);
            
        } catch (error) {
            console.error('Errore nel caricamento dati dashboard:', error);
            showToast('Errore nel caricamento dei dati', 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * Carica gli allenamenti dell'utente
     */
    async function loadWorkouts() {
        try {
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .select(`
                    *,
                    activities (id, name, icon)
                `)
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            
            workouts = data || [];
            displayWorkouts(workouts);
            
            console.log(`Caricati ${workouts.length} allenamenti`);
            
        } catch (error) {
            console.error('Errore caricamento allenamenti:', error);
            showToast('Errore nel caricamento degli allenamenti', 'error');
            workouts = [];
            displayWorkouts([]);
        }
    }
    
    /**
     * Carica le statistiche settimanali
     */
    async function loadWeeklyStats() {
        try {
            if (!elements.weeklyStats) return;
            
            // Calcola intervallo settimana corrente
            const today = new Date();
            const firstDayOfWeek = new Date(today);
            const day = today.getDay() || 7; // Domenica = 7
            firstDayOfWeek.setDate(today.getDate() - day + 1); // Lunedì
            firstDayOfWeek.setHours(0, 0, 0, 0);
            
            const lastDayOfWeek = new Date(firstDayOfWeek);
            lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6); // Domenica
            lastDayOfWeek.setHours(23, 59, 59, 999);
            
            // Carica allenamenti completati questa settimana
            const { data: completedWorkouts, error } = await supabaseClient
                .from('completed_workouts')
                .select(`
                    *,
                    workout_plans (
                        name,
                        activities (name)
                    )
                `)
                .eq('user_id', currentUser.id)
                .gte('completed_at', firstDayOfWeek.toISOString())
                .lte('completed_at', lastDayOfWeek.toISOString())
                .order('completed_at', { ascending: false });
                
            if (error) throw error;
            
            displayWeeklyStats(completedWorkouts || []);
            
        } catch (error) {
            console.error('Errore caricamento statistiche settimanali:', error);
            elements.weeklyStats.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Errore nel caricamento delle statistiche</span>
                </div>
            `;
        }
    }
    
    // ===== VISUALIZZAZIONE DATI =====
    
    /**
     * Visualizza gli allenamenti nella dashboard
     */
    function displayWorkouts(workoutsData) {
        if (!elements.workoutList) return;
        
        elements.workoutList.innerHTML = '';
        
        if (workoutsData.length === 0) {
            elements.workoutList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i class="fas fa-dumbbell"></i>
                    </div>
                    <h3>Nessun allenamento trovato</h3>
                    <p>Inizia creando il tuo primo allenamento personalizzato</p>
                    <a href="/workout" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Crea il tuo primo allenamento
                    </a>
                </div>
            `;
            return;
        }
        
        // Crea le card degli allenamenti
        workoutsData.forEach((workout, index) => {
            const iconClass = getActivityIcon(workout.activity_id);
            
            const card = document.createElement('div');
            card.className = 'card workout-card';
            card.dataset.id = workout.id;
            card.style.animationDelay = `${index * 0.1}s`;
            
            card.innerHTML = `
                <div class="workout-header">
                    <h3 class="workout-title">${escapeHtml(workout.name || 'Allenamento')}</h3>
                    <div class="workout-icon">
                        <i class="fas ${iconClass}"></i>
                    </div>
                </div>
                
                <div class="workout-details">
                    <div class="detail-row">
                        <span class="detail-label">Durata:</span>
                        <span class="detail-value">${formatDuration(workout.total_duration)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Difficoltà:</span>
                        <span class="detail-value">${escapeHtml(workout.difficulty || 'Non specificata')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Obiettivo:</span>
                        <span class="detail-value">${escapeHtml(workout.objective || 'Non specificato')}</span>
                    </div>
                </div>
                
                <div class="workout-actions">
                    <button class="btn btn-primary view-btn" onclick="viewWorkout('${workout.id}')">
                        <i class="fas fa-eye"></i>
                        <span>Visualizza</span>
                    </button>
                    <button class="btn btn-secondary edit-btn" onclick="editWorkout('${workout.id}')">
                        <i class="fas fa-edit"></i>
                        <span>Modifica</span>
                    </button>
                    <button class="btn btn-danger delete-btn" onclick="confirmDeleteWorkout('${workout.id}')">
                        <i class="fas fa-trash"></i>
                        <span>Elimina</span>
                    </button>
                    <button class="btn btn-success complete-btn" onclick="completeWorkout('${workout.id}')">
                        <i class="fas fa-check"></i>
                        <span>Completa</span>
                    </button>
                </div>
            `;
            
            elements.workoutList.appendChild(card);
        });
    }
    
    /**
     * Visualizza le statistiche settimanali
     */
    function displayWeeklyStats(completedWorkouts) {
        if (!elements.weeklyStats) return;
        
        const totalWorkouts = completedWorkouts.length;
        const totalTime = completedWorkouts.reduce((sum, w) => sum + (w.actual_duration || 0), 0);
        const totalCalories = completedWorkouts.reduce((sum, w) => sum + (w.calories_burned || 0), 0);
        const totalDistance = completedWorkouts.reduce((sum, w) => sum + (w.distance || 0), 0);
        
        elements.weeklyStats.innerHTML = `
            <div class="weekly-stats-grid">
                <div class="stat-card">
                    <div class="stat-icon workout-icon">
                        <i class="fas fa-dumbbell"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${totalWorkouts}</div>
                        <div class="stat-label">Allenamenti</div>
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon time-icon">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${formatDuration(totalTime)}</div>
                        <div class="stat-label">Tempo Totale</div>
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon calories-icon">
                        <i class="fas fa-fire"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${totalCalories}</div>
                        <div class="stat-label">Calorie</div>
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon distance-icon">
                        <i class="fas fa-route"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${totalDistance.toFixed(1)} km</div>
                        <div class="stat-label">Distanza</div>
                    </div>
                </div>
            </div>
            
            ${totalWorkouts === 0 ? `
                <div class="weekly-info">
                    <i class="fas fa-info-circle"></i>
                    <span>Non hai ancora completato allenamenti questa settimana</span>
                </div>
            ` : ''}
            
            <div class="weekly-actions">
                <a href="/weekly_summary" class="btn btn-primary">
                    <i class="fas fa-calendar-alt"></i>
                    <span>Pianifica Settimana</span>
                </a>
                <a href="/stats" class="btn btn-outline">
                    <i class="fas fa-chart-line"></i>
                    <span>Vedi Statistiche</span>
                </a>
            </div>
        `;
    }
    
    // ===== GESTIONE ALLENAMENTI =====
    
    /**
     * Visualizza i dettagli di un allenamento in modal
     */
    window.viewWorkout = async function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Rimuovi modal esistenti per evitare conflitti
        removeExistingModal('workoutDetailsModal');
        
        // Determina l'icona dell'attività
        const iconClass = getActivityIcon(workout.activity_id);
        
        // Crea il modal
        const modal = createWorkoutDetailsModal(workout, iconClass);
        
        // Aggiungi al DOM
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Setup event listeners per la chiusura
        setupModalCloseListeners(modal);
        
        console.log('Modal dettagli allenamento aperto');
    };
    
    /**
     * Crea il modal per i dettagli dell'allenamento
     */
    function createWorkoutDetailsModal(workout, iconClass) {
        const modal = document.createElement('div');
        modal.id = 'workoutDetailsModal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h2 style="display: flex; align-items: center; gap: 0.75rem;">
                        <i class="fas ${iconClass}" style="color: var(--primary-color);"></i>
                        ${escapeHtml(workout.name)}
                    </h2>
                    <button class="modal-close" id="closeDetailsModalBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="workout-details-content">
                    ${createWorkoutDetailsContent(workout)}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="closeDetailsModalBtnFooter">
                        <i class="fas fa-times"></i> Chiudi
                    </button>
                    <button class="btn btn-primary" onclick="editWorkout('${workout.id}')">
                        <i class="fas fa-edit"></i> Modifica
                    </button>
                    <button class="btn btn-success" onclick="completeWorkout('${workout.id}')">
                        <i class="fas fa-check"></i> Completa
                    </button>
                </div>
            </div>
        `;
        
        return modal;
    }
    
    /**
     * Crea il contenuto dei dettagli dell'allenamento
     */
    function createWorkoutDetailsContent(workout) {
        const detailsGrid = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-clock"></i>
                        <span>Durata</span>
                    </div>
                    <div class="detail-value">${formatDuration(workout.total_duration)}</div>
                </div>
                
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-signal"></i>
                        <span>Difficoltà</span>
                    </div>
                    <div class="detail-value">${escapeHtml(workout.difficulty || 'Non specificata')}</div>
                </div>
                
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-bullseye"></i>
                        <span>Obiettivo</span>
                    </div>
                    <div class="detail-value">${escapeHtml(workout.objective || 'Non specificato')}</div>
                </div>
            </div>
        `;
        
        const phases = createWorkoutPhasesContent(workout);
        
        return detailsGrid + phases;
    }
    
    /**
     * Crea il contenuto delle fasi dell'allenamento
     */
    function createWorkoutPhasesContent(workout) {
        const phases = [];
        
        if (workout.warmup) {
            phases.push({
                title: 'Riscaldamento',
                icon: 'fa-play-circle',
                content: workout.warmup
            });
        }
        
        if (workout.main_phase) {
            phases.push({
                title: 'Fase Principale',
                icon: 'fa-dumbbell',
                content: workout.main_phase
            });
        }
        
        if (workout.cooldown) {
            phases.push({
                title: 'Defaticamento',
                icon: 'fa-snowflake',
                content: workout.cooldown
            });
        }
        
        if (workout.notes) {
            phases.push({
                title: 'Note',
                icon: 'fa-sticky-note',
                content: workout.notes
            });
        }
        
        if (phases.length === 0) {
            return `
                <div class="no-details">
                    <i class="fas fa-info-circle"></i>
                    <p>Nessun dettaglio aggiuntivo disponibile per questo allenamento.</p>
                </div>
            `;
        }
        
        return `
            <div class="workout-phases">
                ${phases.map(phase => `
                    <div class="phase-section">
                        <h4 class="phase-title">
                            <i class="fas ${phase.icon}"></i>
                            ${phase.title}
                        </h4>
                        <div class="phase-content">
                            ${phase.content}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    /**
     * Setup listeners per chiudere il modal
     */
    function setupModalCloseListeners(modal) {
        // Funzione di chiusura centralizzata
        function closeModal() {
            modal.remove();
            document.body.style.overflow = '';
            console.log('Modal chiuso');
        }
        
        // Pulsante X header
        const closeBtn = modal.querySelector('#closeDetailsModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        
        // Pulsante Chiudi footer
        const closeBtnFooter = modal.querySelector('#closeDetailsModalBtnFooter');
        if (closeBtnFooter) {
            closeBtnFooter.addEventListener('click', closeModal);
        }
        
        // Click fuori dal modal
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Tasto ESC
        function handleEscKey(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        }
        
        document.addEventListener('keydown', handleEscKey);
    }
    
    /**
     * Modifica un allenamento
     */
    window.editWorkout = function(workoutId) {
        window.location.href = `/workout?id=${workoutId}`;
    };
    
    /**
     * Conferma eliminazione allenamento
     */
    window.confirmDeleteWorkout = async function(workoutId) {
        if (confirm('Sei sicuro di voler eliminare questo allenamento?')) {
            await deleteWorkout(workoutId);
        }
    };
    
    /**
     * Elimina un allenamento
     */
    async function deleteWorkout(workoutId) {
        try {
            showLoading();
            
            const { error } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('id', workoutId)
                .eq('user_id', currentUser.id);
                
            if (error) throw error;
            
            // Rimuovi dall'array locale e aggiorna UI
            workouts = workouts.filter(w => w.id !== workoutId);
            displayWorkouts(workouts);
            
            showToast('Allenamento eliminato con successo', 'success');
            
        } catch (error) {
            console.error('Errore eliminazione allenamento:', error);
            showToast('Errore nell\'eliminazione dell\'allenamento', 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * Inizia il completamento di un allenamento
     */
    window.completeWorkout = function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Prepopola il form
        document.getElementById('completeWorkoutId').value = workoutId;
        
        const now = new Date();
        const localDatetime = new Date(now - now.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16);
        document.getElementById('completedDate').value = localDatetime;
        document.getElementById('actualDuration').value = workout.total_duration || '';
        
        // Apri modal
        openModal('completeWorkoutModal');
    };
    
    /**
     * Gestisce il submit del form di completamento
     */
    async function handleCompleteWorkoutSubmit(e) {
        e.preventDefault();
        
        try {
            showLoading();
            
            const formData = getCompleteWorkoutFormData();
            
            if (!validateCompleteWorkoutForm(formData)) {
                throw new Error('Compila tutti i campi obbligatori');
            }
            
            const completedWorkoutData = {
                user_id: currentUser.id,
                workout_id: formData.workoutId,
                completed_at: new Date(formData.completedDate).toISOString(),
                actual_duration: formData.actualDuration,
                perceived_difficulty: formData.perceivedDifficulty,
                distance: formData.distance,
                calories_burned: formData.caloriesBurned,
                heart_rate_avg: formData.heartRateAvg,
                notes: formData.notes,
                rating: formData.rating
            };
            
            const { error } = await supabaseClient
                .from('completed_workouts')
                .insert([completedWorkoutData]);
                
            if (error) throw error;
            
            closeModal('completeWorkoutModal');
            showToast('Allenamento completato con successo!', 'success');
            
            // Ricarica statistiche settimanali
            await loadWeeklyStats();
            
            // Chiedi se vuole vedere le statistiche
            if (confirm('Vuoi vedere le statistiche dei tuoi allenamenti?')) {
                window.location.href = '/stats';
            }
            
        } catch (error) {
            console.error('Errore completamento allenamento:', error);
            showToast('Errore: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * Ottiene i dati dal form di completamento
     */
    function getCompleteWorkoutFormData() {
        return {
            workoutId: document.getElementById('completeWorkoutId').value,
            completedDate: document.getElementById('completedDate').value,
            actualDuration: parseInt(document.getElementById('actualDuration').value),
            perceivedDifficulty: document.getElementById('perceivedDifficulty').value,
            distance: parseFloat(document.getElementById('distance').value || 0),
            caloriesBurned: parseInt(document.getElementById('caloriesBurned').value || 0),
            heartRateAvg: parseInt(document.getElementById('heartRateAvg').value || 0),
            notes: document.getElementById('workoutNotes').value.trim(),
            rating: parseInt(document.querySelector('input[name="rating"]:checked')?.value || 3)
        };
    }
    
    /**
     * Valida i dati del form di completamento
     */
    function validateCompleteWorkoutForm(data) {
        return data.workoutId && 
               data.completedDate && 
               data.actualDuration && 
               data.actualDuration > 0;
    }
    
    // ===== GESTIONE RESET DATI =====
    
    /**
     * Reset completo dei dati utente
     */
    async function resetUserData() {
        try {
            showLoading();
            
            // Elimina tutti i dati dell'utente
            const deleteTasks = [
                supabaseClient.from('workout_plans').delete().eq('user_id', currentUser.id),
                supabaseClient.from('completed_workouts').delete().eq('user_id', currentUser.id),
                supabaseClient.from('weekly_summaries').delete().eq('user_id', currentUser.id),
                supabaseClient.from('body_measurements').delete().eq('user_id', currentUser.id)
            ];
            
            await Promise.all(deleteTasks);
            
            // Reset variabili locali
            workouts = [];
            
            // Aggiorna UI
            displayWorkouts([]);
            displayWeeklyStats([]);
            
            showToast('Tutti i dati sono stati eliminati con successo', 'success');
            
        } catch (error) {
            console.error('Errore durante l\'eliminazione dei dati:', error);
            showToast('Errore durante l\'eliminazione dei dati', 'error');
        } finally {
            hideLoading();
            closeModal('confirmModal');
        }
    }
    
    // ===== EVENT LISTENERS =====
    
    /**
     * Setup di tutti gli event listeners
     */
    function setupEventListeners() {
        // Menu mobile
        setupMobileMenu();
        
        // Pulsante reset dati
        if (elements.resetDataBtn) {
            elements.resetDataBtn.addEventListener('click', () => {
                openModal('confirmModal');
            });
        }
        
        // Conferma reset
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', resetUserData);
        }
        
        // Annulla reset
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                closeModal('confirmModal');
            });
        }
        
        // Form completamento allenamento
        if (elements.completeWorkoutForm) {
            elements.completeWorkoutForm.addEventListener('submit', handleCompleteWorkoutSubmit);
        }
        
        // Configurazione dashboard
        if (elements.configureDashboardBtn) {
            elements.configureDashboardBtn.addEventListener('click', () => {
                openModal('dashboardConfigModal');
            });
        }
        
        // Logout
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', logout);
        }
    }
    
    /**
     * Setup menu mobile
     */
    function setupMobileMenu() {
        const mobileMenuToggle = document.getElementById('mobileMenuToggle');
        const navLinks = document.getElementById('navLinks');
        
        if (mobileMenuToggle && navLinks) {
            mobileMenuToggle.addEventListener('click', function() {
                navLinks.classList.toggle('active');
                
                const icon = this.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-bars');
                    icon.classList.toggle('fa-times');
                }
            });
            
            // Chiudi menu quando si clicca su un link
            navLinks.querySelectorAll('a, button').forEach(item => {
                item.addEventListener('click', () => {
                    navLinks.classList.remove('active');
                    const icon = mobileMenuToggle.querySelector('i');
                    if (icon) {
                        icon.classList.add('fa-bars');
                        icon.classList.remove('fa-times');
                    }
                });
            });
        }
    }
    
    // ===== FUNZIONI UTILITY =====
    
    /**
     * Logout utente
     */
    async function logout() {
        try {
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw error;
            window.location.href = '/';
        } catch (error) {
            console.error('Errore logout:', error);
            showToast('Errore durante il logout', 'error');
        }
    }
    
    /**
     * Ottiene l'icona per un'attività
     */
    function getActivityIcon(activityId) {
        const iconMap = {
            '1': 'fa-running',      // Corsa
            '2': 'fa-bicycle',      // Ciclismo
            '3': 'fa-swimmer',      // Nuoto
            '4': 'fa-dumbbell',     // Forza
            '5': 'fa-om',           // Yoga
        };
        
        // Se è UUID, convertilo
        if (typeof activityId === 'string' && activityId.includes('-')) {
            const uuidMap = {
                'af12a17d-cca9-4cd3-a4f8-029d1208525f': '1', // Corsa
                '2ba50271-cd8c-4b87-8fd2-8c6d15af9078': '2', // Ciclismo
                '57c626f0-43fe-42bf-b306-67554c4eabaa': '3', // Nuoto
                '8e7e2208-4590-44a7-a317-499323f371c4': '4', // Forza
                '8deb591f-d67c-4e63-ad48-beb755814068': '5'  // Yoga
            };
            
            const numericId = uuidMap[activityId];
            return iconMap[numericId] || 'fa-dumbbell';
        }
        
        return iconMap[activityId] || 'fa-dumbbell';
    }
    
    /**
     * Formatta la durata in formato leggibile
     */
    function formatDuration(minutes) {
        if (!minutes || minutes === 0) return '0 min';
        
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
        } else {
            return `${minutes}m`;
        }
    }
    
    /**
     * Escape HTML per prevenire XSS
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Rimuove modal esistenti per evitare conflitti
     */
    function removeExistingModal(modalId) {
        const existingModal = document.getElementById(modalId);
        if (existingModal) {
            existingModal.remove();
        }
    }
    
    /**
     * Mostra loading spinner
     */
    function showLoading() {
        // Implementazione semplice - potresti sostituire con una libreria
        const loading = document.createElement('div');
        loading.id = 'loadingSpinner';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Caricamento...</span>
            </div>
        `;
        document.body.appendChild(loading);
        return loading;
    }
    
    /**
     * Nasconde loading spinner
     */
    function hideLoading() {
        const loading = document.getElementById('loadingSpinner');
        if (loading) {
            loading.remove();
        }
    }
    
    /**
     * Mostra toast notification
     */
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas ${iconMap[type] || iconMap.info}"></i>
            <span>${escapeHtml(message)}</span>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove dopo 5 secondi
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
        
        return toast;
    }
    
    /**
     * Apre un modal
     */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } else {
            console.error(`Modal con ID '${modalId}' non trovato`);
        }
    }
    
    /**
     * Chiude un modal
     */
    function closeModal(modalId) {
        let modal;
        
        if (typeof modalId === 'string') {
            modal = document.getElementById(modalId);
        } else if (modalId && modalId.nodeType === Node.ELEMENT_NODE) {
            modal = modalId;
        }
        
        if (modal) {
            // Se è un modal dinamico, rimuovilo completamente
            if (modal.id === 'workoutDetailsModal') {
                modal.remove();
            } else {
                // Altrimenti nascondilo solamente
                modal.style.display = 'none';
            }
            
            // Ripristina scroll del body
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Crea il client Supabase (fallback)
     */
    function createSupabaseClient() {
        try {
            if (window.supabase && typeof window.supabase.createClient === 'function') {
                const SUPABASE_URL = 'https://mzcrogljyijgyzcxczcr.supabase.co';
                const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16Y3JvZ2xqeWlqZ3l6Y3hjemNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2NTg4NzQsImV4cCI6MjA1NTIzNDg3NH0.NRvCsTtpEZ6HSMkEwsGc9IrnOVqwtfoVNS7CTKPCB5A';
                
                return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            }
            throw new Error('Supabase non disponibile');
        } catch (error) {
            console.error('Errore nella creazione del client Supabase:', error);
            return null;
        }
    }
    
    // ===== GESTIONE PREFERENZE DASHBOARD =====
    
    /**
     * Salva le preferenze della dashboard
     */
    window.saveDashboardPreferences = async function() {
        try {
            const widgets = ['weeklyStats', 'caloriesChart', 'durationChart', 'goalProgress', 'recentWorkouts'];
            const preferences = {
                visible_widgets: {}
            };
            
            widgets.forEach(widget => {
                const checkbox = document.getElementById(`show${widget.charAt(0).toUpperCase() + widget.slice(1)}`);
                if (checkbox) {
                    preferences.visible_widgets[widget] = checkbox.checked;
                }
            });
            
            // Salva le preferenze (opzionale: salvare in Supabase)
            localStorage.setItem('dashboardPreferences', JSON.stringify(preferences));
            
            closeModal('dashboardConfigModal');
            showToast('Preferenze salvate con successo', 'success');
            
        } catch (error) {
            console.error('Errore nel salvataggio delle preferenze:', error);
            showToast('Errore nel salvataggio delle preferenze', 'error');
        }
    };
    
    // ===== GESTIONE GLOBALE EVENTI =====
    
    // Listener globale per chiudere modal con ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Chiudi tutti i modal visibili
            const visibleModals = document.querySelectorAll('.modal[style*="flex"]');
            visibleModals.forEach(modal => {
                closeModal(modal);
            });
        }
    });
    
    // Listener globale per chiudere modal cliccando fuori
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });
    
    // ===== ESPONI FUNZIONI GLOBALI =====
    
    // Esponi le funzioni che devono essere accessibili dall'HTML
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.formatDuration = formatDuration;
    
    // ===== AVVIA INIZIALIZZAZIONE =====
    
    // Avvia l'inizializzazione della dashboard
    init();
    
}); 