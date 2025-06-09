/**
 * workout.js - VERSIONE SEMPLIFICATA
 * Gestione degli allenamenti utilizzando app-core.js
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Inizializzazione workout.js');
    
    // Verifica se siamo in modalità creazione/modifica
    if (window.location.pathname.includes('/workout')) {
        setupWorkoutForm();
    }
});

/**
 * Configura il form per la creazione o modifica di un allenamento
 */
function setupWorkoutForm() {
    console.log('Configurazione del form di allenamento');
    
    // Popola il selettore delle attività
    populateActivityTypes();
    
    // Gestisci il form
    const workoutForm = document.getElementById('workoutForm');
    if (workoutForm) {
        workoutForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Controlla se siamo in modalità modifica
            const workoutId = new URLSearchParams(window.location.search).get('id');
            if (workoutId) {
                await updateWorkout(workoutId);
            } else {
                await createNewWorkout();
            }
        });
    }
    
    // Se siamo in modalità modifica, carica i dati esistenti
    const workoutId = new URLSearchParams(window.location.search).get('id');
    if (workoutId) {
        loadWorkoutForEditing(workoutId);
    }
}

/**
 * Popola il dropdown dei tipi di attività
 */
function populateActivityTypes() {
    const activityTypeSelect = document.getElementById('activityType');
    if (!activityTypeSelect) return;
    
    activityTypeSelect.innerHTML = '';
    
    // Opzione placeholder
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Seleziona attività';
    activityTypeSelect.appendChild(placeholderOption);
    
    // Opzioni di attività
    const activityOptions = [
        { id: 1, name: 'Corsa' },
        { id: 2, name: 'Ciclismo' },
        { id: 3, name: 'Nuoto' },
        { id: 4, name: 'Forza' },
        { id: 5, name: 'Yoga' }
    ];
    
    activityOptions.forEach(activity => {
        const option = document.createElement('option');
        option.value = window.AppCore.activityUuids[activity.id.toString()];
        option.textContent = activity.name;
        activityTypeSelect.appendChild(option);
    });
}

/**
 * Crea un nuovo allenamento
 */
async function createNewWorkout() {
    console.log('Creazione nuovo allenamento');
    
    try {
        // Verifica autenticazione
        const session = await window.AppCore.checkAuth();
        if (!session) return;
        
        // Validazione campi
        const workoutName = document.getElementById('workoutName').value.trim();
        const activityUuid = document.getElementById('activityType').value;
        const duration = parseInt(document.getElementById('duration').value);
        const difficulty = document.getElementById('difficulty').value;
        const objective = document.getElementById('objective').value.trim();
        
        if (!workoutName || !activityUuid || !duration || duration < 1) {
            throw new Error('Compila tutti i campi obbligatori');
        }
        
        // Prepara i dati
        const workoutData = {
            name: workoutName,
            activity_id: activityUuid,
            total_duration: duration,
            difficulty: difficulty,
            objective: objective,
            user_id: session.user.id,
            created_at: new Date().toISOString(),
            warmup: window.AppCore.getRichTextContent('warmup'),
            main_phase: window.AppCore.getRichTextContent('mainPhase'),
            cooldown: window.AppCore.getRichTextContent('cooldown'),
            notes: window.AppCore.getRichTextContent('notes')
        };
        
        console.log('Dati allenamento:', workoutData);
        
        // Invia a Supabase
        const supabaseClient = window.supabaseClient;
        const { data, error } = await supabaseClient
            .from('workout_plans')
            .insert([workoutData]);
            
        if (error) throw error;
        
        window.AppCore.showToast('Allenamento salvato con successo!', 'success');
        
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 1500);
        
    } catch (error) {
        console.error('Errore durante il salvataggio:', error);
        window.AppCore.showToast('Errore: ' + error.message, 'error');
    }
}

/**
 * Carica un allenamento per la modifica
 */
async function loadWorkoutForEditing(workoutId) {
    console.log('Caricamento allenamento per modifica, ID:', workoutId);
    
    try {
        const supabaseClient = window.supabaseClient;
        
        const { data, error } = await supabaseClient
            .from('workout_plans')
            .select('*')
            .eq('id', workoutId)
            .single();
            
        if (error) throw error;
        
        if (!data) {
            throw new Error('Allenamento non trovato');
        }
        
        // Popola il form con i dati
        document.getElementById('workoutName').value = data.name || '';
        document.getElementById('activityType').value = data.activity_id || '';
        document.getElementById('duration').value = data.total_duration || '';
        document.getElementById('difficulty').value = data.difficulty || 'intermedio';
        document.getElementById('objective').value = data.objective || '';
        
        // Imposta il contenuto degli editor di testo
        window.AppCore.setRichTextContent('warmup', data.warmup || '');
        window.AppCore.setRichTextContent('mainPhase', data.main_phase || '');
        window.AppCore.setRichTextContent('cooldown', data.cooldown || '');
        window.AppCore.setRichTextContent('notes', data.notes || '');
        
        // Aggiorna il titolo della pagina
        document.querySelector('.navbar-brand').innerHTML = '<i class="fas fa-dumbbell mr-2"></i> Modifica Allenamento';
        
        // Aggiorna il pulsante di salvataggio
        const saveBtn = document.querySelector('button[type="submit"]');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Aggiorna Allenamento';
        }
        
    } catch (error) {
        console.error('Errore durante il caricamento:', error);
        window.AppCore.showToast('Errore nel caricamento dell\'allenamento', 'error');
    }
}

/**
 * Aggiorna un allenamento esistente
 */
async function updateWorkout(workoutId) {
    console.log('Aggiornamento allenamento, ID:', workoutId);
    
    try {
        // Validazione campi
        const workoutName = document.getElementById('workoutName').value.trim();
        const activityUuid = document.getElementById('activityType').value;
        const duration = parseInt(document.getElementById('duration').value);
        const difficulty = document.getElementById('difficulty').value;
        const objective = document.getElementById('objective').value.trim();
        
        if (!workoutName || !activityUuid || !duration || duration < 1) {
            throw new Error('Compila tutti i campi obbligatori');
        }
        
        // Prepara i dati
        const workoutData = {
            name: workoutName,
            activity_id: activityUuid,
            total_duration: duration,
            difficulty: difficulty,
            objective: objective,
            warmup: window.AppCore.getRichTextContent('warmup'),
            main_phase: window.AppCore.getRichTextContent('mainPhase'),
            cooldown: window.AppCore.getRichTextContent('cooldown'),
            notes: window.AppCore.getRichTextContent('notes')
        };
        
        console.log('Dati aggiornamento:', workoutData);
        
        // Invia a Supabase
        const supabaseClient = window.supabaseClient;
        const { data, error } = await supabaseClient
            .from('workout_plans')
            .update(workoutData)
            .eq('id', workoutId);
            
        if (error) throw error;
        
        window.AppCore.showToast('Allenamento aggiornato con successo!', 'success');
        
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 1500);
        
    } catch (error) {
        console.error('Errore durante l\'aggiornamento:', error);
        window.AppCore.showToast('Errore: ' + error.message, 'error');
    }
}

// Definisci formatText se non esiste
if (typeof window.formatText !== 'function') {
    window.formatText = function(command) {
        document.execCommand(command, false, null);
    };
}