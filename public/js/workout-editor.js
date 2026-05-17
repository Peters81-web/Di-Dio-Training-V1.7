/**
 * workout-editor.js
 * Sistema migliorato per la gestione degli editor di testo ricco e la gestione di salvataggio/modifica
 * degli allenamenti nell'applicazione Di Dio Training
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Inizializzazione workout-editor.js');

    // Inizializzazione degli editor di testo ricco
    initRichTextEditors();

    // Gestione del submit del form
    setupFormSubmission();

    // Verifiche iniziali
    performInitialChecks();
});

/**
 * Inizializza gli editor di testo ricco nella pagina
 */
function initRichTextEditors() {
    console.log('Inizializzazione editor di testo ricco');
    
    // Definisci la funzione formatText se non esiste già
    if (typeof window.formatText !== 'function') {
        window.formatText = function(command) {
            document.execCommand(command, false, null);
        };
    }
    
    // Definisci la funzione per ottenere il contenuto
    if (typeof window.getRichTextContent !== 'function') {
        window.getRichTextContent = function(editorId) {
            const editor = document.getElementById(editorId);
            return editor ? editor.innerHTML : '';
        };
    }
    
    // Definisci la funzione per impostare il contenuto
    if (typeof window.setRichTextContent !== 'function') {
        window.setRichTextContent = function(editorId, content) {
            const editor = document.getElementById(editorId);
            if (editor) {
                editor.innerHTML = content || '';
            }
        };
    }
    
    // Inizializza gli editor con comportamenti di placeholder
    document.querySelectorAll('.rich-text-editor').forEach(editor => {
        // Mostra il placeholder quando l'editor è vuoto
        const placeholder = editor.getAttribute('data-placeholder');
        
        if (placeholder && editor.innerHTML.trim() === '') {
            editor.innerHTML = '<span class="placeholder">' + placeholder + '</span>';
        }
        
        // Rimuovi il placeholder quando l'editor riceve il focus
        editor.addEventListener('focus', function() {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl) {
                this.innerHTML = '';
            }
        });
        
        // Ripristina il placeholder se l'editor è vuoto e perde il focus
        editor.addEventListener('blur', function() {
            if (this.innerHTML.trim() === '' || this.innerHTML === '<br>') {
                this.innerHTML = '<span class="placeholder">' + placeholder + '</span>';
            }
        });
        
        // Assicurati che il placeholder non venga inviato come contenuto
        editor.addEventListener('input', function() {
            this.querySelector('.placeholder')?.remove();
        });
    });
}

/**
 * Configura la gestione della sottomissione del form
 */
function setupFormSubmission() {
    const workoutForm = document.getElementById('workoutForm');
    if (!workoutForm) {
        console.warn('Form di allenamento non trovato');
        return;
    }
    
    console.log('Configurazione gestione form');
    
    // Rimuovi eventuali listener esistenti
    const clonedForm = workoutForm.cloneNode(true);
    workoutForm.parentNode.replaceChild(clonedForm, workoutForm);
    
    // Aggiungi il nuovo listener
    clonedForm.addEventListener('submit', function(e) {
        e.preventDefault();
        console.log('Form sottomesso');
        
        // Verifica i campi prima di salvare
        if (validateForm()) {
            // Controlla se siamo in modalità modifica o creazione
            const workoutId = new URLSearchParams(window.location.search).get('id');
            if (workoutId) {
                saveExistingWorkout(workoutId);
            } else {
                saveNewWorkout();
            }
        }
    });
    
}

/**
 * Valida il form prima del salvataggio
 */
function validateForm() {
    console.log('Validazione form');
    
    // Recupera i valori
    const workoutName = document.getElementById('workoutName').value.trim();
    const activityType = document.getElementById('activityType').value;
    const duration = document.getElementById('duration').value;
    
    // Verifica i campi richiesti
    let isValid = true;
    let errorMessage = '';
    
    if (!workoutName) {
        isValid = false;
        errorMessage += 'Inserisci un nome per l\'allenamento\n';
        document.getElementById('workoutName').classList.add('error');
    } else {
        document.getElementById('workoutName').classList.remove('error');
    }
    
    if (!activityType) {
        isValid = false;
        errorMessage += 'Seleziona un tipo di attività\n';
        document.getElementById('activityType').classList.add('error');
        document.getElementById('activityTypeError').textContent = 'Seleziona un tipo di attività';
    } else {
        document.getElementById('activityType').classList.remove('error');
        document.getElementById('activityTypeError').textContent = '';
    }
    
    if (!duration || parseInt(duration) < 1) {
        isValid = false;
        errorMessage += 'Inserisci una durata valida (minimo 1 minuto)\n';
        document.getElementById('duration').classList.add('error');
    } else {
        document.getElementById('duration').classList.remove('error');
    }
    
    if (!isValid) {
        alert('Per favore, correggi i seguenti errori:\n' + errorMessage);
    }
    
    return isValid;
}

/**
 * Salva un nuovo allenamento
 */
