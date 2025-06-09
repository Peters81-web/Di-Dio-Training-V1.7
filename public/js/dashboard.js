/**
 * dashboard.js - VERSIONE SEMPLIFICATA
 * Utilizza app-core.js per le funzioni comuni
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('Inizializzazione dashboard...');
    
    // Variabili globali
    let currentUser = null;
    let workouts = [];
    
    /**
     * Inizializzazione applicazione
     */
    async function init() {
        try {
            // Usa la funzione centralizzata per l'autenticazione
            const session = await window.AppCore.checkAuth();
            if (!session) return;
            
            currentUser = session.user;
            console.log('Utente autenticato:', currentUser.email);
            
            // Carica i dati della dashboard
            setupEventListeners();
            await loadWorkouts();
            await loadWeeklyStats();
            
        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            window.AppCore.showToast('Errore durante l\'inizializzazione', 'error');
        }
    }
    
    /**
     * Carica gli allenamenti dell'utente
     */
    async function loadWorkouts() {
        const loading = window.AppCore.showLoading();
        
        try {
            const supabaseClient = window.supabaseClient;
            
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .select(`
                    *,
                    activities (id, name)
                `)
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            
            workouts = data || [];
            displayWorkouts(workouts);
            
            console.log(`Caricati ${workouts.length} allenamenti`);
        } catch (error) {
            console.error('Errore durante il caricamento degli allenamenti:', error);
            window.AppCore.showToast('Errore nel caricamento degli allenamenti', 'error');
        } finally {
            window.AppCore.hideLoading(loading);
        }
    }
    
    /**
     * Carica le statistiche settimanali
     */
    async function loadWeeklyStats() {
        try {
            const weeklyStatsContainer = document.getElementById('weekly-stats');
            if (!weeklyStatsContainer || !currentUser) return;
            
            const supabaseClient = window.supabaseClient;
            
            // Calcola l'intervallo della settimana corrente
            const today = new Date();
            const firstDayOfWeek = new Date(today);
            const day = today.getDay() || 7;
            firstDayOfWeek.setDate(today.getDate() - day + 1);
            firstDayOfWeek.setHours(0, 0, 0, 0);
            
            const lastDayOfWeek = new Date(firstDayOfWeek);
            lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
            lastDayOfWeek.setHours(23, 59, 59, 999);
            
            // Ottieni gli allenamenti completati
            const { data: completedWorkouts, error: completedError } = await supabaseClient
                .from('completed_workouts')
                .select('*')
                .eq('user_id', currentUser.id)
                .gte('completed_at', firstDayOfWeek.toISOString())
                .lte('completed_at', lastDayOfWeek.toISOString());
                
            if (completedError) throw completedError;
            
            // Ottieni i riepiloghi settimanali
            const { data: weeklySummaries, error: summariesError } = await supabaseClient
                .from('weekly_summaries')
                .select('*')
                .eq('user_id', currentUser.id)
                .gte('date', firstDayOfWeek.toISOString())
                .lte('date', lastDayOfWeek.toISOString());
                
            if (summariesError) throw summariesError;
            
            // Calcola le statistiche
            const totalCompleted = completedWorkouts ? completedWorkouts.length : 0;
            const totalPlanned = weeklySummaries ? weeklySummaries.filter(s => s.workout_type).length : 0;
            
            // Gestisci il caso in cui non ci sono allenamenti pianificati
            let completionText = '';
            let completionPercentage = 0;
            
            if (totalPlanned === 0) {
                if (totalCompleted > 0) {
                    completionText = `${totalCompleted} completati`;
                    completionPercentage = 100; // Se hai completato allenamenti senza pianificarli, sei al 100%!
                } else {
                    completionText = 'Nessuno';
                    completionPercentage = 0;
                }
            } else {
                completionText = `${totalCompleted}/${totalPlanned}`;
                completionPercentage = Math.round((totalCompleted / totalPlanned) * 100);
            }
            
            let totalDuration = 0;
            let totalCalories = 0;
            let totalDistance = 0;
            
            if (completedWorkouts && completedWorkouts.length > 0) {
                totalDuration = completedWorkouts.reduce((sum, workout) => sum + (workout.actual_duration || 0), 0);
                totalCalories = completedWorkouts.reduce((sum, workout) => sum + (workout.calories_burned || 0), 0);
                totalDistance = completedWorkouts.reduce((sum, workout) => sum + (workout.distance || 0), 0);
            }
            
            // Aggiorna l'interfaccia con un design migliorato
            weeklyStatsContainer.innerHTML = `
                <div style="text-align: center; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--primary-color); margin-bottom: 0.5rem;">
                        <i class="fas fa-calendar-week"></i> Riepilogo Settimana Corrente
                    </h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">
                        ${firstDayOfWeek.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} - 
                        ${lastDayOfWeek.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                        <div class="stat-icon" style="background: rgba(255,255,255,0.2);">
                            <i class="fas fa-trophy" style="color: white;"></i>
                        </div>
                        <div class="stat-value" style="color: white;">${totalCompleted}</div>
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Allenamenti Completati</div>
                    </div>
                    
                    <div class="stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                        <div class="stat-icon" style="background: rgba(255,255,255,0.2);">
                            <i class="fas fa-clock" style="color: white;"></i>
                        </div>
                        <div class="stat-value" style="color: white;">${window.AppCore.formatDuration(totalDuration)}</div>
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Tempo Totale</div>
                    </div>
                    
                    <div class="stat-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                        <div class="stat-icon" style="background: rgba(255,255,255,0.2);">
                            <i class="fas fa-fire" style="color: white;"></i>
                        </div>
                        <div class="stat-value" style="color: white;">${totalCalories}</div>
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Calorie Bruciate</div>
                    </div>
                    
                    <div class="stat-card" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                        <div class="stat-icon" style="background: rgba(255,255,255,0.2);">
                            <i class="fas fa-route" style="color: white;"></i>
                        </div>
                        <div class="stat-value" style="color: white;">${totalDistance.toFixed(1)} km</div>
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Distanza Totale</div>
                    </div>
                </div>
                
                ${totalPlanned === 0 && totalCompleted === 0 ? `
                <div style="background: #fff3cd; border: 1px solid #ffeeba; border-radius: 8px; padding: 1rem; margin-top: 1.5rem; text-align: center;">
                    <i class="fas fa-info-circle" style="color: #856404; margin-right: 0.5rem;"></i>
                    <span style="color: #856404;">Non hai ancora pianificato o completato allenamenti questa settimana</span>
                </div>
                ` : ''}
                
                <div class="text-center mt-4">
                    <a href="/weekly_summary" class="btn btn-primary" style="margin-right: 0.5rem;">
                        <i class="fas fa-calendar-alt"></i> Pianifica Settimana
                    </a>
                    <a href="/stats" class="btn btn-outline">
                        <i class="fas fa-chart-line"></i> Vedi Statistiche
                    </a>
                </div>
            `;
            
        } catch (error) {
            console.error('Errore durante il caricamento delle statistiche settimanali:', error);
            const weeklyStatsContainer = document.getElementById('weekly-stats');
            if (weeklyStatsContainer) {
                weeklyStatsContainer.innerHTML = `
                    <div class="text-center py-3">
                        <p class="text-danger">Errore nel caricamento delle statistiche</p>
                        <small>${error.message}</small>
                    </div>
                `;
            }
        }
    }
    
    /**
     * Visualizza gli allenamenti nella dashboard
     */
    function displayWorkouts(workouts) {
        const container = document.getElementById('workout-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (workouts.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-dumbbell fs-xxl mb-3 text-secondary"></i>
                    <h3>Nessun allenamento trovato</h3>
                    <p class="text-secondary mb-4">Inizia creando il tuo primo allenamento</p>
                    <a href="/workout" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Crea Allenamento
                    </a>
                </div>
            `;
            return;
        }
        
        workouts.forEach((workout, index) => {
            const iconClass = window.AppCore.getActivityIcon(workout.activity_id);
            
            const card = document.createElement('div');
            card.className = 'card workout-card';
            card.dataset.id = workout.id;
            card.style.animationDelay = `${index * 0.1}s`;
            
            card.innerHTML = `
                <div class="workout-header">
                    <h3 class="workout-title">${workout.name || 'Allenamento'}</h3>
                    <div class="workout-icon">
                        <i class="fas ${iconClass}"></i>
                    </div>
                </div>
                <div class="workout-details">
                    <p><strong>Durata:</strong> ${window.AppCore.formatDuration(workout.total_duration)}</p>
                    <p><strong>Difficoltà:</strong> ${workout.difficulty || 'Non specificata'}</p>
                    <p><strong>Obiettivo:</strong> ${workout.objective || 'Non specificato'}</p>
                </div>
                <div class="workout-actions">
                    <button class="btn btn-primary view-btn" onclick="viewWorkout('${workout.id}')">
                        <i class="fas fa-eye"></i> Visualizza
                    </button>
                    <button class="btn btn-edit edit-btn" onclick="editWorkout('${workout.id}')">
                        <i class="fas fa-edit"></i> Modifica
                    </button>
                    <button class="btn btn-danger delete-btn" onclick="confirmDeleteWorkout('${workout.id}')">
                        <i class="fas fa-trash"></i> Elimina
                    </button>
                    <button class="btn btn-success complete-btn" onclick="completeWorkout('${workout.id}')">
                        <i class="fas fa-check"></i> Completa
                    </button>
                </div>
            `;
            
            container.appendChild(card);
        });
    }
    
    /**
     * Gestione allenamenti
     */
    window.viewWorkout = async function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        
        if (!workout) {
            window.AppCore.showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Determina l'icona
        const iconClass = window.AppCore.getActivityIcon(workout.activity_id);
        
        // Crea la modal per i dettagli
        const detailsModal = document.createElement('div');
        detailsModal.id = 'workoutDetailsModal';
        detailsModal.className = 'modal';
        detailsModal.style.display = 'flex';
        
        detailsModal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h2 style="display: flex; align-items: center; gap: 0.75rem;">
                        <i class="fas ${iconClass}" style="color: var(--primary-color);"></i>
                        ${workout.name}
                    </h2>
                    <button class="modal-close" id="closeDetailsModalBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="workout-details-content" style="padding: 1.5rem 0;">
                    <div class="detail-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                        <div class="detail-item" style="background: var(--primary-light); padding: 1rem; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                <i class="fas fa-clock" style="color: var(--primary-color); flex-shrink: 0;"></i>
                                <strong style="white-space: nowrap;">Durata</strong>
                            </div>
                            <div style="font-size: 1.25rem; color: var(--primary-color); font-weight: 600; padding-left: 1.75rem;">
                                ${window.AppCore.formatDuration(workout.total_duration)}
                            </div>
                        </div>
                        
                        <div class="detail-item" style="background: var(--primary-light); padding: 1rem; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                <i class="fas fa-layer-group" style="color: var(--primary-color); flex-shrink: 0;"></i>
                                <strong style="white-space: nowrap;">Difficoltà</strong>
                            </div>
                            <div style="font-size: 1.25rem; color: var(--primary-color); font-weight: 600; padding-left: 1.75rem;">
                                ${workout.difficulty || 'Non specificata'}
                            </div>
                        </div>
                        
                        <div class="detail-item" style="background: var(--primary-light); padding: 1rem; border-radius: 8px; grid-column: 1 / -1;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                <i class="fas fa-bullseye" style="color: var(--primary-color); flex-shrink: 0;"></i>
                                <strong style="white-space: nowrap;">Obiettivo</strong>
                            </div>
                            <div style="font-size: 1rem; color: var(--text-primary); padding-left: 1.75rem;">
                                ${workout.objective || 'Non specificato'}
                            </div>
                        </div>
                    </div>
                    
                    ${workout.warmup ? `
                    <div class="phase-section" style="margin-bottom: 1.5rem;">
                        <h3 style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary-color); margin-bottom: 1rem;">
                            <i class="fas fa-fire-flame-simple"></i> Riscaldamento
                        </h3>
                        <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; line-height: 1.6;">
                            ${workout.warmup}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${workout.main_phase ? `
                    <div class="phase-section" style="margin-bottom: 1.5rem;">
                        <h3 style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary-color); margin-bottom: 1rem;">
                            <i class="fas fa-dumbbell"></i> Fase Principale
                        </h3>
                        <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; line-height: 1.6;">
                            ${workout.main_phase}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${workout.cooldown ? `
                    <div class="phase-section" style="margin-bottom: 1.5rem;">
                        <h3 style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary-color); margin-bottom: 1rem;">
                            <i class="fas fa-wind"></i> Defaticamento
                        </h3>
                        <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; line-height: 1.6;">
                            ${workout.cooldown}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${workout.notes ? `
                    <div class="phase-section">
                        <h3 style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary-color); margin-bottom: 1rem;">
                            <i class="fas fa-note-sticky"></i> Note
                        </h3>
                        <div style="background: #fff3cd; padding: 1rem; border-radius: 8px; line-height: 1.6; border: 1px solid #ffeeba;">
                            ${workout.notes}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${!workout.warmup && !workout.main_phase && !workout.cooldown && !workout.notes ? `
                    <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                        <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                        <p>Nessun dettaglio aggiuntivo disponibile per questo allenamento.</p>
                    </div>
                    ` : ''}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="window.AppCore.closeModal('workoutDetailsModal')">
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
        
        document.body.appendChild(detailsModal);
        document.body.style.overflow = 'hidden';
        
        // Aggiungi event listener per il pulsante X DOPO che il modal è stato aggiunto al DOM
        const closeBtn = document.getElementById('closeDetailsModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                window.AppCore.closeModal('workoutDetailsModal');
                document.body.style.overflow = '';
            });
        }
        
        // Chiudi cliccando fuori
        detailsModal.addEventListener('click', function(e) {
            if (e.target === detailsModal) {
                window.AppCore.closeModal('workoutDetailsModal');
                document.body.style.overflow = '';
            }
        });
    };
    
    window.editWorkout = function(workoutId) {
        window.location.href = `/workout?id=${workoutId}`;
    };
    
    window.confirmDeleteWorkout = async function(workoutId) {
        if (confirm('Sei sicuro di voler eliminare questo allenamento?')) {
            await deleteWorkout(workoutId);
        }
    };
    
    async function deleteWorkout(workoutId) {
        const loading = window.AppCore.showLoading();
        
        try {
            const supabaseClient = window.supabaseClient;
            
            const { error } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('id', workoutId);
                
            if (error) throw error;
            
            workouts = workouts.filter(w => w.id !== workoutId);
            displayWorkouts(workouts);
            
            window.AppCore.showToast('Allenamento eliminato con successo', 'success');
        } catch (error) {
            console.error('Errore durante l\'eliminazione:', error);
            window.AppCore.showToast('Errore nell\'eliminazione dell\'allenamento', 'error');
        } finally {
            window.AppCore.hideLoading(loading);
        }
    }
    
    /**
     * Completamento allenamento
     */
    window.completeWorkout = function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        if (!workout) {
            window.AppCore.showToast('Allenamento non trovato', 'error');
            return;
        }
        
        document.getElementById('completeWorkoutId').value = workoutId;
        
        const now = new Date();
        const localDatetime = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('completedDate').value = localDatetime;
        document.getElementById('actualDuration').value = workout.total_duration || '';
        
        window.AppCore.openModal('completeWorkoutModal');
    };
    
    async function submitCompletedWorkout(e) {
        e.preventDefault();
        
        if (this.submitting) return;
        this.submitting = true;
        
        const loading = window.AppCore.showLoading();
        
        try {
            const workoutId = document.getElementById('completeWorkoutId').value;
            const completedDate = document.getElementById('completedDate').value;
            const actualDuration = parseInt(document.getElementById('actualDuration').value);
            const perceivedDifficulty = document.getElementById('perceivedDifficulty').value;
            const distance = parseFloat(document.getElementById('distance').value || 0);
            const caloriesBurned = parseInt(document.getElementById('caloriesBurned').value || 0);
            const heartRateAvg = parseInt(document.getElementById('heartRateAvg').value || 0);
            const notes = document.getElementById('workoutNotes').value.trim();
            const rating = parseInt(document.querySelector('input[name="rating"]:checked').value || 3);
            
            if (!completedDate || !actualDuration || actualDuration < 1) {
                throw new Error('Compila tutti i campi obbligatori');
            }
            
            const supabaseClient = window.supabaseClient;
            
            const completedWorkoutData = {
                user_id: currentUser.id,
                workout_id: workoutId,
                completed_at: new Date(completedDate).toISOString(),
                actual_duration: actualDuration,
                perceived_difficulty: perceivedDifficulty,
                distance: distance,
                calories_burned: caloriesBurned,
                heart_rate_avg: heartRateAvg,
                notes: notes,
                rating: rating
            };
            
            const { data, error } = await supabaseClient
                .from('completed_workouts')
                .insert([completedWorkoutData])
                .select();
                
            if (error) throw error;
            
            window.AppCore.closeModal('completeWorkoutModal');
            window.AppCore.showToast('Allenamento completato con successo!', 'success');
            
            loadWeeklyStats();
            
            if (confirm('Vuoi vedere le statistiche dei tuoi allenamenti?')) {
                window.location.href = '/stats';
            }
            
        } catch (error) {
            console.error('Errore durante il salvataggio:', error);
            window.AppCore.showToast('Errore: ' + error.message, 'error');
        } finally {
            this.submitting = false;
            window.AppCore.hideLoading(loading);
        }
    }
    
    /**
     * Reset dati utente
     */
    async function resetUserData() {
        if (!currentUser) {
            window.AppCore.showToast('Sessione non valida', 'error');
            return;
        }
        
        const loading = window.AppCore.showLoading();
        
        try {
            const supabaseClient = window.supabaseClient;
            
            // Elimina tutti i dati
            await supabaseClient.from('workout_plans').delete().eq('user_id', currentUser.id);
            await supabaseClient.from('completed_workouts').delete().eq('user_id', currentUser.id);
            await supabaseClient.from('weekly_summaries').delete().eq('user_id', currentUser.id);
            
            window.AppCore.showToast('Tutti i dati sono stati eliminati con successo', 'success');
            
            workouts = [];
            displayWorkouts(workouts);
            loadWeeklyStats();
        } catch (error) {
            console.error('Errore durante l\'eliminazione dei dati:', error);
            window.AppCore.showToast('Errore durante l\'eliminazione dei dati', 'error');
        } finally {
            window.AppCore.hideLoading(loading);
            window.AppCore.closeModal('confirmModal');
        }
    }
    
    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Mobile menu toggle
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const navLinks = document.getElementById('navLinks');

if (mobileMenuToggle && navLinks) {
    mobileMenuToggle.addEventListener('click', function() {
        navLinks.classList.toggle('active');
        
        // Cambia l'icona
        const icon = this.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-bars');
            icon.classList.toggle('fa-times');
        }
    });
    
    // Chiudi il menu quando si clicca su un link
    const navButtons = navLinks.querySelectorAll('a, button');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navLinks.classList.remove('active');
            const icon = mobileMenuToggle.querySelector('i');
            if (icon) {
                icon.classList.add('fa-bars');
                icon.classList.remove('fa-times');
            }
        });
    });
}
        // Reset data
        const resetDataBtn = document.getElementById('resetDataBtn');
        if (resetDataBtn) {
            resetDataBtn.addEventListener('click', () => window.AppCore.openModal('confirmModal'));
        }
        
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', resetUserData);
        }
        
        // Form completamento
        const completeWorkoutForm = document.getElementById('completeWorkoutForm');
        if (completeWorkoutForm) {
            completeWorkoutForm.addEventListener('submit', submitCompletedWorkout);
        }
        
        // Dashboard preferences
        const configureDashboardBtn = document.getElementById('configureDashboardBtn');
        if (configureDashboardBtn) {
            configureDashboardBtn.addEventListener('click', () => {
                window.AppCore.openModal('dashboardConfigModal');
            });
        }
    }
    
    /**
     * Preferenze dashboard
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
            
            window.AppCore.closeModal('dashboardConfigModal');
            window.AppCore.showToast('Preferenze salvate con successo', 'success');
            
        } catch (error) {
            console.error('Errore nel salvataggio delle preferenze:', error);
            window.AppCore.showToast('Errore nel salvataggio delle preferenze', 'error');
        }
    };
    
    // Inizializzazione
    init();
});