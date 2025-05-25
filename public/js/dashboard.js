/**
 * dashboard.js
 * Script principale per la gestione della dashboard dell'app Di Dio Training
 * Gestisce la visualizzazione degli allenamenti, le operazioni CRUD e il completamento degli allenamenti
 */

document.addEventListener('DOMContentLoaded', async function() {
    // Inizializzazione
    console.log('Inizializzazione dashboard...');
    
    // Variabili globali
    let currentUser = null;
    let workouts = [];
    
    // Mappatura degli UUID delle attività ai nomi
    const activityUuids = {
        '3f731db5-9b4e-4375-9d01-056d9b592387': 'corsa',
        '0bf5223d-c272-4f5b-b7d5-a1bf4acf14a5': 'ciclismo',
        '57c626f0-43fe-42bf-a3fb-c0b4d43bfcb3': 'nuoto',
        '2006eb2a-9ec4-47f8-8c1c-fd95c27f43a9': 'forza',
        '83a0851a-dee1-4cb1-b69d-b57df587d6f9': 'yoga'
    };
    
    // Icone per i tipi di attività
    const activityIcons = {
        'corsa': 'fa-running',
        'ciclismo': 'fa-bicycle',
        'nuoto': 'fa-person-swimming',
        'forza': 'fa-dumbbell',
        'yoga': 'fa-om',
        'default': 'fa-dumbbell'
    };
    
    /**
     * Funzioni principali
     */
    
    // Inizializzazione applicazione
    async function init() {
        try {
            // Verifica autenticazione
            const session = await checkAuth();
            if (!session) {
                console.error('Utente non autenticato');
                return;
            }
            
            currentUser = session.user;
            console.log('Utente autenticato:', currentUser.email);
            
            // Carica i dati della dashboard
            setupEventListeners();
            await loadWorkouts();
            await loadWeeklyStats();
            
        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            showToast('Errore durante l\'inizializzazione', 'error');
        }
    }
    
    // Verifica autenticazione
    async function checkAuth() {
        try {
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                console.error('Client Supabase non disponibile');
                window.location.href = '/';
                return null;
            }
            
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error) {
                console.error('Errore durante il controllo della sessione:', error);
                window.location.href = '/';
                return null;
            }
            
            if (!session) {
                console.log('Nessuna sessione attiva');
                window.location.href = '/';
                return null;
            }
            
            return session;
        } catch (error) {
            console.error('Errore di autenticazione:', error);
            window.location.href = '/';
            return null;
        }
    }
    
    // Carica gli allenamenti dell'utente
    async function loadWorkouts() {
        const loading = showLoading();
        
        try {
            // Verifica sessione utente
            if (!currentUser) {
                throw new Error('Utente non autenticato');
            }
            
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            // Carica gli allenamenti dal database
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .select(`
                    *,
                    activities (id, name)
                `)
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
                
            if (error) {
                throw error;
            }
            
            // Salva gli allenamenti e aggiorna l'interfaccia
            workouts = data || [];
            displayWorkouts(workouts);
            
            console.log(`Caricati ${workouts.length} allenamenti`);
        } catch (error) {
            console.error('Errore durante il caricamento degli allenamenti:', error);
            showToast('Errore nel caricamento degli allenamenti', 'error');
        } finally {
            hideLoading(loading);
        }
    }
    
    // Carica le statistiche settimanali
    async function loadWeeklyStats() {
        try {
            const weeklyStatsContainer = document.getElementById('weekly-stats');
            if (!weeklyStatsContainer) return;
            
            // Se l'utente non è autenticato, esci
            if (!currentUser) {
                weeklyStatsContainer.innerHTML = `
                    <div class="text-center py-3">
                        <p>Devi essere autenticato per visualizzare le statistiche</p>
                    </div>
                `;
                return;
            }
            
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            // Calcola l'intervallo della settimana corrente
            const today = new Date();
            const firstDayOfWeek = new Date(today);
            const day = today.getDay() || 7; // Se è 0 (domenica), diventa 7
            firstDayOfWeek.setDate(today.getDate() - day + 1); // Primo giorno = lunedì
            firstDayOfWeek.setHours(0, 0, 0, 0);
            
            const lastDayOfWeek = new Date(firstDayOfWeek);
            lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6); // Ultimo giorno = domenica
            lastDayOfWeek.setHours(23, 59, 59, 999);
            
            // Ottieni gli allenamenti completati questa settimana
            const { data: completedWorkouts, error: completedError } = await supabaseClient
                .from('completed_workouts')
                .select('*')
                .eq('user_id', currentUser.id)
                .gte('completed_at', firstDayOfWeek.toISOString())
                .lte('completed_at', lastDayOfWeek.toISOString());
                
            if (completedError) {
                throw completedError;
            }
            
            // Ottieni i riepiloghi settimanali
            const { data: weeklySummaries, error: summariesError } = await supabaseClient
                .from('weekly_summaries')
                .select('*')
                .eq('user_id', currentUser.id)
                .gte('date', firstDayOfWeek.toISOString())
                .lte('date', lastDayOfWeek.toISOString());
                
            if (summariesError) {
                throw summariesError;
            }
            
            // Calcola le statistiche
            const totalCompleted = completedWorkouts ? completedWorkouts.length : 0;
            const totalPlanned = weeklySummaries ? weeklySummaries.filter(s => s.workout_type).length : 0;
            const completion = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;
            
            // Calcola durata totale e calorie
            let totalDuration = 0;
            let totalCalories = 0;
            
            if (completedWorkouts && completedWorkouts.length > 0) {
                totalDuration = completedWorkouts.reduce((sum, workout) => sum + (workout.actual_duration || 0), 0);
                totalCalories = completedWorkouts.reduce((sum, workout) => sum + (workout.calories_burned || 0), 0);
            }
            
            // Aggiorna l'interfaccia
            weeklyStatsContainer.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div class="stat-value">${totalCompleted}/${totalPlanned}</div>
                        <div class="stat-label">Allenamenti Completati</div>
                    </div>
                    
                    <div class="stat-card">
                        <div class="stat-icon">
                            <i class="fas fa-percentage"></i>
                        </div>
                        <div class="stat-value">${completion}%</div>
                        <div class="stat-label">Completamento</div>
                    </div>
                    
                    <div class="stat-card">
                        <div class="stat-icon">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="stat-value">${formatDuration(totalDuration)}</div>
                        <div class="stat-label">Tempo Totale</div>
                    </div>
                    
                    <div class="stat-card">
                        <div class="stat-icon">
                            <i class="fas fa-fire"></i>
                        </div>
                        <div class="stat-value">${totalCalories}</div>
                        <div class="stat-label">Calorie Bruciate</div>
                    </div>
                </div>
                
                <div class="text-center mt-4">
                    <a href="/weekly_summary" class="btn btn-primary">
                        <i class="fas fa-calendar-week"></i> Gestisci Pianificazione
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
     * Funzioni per la gestione degli allenamenti
     */
    
    // Visualizza gli allenamenti nella dashboard
    function displayWorkouts(workouts) {
        const container = document.getElementById('workout-list');
        if (!container) {
            console.warn('Container workout-list non trovato nella pagina');
            return;
        }
        
        console.log(`Visualizzazione di ${workouts.length} allenamenti`);
        
        // Svuota il contenitore
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
        
        // Crea le card degli allenamenti
        workouts.forEach((workout, index) => {
            // Determina l'icona in base al tipo di attività (UUID)
            const iconClass = getWorkoutIconByUuid(workout.activity_id);
            
            // Crea la card dell'allenamento
            const card = document.createElement('div');
            card.className = 'card workout-card';
            card.dataset.id = workout.id;
            card.dataset.workoutType = activityUuids[workout.activity_id] || 'default';
            card.style.animationDelay = `${index * 0.1}s`;
            
            // Crea il contenuto della card
            card.innerHTML = `
                <div class="workout-header">
                    <h3 class="workout-title">${workout.name || 'Allenamento'}</h3>
                    <div class="workout-icon">
                        <i class="fas ${iconClass}"></i>
                    </div>
                </div>
                <div class="workout-details">
                    <p><strong>Durata:</strong> ${formatDuration(workout.total_duration)}</p>
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
            
            // Aggiungi la card al contenitore
            container.appendChild(card);
        });
    }
    
    // Ottiene l'icona appropriata per il tipo di attività
    function getWorkoutIconByUuid(activityUuid) {
        // Converti UUID in tipo di attività
        const activityType = activityUuids[activityUuid] || 'default';
        // Restituisci la classe dell'icona
        return activityIcons[activityType] || activityIcons.default;
    }
    
    // Visualizza i dettagli di un allenamento
    function viewWorkout(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Determina l'icona
        const iconClass = getWorkoutIconByUuid(workout.activity_id);
        
        // Crea una modal per i dettagli
        const detailsModal = document.createElement('div');
        detailsModal.id = 'workoutDetailsModal';
        detailsModal.className = 'modal';
        detailsModal.style.display = 'flex';
        
        detailsModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${workout.name}</h2>
                    <button class="modal-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="workout-details">
                    <div class="detail-item">
                        <strong>Durata Totale:</strong> ${formatDuration(workout.total_duration)}
                    </div>
                    <div class="detail-item">
                        <strong>Difficoltà:</strong> ${workout.difficulty || 'Non specificata'}
                    </div>
                    <div class="detail-item">
                        <strong>Obiettivo:</strong> ${workout.objective || 'Non specificato'}
                    </div>
                    <div class="detail-item">
                        <strong>Tipo di Attività:</strong> ${workout.activities?.name || 'Non specificata'}
                    </div>
                    
                    <div class="detail-section">
                        <h3>Riscaldamento</h3>
                        <div>${workout.warmup || 'Nessun riscaldamento specificato'}</div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Fase Principale</h3>
                        <div>${workout.main_phase || 'Nessuna fase principale specificata'}</div>
                    </div>
                    
                    <div class="detail-section">
                        <h3>Defaticamento</h3>
                        <div>${workout.cooldown || 'Nessun defaticamento specificato'}</div>
                    </div>
                    
                    ${workout.notes ? `
                    <div class="detail-section">
                        <h3>Note</h3>
                        <div>${workout.notes}</div>
                    </div>
                    ` : ''}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="closeModal('workoutDetailsModal')">
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
        
        // Gestisci chiusura
        const closeBtn = detailsModal.querySelector('.modal-close');
        closeBtn.addEventListener('click', () => {
            detailsModal.remove();
            document.body.style.overflow = '';
        });
        
        // Chiudi cliccando fuori
        detailsModal.addEventListener('click', function(e) {
            if (e.target === detailsModal) {
                detailsModal.remove();
                document.body.style.overflow = '';
            }
        });
    }
    
    // Funzione per modificare un allenamento
    function editWorkout(workoutId) {
        window.location.href = `/workout?id=${workoutId}`;
    }
    
    // Funzione per confermare l'eliminazione di un allenamento
    function confirmDeleteWorkout(workoutId) {
        if (confirm('Sei sicuro di voler eliminare questo allenamento?')) {
            deleteWorkout(workoutId);
        }
    }
    
    // Funzione per eliminare un allenamento
    async function deleteWorkout(workoutId) {
        const loading = showLoading();
        
        try {
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            // Elimina l'allenamento
            const { error } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('id', workoutId);
                
            if (error) {
                throw error;
            }
            
            // Rimuovi anche dalla lista locale
            workouts = workouts.filter(w => w.id !== workoutId);
            
            // Aggiorna la UI
            displayWorkouts(workouts);
            
            showToast('Allenamento eliminato con successo', 'success');
        } catch (error) {
            console.error('Errore durante l\'eliminazione dell\'allenamento:', error);
            showToast('Errore nell\'eliminazione dell\'allenamento', 'error');
        } finally {
            hideLoading(loading);
        }
    }
    
    // Funzione per resettare tutti i dati dell'utente
    async function resetUserData() {
        // Verifica sessione utente
        if (!currentUser) {
            showToast('Sessione non valida. Effettua nuovamente il login.', 'error');
            return;
        }
        
        const loading = showLoading();
        
        try {
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            // Elimina tutti i workout dell'utente
            const { error: workoutsError } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (workoutsError) {
                throw workoutsError;
            }
            
            // Elimina anche gli allenamenti completati
            const { error: completedError } = await supabaseClient
                .from('completed_workouts')
                .delete()
                .eq('user_id', currentUser.id);
            
            // Non blocchiamo se c'è un errore qui, ma lo logghiamo
            if (completedError) {
                console.error('Errore nell\'eliminazione degli allenamenti completati:', completedError);
            }
            
            // Elimina i riepiloghi settimanali
            const { error: summariesError } = await supabaseClient
                .from('weekly_summaries')
                .delete()
                .eq('user_id', currentUser.id);
            
            // Non blocchiamo se c'è un errore qui, ma lo logghiamo
            if (summariesError) {
                console.error('Errore nell\'eliminazione dei riepiloghi settimanali:', summariesError);
            }
            
            showToast('Tutti i dati sono stati eliminati con successo', 'success');
            
            // Ricarica gli allenamenti
            workouts = [];
            displayWorkouts(workouts);
            loadWeeklyStats();
        } catch (error) {
            console.error('Errore durante l\'eliminazione dei dati:', error);
            showToast('Errore durante l\'eliminazione dei dati: ' + error.message, 'error');
        } finally {
            hideLoading(loading);
            closeModal('confirmModal');
        }
    }
    
    /**
     * Funzioni per il completamento degli allenamenti
     */
    
    // Funzione per mostrare la modal di completamento allenamento
    function completeWorkout(workoutId) {
        // Trova l'allenamento nei dati caricati
        const workout = workouts.find(w => w.id === workoutId);
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Imposta l'ID dell'allenamento nel form
        document.getElementById('completeWorkoutId').value = workoutId;
        
        // Imposta la data di completamento al momento attuale
        const now = new Date();
        const localDatetime = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('completedDate').value = localDatetime;
        
        // Precompila la durata con quella pianificata
        document.getElementById('actualDuration').value = workout.total_duration || '';
        
        // Mostra la modal
        document.getElementById('completeWorkoutModal').style.display = 'flex';
    }
    
    // Funzione per inviare i dati dell'allenamento completato
    async function submitCompletedWorkout(e) {
        e.preventDefault();
        
        // Previeni l'invio multiplo
        if (this.submitting) {
            console.log('Invio già in corso, ignorato');
            return;
        }
        
        // Segna che stiamo inviando
        this.submitting = true;
        
        const loading = showLoading();
        
        try {
            // Ottieni i valori dal form
            const workoutId = document.getElementById('completeWorkoutId').value;
            const completedDate = document.getElementById('completedDate').value;
            const actualDuration = parseInt(document.getElementById('actualDuration').value);
            const perceivedDifficulty = document.getElementById('perceivedDifficulty').value;
            const distance = parseFloat(document.getElementById('distance').value || 0);
            const caloriesBurned = parseInt(document.getElementById('caloriesBurned').value || 0);
            const heartRateAvg = parseInt(document.getElementById('heartRateAvg').value || 0);
            const notes = document.getElementById('workoutNotes').value.trim();
            const rating = parseInt(document.querySelector('input[name="rating"]:checked').value || 3);
            
            // Validazione
            if (!workoutId) {
                throw new Error('ID allenamento mancante');
            }
            
            if (!completedDate) {
                throw new Error('Data di completamento richiesta');
            }
            
            if (!actualDuration || actualDuration < 1) {
                throw new Error('Durata effettiva richiesta');
            }
            
            // Verifica che il client Supabase sia disponibile
            const supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            // Verifica autenticazione
            const { data: { session }, error: authError } = await supabaseClient.auth.getSession();
            if (authError || !session) {
                throw new Error('Utente non autenticato');
            }
            
            // Prepara i dati da salvare
            const completedWorkoutData = {
                user_id: session.user.id,
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
            
            console.log('Dati allenamento completato:', completedWorkoutData);
            
            // Salva nel database
            const { data, error } = await supabaseClient
                .from('completed_workouts')
                .insert([completedWorkoutData])
                .select();
                
            if (error) {
                throw error;
            }
            
            // Chiudi la modal
            closeModal('completeWorkoutModal');
            
            // Mostra conferma e reindirizza alle statistiche
            showToast('Allenamento completato con successo!', 'success');
            
            // Ricarica le statistiche settimanali
            loadWeeklyStats();
            
            // Offri all'utente di andare alle statistiche
            if (confirm('Vuoi vedere le statistiche dei tuoi allenamenti?')) {
                window.location.href = '/stats';
            }
            
        } catch (error) {
            console.error('Errore durante il salvataggio dell\'allenamento completato:', error);
            showToast('Errore: ' + error.message, 'error');
        } finally {
            // Rimuovi il flag di invio
            this.submitting = false;
            hideLoading(loading);
        }
    }
    
    /**
     * Funzioni di utilità
     */
    
    // Formatta la durata in ore e minuti
    function formatDuration(minutes) {
        if (!minutes) return '0 min';
        
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
        } else {
            return `${minutes}m`;
        }
    }
    
    // Mostra il loader
    function showLoading() {
        const loading = document.createElement('div');
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-spinner"></div>
            <p>Caricamento...</p>
        `;
        document.body.appendChild(loading);
        document.body.style.overflow = 'hidden';
        return loading;
    }
    
    // Nascondi il loader
    function hideLoading(loadingElement) {
        if (loadingElement && loadingElement.parentNode) {
            loadingElement.remove();
        }
        document.body.style.overflow = '';
    }
    
    // Mostra un toast di notifica
    function showToast(message, type = 'info', duration = 3000) {
        // Rimuovi toast esistenti
        document.querySelectorAll('.toast').forEach(toast => toast.remove());
        
        // Crea il toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Crea l'icona appropriata in base al tipo
        let icon = '';
        switch (type) {
            case 'success':
                icon = '<i class="fas fa-check-circle"></i>';
                break;
            case 'error':
                icon = '<i class="fas fa-exclamation-circle"></i>';
                break;
            case 'warning':
                icon = '<i class="fas fa-exclamation-triangle"></i>';
                break;
            case 'info':
            default:
                icon = '<i class="fas fa-info-circle"></i>';
                break;
        }
        
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-message">${message}</div>
            <button class="toast-close" aria-label="Chiudi">&times;</button>
        `;
        
        // Aggiungi stili
        toast.style.animation = 'toastSlideIn 0.3s ease-out forwards';
        document.body.appendChild(toast);
        
        // Chiusura toast al click
        const closeButton = toast.querySelector('.toast-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                toast.classList.add('toast-fade-out');
                setTimeout(() => toast.remove(), 300);
            });
        }
        
        // Auto-chiusura dopo il timeout
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('toast-fade-out');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
        
        return toast;
    }
    
    // Gestione delle modal
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }else {
    console.error(`Modal con ID '${modalId}' non trovata`);
    }
    }

    
   function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        } else if (typeof modalId === 'string' && modalId.includes('Modal')) {
            
            // Prova a trovare la modal con getElementById
            const modalElement = document.getElementById(modalId);
            if (modalElement) {
                modalElement.style.display = 'none';
                document.body.style.overflow = '';
            } else {
                // Prova a trovare la modal con querySelector
                const modalByClass = document.querySelector(`#${modalId}, .${modalId}, [data-modal="${modalId}"]`);
                if (modalByClass) {
                    modalByClass.style.display = 'none';
                    document.body.style.overflow = '';
                } else {
                    // Se è un elemento DOM
                    if (modalId.remove) {
                        modalId.remove();
                        document.body.style.overflow = '';
                    }
                }
            }
        }
    }
    
    /**
     * Configurazione event listeners
     */
    function setupEventListeners() {
        // Modal di conferma eliminazione dati
        const resetDataBtn = document.getElementById('resetDataBtn');
        if (resetDataBtn) {
            resetDataBtn.addEventListener('click', () => {
                openModal('confirmModal');
            });
        }
        
        // Pulsanti di conferma/annulla eliminazione
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', resetUserData);
        }
        
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                closeModal('confirmModal');
            });
        }
        
        // Pulsante di chiusura delle modal
        const closeButtons = document.querySelectorAll('.close-btn, .modal-close');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Trova la modal parent
                const modal = btn.closest('.modal');
                if (modal) {
                    modal.style.display = 'none';
                    document.body.style.overflow = '';
                }
            });
        });
        
        // Chiusura delle modal cliccando fuori
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
        
        // Form completamento allenamento
        const completeWorkoutForm = document.getElementById('completeWorkoutForm');
        if (completeWorkoutForm) {
            completeWorkoutForm.addEventListener('submit', submitCompletedWorkout);
        }
        
        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                try {
                    const supabaseClient = window.supabaseClient;
                    if (!supabaseClient) {
                        throw new Error('Client Supabase non disponibile');
                    }
                    
                    const { error } = await supabaseClient.auth.signOut();
                    if (error) throw error;
                    
                    window.location.href = '/';
                } catch (error) {
                    console.error('Errore durante il logout:', error);
                    showToast('Errore durante il logout', 'error');
                }
            });
        }
    }