async function saveNewWorkout() {
    console.log('Salvataggio nuovo allenamento');
    
    try {
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
        
        // Prepara i dati dell'allenamento
        const workoutData = {
            name: document.getElementById('workoutName').value.trim(),
            activity_id: null,
            activity_type: document.getElementById('activityType').value,
            total_duration: parseInt(document.getElementById('duration').value),
            difficulty: document.getElementById('difficulty').value,
            objective: document.getElementById('objective').value.trim(),
            user_id: session.user.id,
            created_at: new Date().toISOString()
        };
        
        // Pulisci il contenuto degli editor (rimuovi placeholder)
        cleanEditorContent('warmup');
        cleanEditorContent('mainPhase');
        cleanEditorContent('cooldown');
        cleanEditorContent('notes');
        
        // Aggiungi i contenuti degli editor
        workoutData.warmup = getRichTextContent('warmup');
        workoutData.main_phase = getRichTextContent('mainPhase');
        workoutData.cooldown = getRichTextContent('cooldown');
        workoutData.notes = getRichTextContent('notes');
        
        console.log('Dati allenamento:', workoutData);
        
        // Disabilita il pulsante durante il salvataggio
        toggleSubmitButton(false);
        
        // Salva nel database
        const { data, error } = await supabaseClient
            .from('workout_plans')
            .insert([workoutData])
            .select();
        
        if (error) {
            throw error;
        }
        
        alert('Allenamento salvato con successo!');
        
        // Redirect alla dashboard
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 1000);
        
    } catch (error) {
        console.error('Errore durante il salvataggio:', error);
        alert('Errore: ' + error.message);
        toggleSubmitButton(true);
    }
}

/**
 * Salva un allenamento esistente
 */
async function saveExistingWorkout(workoutId) {
    console.log('Aggiornamento allenamento esistente, ID:', workoutId);
    
    try {
        // Verifica che il client Supabase sia disponibile
        const supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            throw new Error('Client Supabase non disponibile');
        }
        
        // Prepara i dati dell'allenamento
        const workoutData = {
            name: document.getElementById('workoutName').value.trim(),
            activity_id: null,
            activity_type: document.getElementById('activityType').value,
            total_duration: parseInt(document.getElementById('duration').value),
            difficulty: document.getElementById('difficulty').value,
            objective: document.getElementById('objective').value.trim()
        };
        
        // Pulisci il contenuto degli editor (rimuovi placeholder)
        cleanEditorContent('warmup');
        cleanEditorContent('mainPhase');
        cleanEditorContent('cooldown');
        cleanEditorContent('notes');
        
        // Aggiungi i contenuti degli editor
        workoutData.warmup = getRichTextContent('warmup');
        workoutData.main_phase = getRichTextContent('mainPhase');
        workoutData.cooldown = getRichTextContent('cooldown');
        workoutData.notes = getRichTextContent('notes');
        
        console.log('Dati aggiornamento:', workoutData);
        
        // Disabilita il pulsante durante il salvataggio
        toggleSubmitButton(false);
        
        // Aggiorna nel database
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Sessione non valida');

        const { data, error } = await supabaseClient
            .from('workout_plans')
            .update(workoutData)
            .eq('id', workoutId)
            .eq('user_id', session.user.id)
            .select();
        
        if (error) {
            throw error;
        }
        
        alert('Allenamento aggiornato con successo!');
        
        // Redirect alla dashboard
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 1000);
        
    } catch (error) {
        console.error('Errore durante l\'aggiornamento:', error);
        alert('Errore: ' + error.message);
        toggleSubmitButton(true);
    }
}

/**
 * Pulisce il contenuto dell'editor rimuovendo gli elementi di placeholder
 */
function cleanEditorContent(editorId) {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    
    // Rimuovi elementi placeholder
    const placeholder = editor.querySelector('.placeholder');
    if (placeholder) {
        placeholder.remove();
    }
}

/**
 * Attiva/disattiva il pulsante di submit
 */
function toggleSubmitButton(enabled) {
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = !enabled;
        
        if (enabled) {
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Salva Allenamento';
            submitBtn.classList.remove('btn-disabled');
        } else {
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';
            submitBtn.classList.add('btn-disabled');
        }
    }
}

/**
 * Esegue controlli iniziali sulla pagina
 */
function performInitialChecks() {
    console.log('Esecuzione controlli iniziali');
    
    // Verifica che il client Supabase sia disponibile
    if (!window.supabaseClient) {
        console.error('Attenzione: Client Supabase non disponibile');
    }
    
    // Verifica che tutti gli elementi richiesti siano presenti
    const requiredElements = ['workoutName', 'activityType', 'duration', 'difficulty', 'objective'];
    const missingElements = requiredElements.filter(id => !document.getElementById(id));
    
    if (missingElements.length > 0) {
        console.error('Elementi mancanti nel DOM:', missingElements.join(', '));
    }
    
    // Verifica che gli editor di testo siano presenti
    const editorIds = ['warmup', 'mainPhase', 'cooldown', 'notes'];
    const missingEditors = editorIds.filter(id => !document.getElementById(id));
    
    if (missingEditors.length > 0) {
        console.error('Editor di testo mancanti:', missingEditors.join(', '));
    }
}