// Preferenze dashboard globali
    let dashboardPreferences = {
  widget_order: ["weeklyStats", "recentWorkouts", "caloriesChart", "durationChart", "goalProgress"],
  visible_widgets: {
    weeklyStats: true,
    recentWorkouts: true,
    caloriesChart: true,
    durationChart: true,
    goalProgress: true
  }
};

// Carica le preferenze della dashboard
async function loadDashboardPreferences() {
  try {
    // Verifica che il client Supabase sia disponibile
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient || !currentUser) {
      return;
    }
    
 // Verifica autenticazione
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      return;
    }

    // Carica le preferenze
    const { data, error } = await supabaseClient
      .from('dashboard_preferences')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
      
    if (error) {
      throw error;
    }
    
    // Se ci sono preferenze salvate, usale
    if (data) {
      dashboardPreferences = {
        widget_order: data.widget_order || dashboardPreferences.widget_order,
        visible_widgets: data.visible_widgets || dashboardPreferences.visible_widgets
      };
    }
    
    // Applica le preferenze alla dashboard
    applyDashboardPreferences();
    
    // Aggiorna i checkbox nella modal di configurazione
    updateConfigModalCheckboxes();
    
  } catch (error) {
    console.error('Errore nel caricamento delle preferenze della dashboard:', error);
  }
}

// Aggiorna i checkbox nella modal di configurazione
function updateConfigModalCheckboxes() {
  const widgets = ['weeklyStats', 'caloriesChart', 'durationChart', 'goalProgress', 'recentWorkouts'];
  
  widgets.forEach(widget => {
    const checkbox = document.getElementById(`show${widget.charAt(0).toUpperCase() + widget.slice(1)}`);
    if (checkbox) {
      checkbox.checked = dashboardPreferences.visible_widgets[widget] === true;
    }
  });
  
  // Aggiorna anche l'ordine dei widget
  const orderList = document.getElementById('widgetOrderList');
  if (orderList) {
    // Rimuovi tutti gli elementi
    while (orderList.firstChild) {
      orderList.removeChild(orderList.firstChild);
    }
    
    // Aggiungi elementi nell'ordine salvato
    dashboardPreferences.widget_order.forEach(widgetId => {
      const widgetName = getWidgetName(widgetId);
      const listItem = document.createElement('div');
      listItem.className = 'widget-order-item';
      listItem.dataset.widgetId = widgetId;
      listItem.innerHTML = `
        <i class="fas fa-grip-lines"></i>
        <span>${widgetName}</span>
      `;
      orderList.appendChild(listItem);
    });
    
    // Inizializza Sortable.js
    if (window.Sortable) {
      new Sortable(orderList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function(evt) {
          // Aggiorna l'ordine in base agli elementi
          const items = orderList.querySelectorAll('.widget-order-item');
          dashboardPreferences.widget_order = Array.from(items).map(item => item.dataset.widgetId);
        }
      });
    }
  }
}

// Salva le preferenze della dashboard
async function saveDashboardPreferences() {
  try {
    // Raccogli le preferenze dai checkbox
    const widgets = ['weeklyStats', 'caloriesChart', 'durationChart', 'goalProgress', 'recentWorkouts'];
    
    widgets.forEach(widget => {
      const checkbox = document.getElementById(`show${widget.charAt(0).toUpperCase() + widget.slice(1)}`);
      if (checkbox) {
        dashboardPreferences.visible_widgets[widget] = checkbox.checked;
      }
    });
    
    // Verifica autenticazione
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
      throw new Error('Client Supabase non disponibile');
    }
    
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      throw new Error('Utente non autenticato');
    }
    
    // Applica le preferenze
    applyDashboardPreferences();
    
    // Chiudi la modal
    closeModal('dashboardConfigModal');
    
    // Mostra una conferma
    showToast('Preferenze dashboard salvate con successo', 'success');
    
  } catch (error) {
    console.error('Errore nel salvataggio delle preferenze della dashboard:', error);
    showToast('Errore nel salvataggio delle preferenze: ' + error.message, 'error');
  }
}


// Applica le preferenze della dashboard
function applyDashboardPreferences() {
  // Per ogni widget, mostra/nascondi in base alle preferenze
  Object.entries(dashboardPreferences.visible_widgets).forEach(([widgetId, isVisible]) => {
    const widget = document.getElementById(widgetId);
    if (widget) {
      widget.style.display = isVisible ? 'block' : 'none';
    }
  });
  
  // Riorganizza i widget in base all'ordine preferito
  const dashboardContainer = document.querySelector('.dashboard-section');
  if (dashboardContainer) {
    const widgets = {};
    
    // Salva riferimenti a tutti i widget
    dashboardPreferences.widget_order.forEach(widgetId => {
      widgets[widgetId] = document.getElementById(widgetId);
    });
    
    // Rimuovi tutti i widget
    Object.values(widgets).forEach(widget => {
      if (widget && widget.parentNode) {
        widget.parentNode.removeChild(widget);
      }
    });
    
    // Aggiungi i widget nell'ordine corretto
    dashboardPreferences.widget_order.forEach(widgetId => {
      const widget = widgets[widgetId];
      if (widget && dashboardPreferences.visible_widgets[widgetId]) {
        dashboardContainer.appendChild(widget);
      }
    });
  }
}

// Ottieni il nome descrittivo di un widget
function getWidgetName(widgetId) {
  const names = {
    weeklyStats: 'Riepilogo settimanale',
    caloriesChart: 'Grafico calorie',
    durationChart: 'Grafico durata',
    goalProgress: 'Progressi obiettivi',
    recentWorkouts: 'Allenamenti recenti'
  };
  
  return names[widgetId] || widgetId;
}

document.addEventListener('DOMContentLoaded', function() {
    console.log("Elementi nella pagina:");
  console.log("Pulsante:", document.getElementById('configureDashboardBtn'));
  console.log("Modal:", document.getElementById('dashboardConfigModal'));
  // Configura il pulsante per aprire la modal
  const configureDashboardBtn = document.getElementById('configureDashboardBtn');
  if (configureDashboardBtn) {
    configureDashboardBtn.addEventListener('click', function() {
      const modal = document.getElementById('dashboardConfigModal');
      if (modal) {
        modal.style.display = 'flex';
        updateConfigModalCheckboxes();
      } else {
        console.error('Modal di configurazione dashboard non trovata');
      }
    });
  }
  
  // Configura il pulsante per salvare le preferenze
  const saveDashboardBtn = document.getElementById('saveNotificationSettingsBtn');
  if (saveDashboardBtn) {
    saveDashboardBtn.addEventListener('click', saveDashboardPreferences);
  }
  
  // Carica le preferenze della dashboard
  loadDashboardPreferences();
});

// Inizializza Sortable.js
document.addEventListener('DOMContentLoaded', function() {
  const configureDashboardBtn = document.getElementById('configureDashboardBtn');
  if (configureDashboardBtn) {
    configureDashboardBtn.addEventListener('click', function() {
      openModal('dashboardConfigModal');
      updateConfigModalCheckboxes();
    });
  }
  
  // Cerca di inizializzare Sortable.js
  const orderList = document.getElementById('widgetOrderList');
  if (orderList && window.Sortable) {
    new Sortable(orderList, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: function(evt) {
        // Aggiorna l'ordine in base agli elementi
        const items = orderList.querySelectorAll('.widget-order-item');
        dashboardPreferences.widget_order = Array.from(items).map(item => item.dataset.widgetId);
      }
    });
  }
  
  // Aggiungere questa chiamata all'inizializzazione
  loadDashboardPreferences();
});

// Aggiungere a setupEventListeners()
// All'interno della funzione setupEventListeners(), aggiungi:
const saveDashboardBtn = document.getElementById('saveDashboardBtn');
if (saveDashboardBtn) {
  saveDashboardBtn.addEventListener('click', saveDashboardPreferences);
}
    
    /**
     * Espone funzioni globali per l'HTML
     */
    window.editWorkout = editWorkout;
    window.viewWorkout = viewWorkout;
    window.confirmDeleteWorkout = confirmDeleteWorkout;
    window.completeWorkout = completeWorkout;
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.showToast = showToast;
    window.saveDashboardPreferences = saveDashboardPreferences;
    
    /**
     * Inizializza l'applicazione
     */
    init();
});
document.addEventListener('DOMContentLoaded', function() {
    // Gestione menu mobile responsivo
    const mobileMenuToggle = document.createElement('button');
    mobileMenuToggle.className = 'mobile-menu-toggle';
    mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
    mobileMenuToggle.setAttribute('aria-label', 'Menu');
    
    const navbarContainer = document.querySelector('.navbar .container');
    const navLinks = document.querySelector('.nav-links');
    
    if (navbarContainer && navLinks) {
        // Inserisci il pulsante del menu dopo il brand, prima dei link
        navbarContainer.insertBefore(mobileMenuToggle, navLinks);
        
        // Gestisci il click sul toggle
        mobileMenuToggle.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            // Cambia l'icona in base allo stato
            if (navLinks.classList.contains('active')) {
                mobileMenuToggle.innerHTML = '<i class="fas fa-times"></i>';
            } else {
                mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
            }
        });
        
        // Chiudi il menu quando si clicca su un link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', function() {
                if (window.innerWidth <= 992) {
                    navLinks.classList.remove('active');
                    mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
                }
            });
        });
        
        // Chiudi il menu quando si ridimensiona la finestra oltre i 992px
        window.addEventListener('resize', function() {
            if (window.innerWidth > 992) {
                navLinks.classList.remove('active');
                mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
            }
        });
    }
});