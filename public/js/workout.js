// Mappa dei tipi di attività alle icone
const activityIcons = {
  'nuoto': 'fa-person-swimming',
  'corsa': 'fa-running',
  'ciclismo': 'fa-bicycle',
  'palestra': 'fa-dumbbell',
  'calcio': 'fa-futbol',
  'basket': 'fa-basketball',
  'tennis': 'fa-table-tennis-paddle-ball',
  'yoga': 'fa-om',
  'default': 'fa-dumbbell'
};

// Mappatura degli UUID delle attività (usa i valori corretti dal tuo database)
const activityUuids = {
  '1': '3f7314b5-9b4e-4375-bff3-f233ffe8dccf', // Corsa
  '2': '2ba50271-cd8c-4b87-8fd2-8c6d15af9078', // Ciclismo
  '3': 'a357e277-6beb-4ad2-9020-22c644524ba1', // Nuoto
  '4': '51736ec0-779f-48e8-a4d7-87cb230f841a', // Forza
  '5': '8deb591f-d67c-4e63-ad48-beb755814068'  // Yoga
};

// Mappatura inversa degli UUID per le visualizzazioni
const uuidToActivityMap = {
  '3f7314b5-9b4e-4375-bff3-f233ffe8dccf': 1, // Corsa
  '2ba50271-cd8c-4b87-8fd2-8c6d15af9078': 2, // Ciclismo
  'a357e277-6beb-4ad2-9020-22c644524ba1': 3, // Nuoto
  '51736ec0-779f-48e8-a4d7-87cb230f841a': 4, // Forza
  '8deb591f-d67c-4e63-ad48-beb755814068': 5  // Yoga
};

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM caricato, inizializzazione workout.js');
  
  // Inizializza le funzioni di supporto
  initializeFunctions();
  
  // Verifica se siamo in modalità elenco o modifica
  if (window.location.pathname.includes('/dashboard')) {
    // Siamo nella dashboard, carica gli allenamenti
    loadWorkouts();
  } else {
    // Siamo nella pagina di creazione o modifica
    setupWorkoutForm();
  }
});

// Inizializza le funzioni necessarie
function initializeFunctions() {
  // Definisci getRichTextContent se non esiste
  if (typeof window.getRichTextContent !== 'function') {
    window.getRichTextContent = function(editorId) {
      const editor = document.getElementById(editorId);
      return editor ? editor.innerHTML : '';
    };
  }
  
  // Definisci setRichTextContent se non esiste
  if (typeof window.setRichTextContent !== 'function') {
    window.setRichTextContent = function(editorId, content) {
      const editor = document.getElementById(editorId);
      if (editor) {
        editor.innerHTML = content || '';
      }
    };
  }
  
  // Definisci formatText se non esiste
  if (typeof window.formatText !== 'function') {
    window.formatText = function(command) {
      document.execCommand(command, false, null);
    };
  }
}

// Configura il form per la creazione o modifica di un allenamento
function setupWorkoutForm() {
  console.log('Configurazione del form di allenamento');
  
  // Popola il selettore delle attività
  populateActivityTypes();
  
  // Gestisci il form
  const workoutForm = document.getElementById('workoutForm');
  if (workoutForm) {
    console.log('Form trovato, configurazione listener submit');
    
    workoutForm.addEventListener('submit', function(e) {
      e.preventDefault();
      console.log('Form sottomesso');
      
      // Controlla se siamo in modalità modifica
      const workoutId = new URLSearchParams(window.location.search).get('id');
      if (workoutId) {
        updateWorkout(workoutId);
      } else {
        createNewWorkout();
      }
    });
  } else {
    console.error('Form non trovato nel DOM');
  }
  
  // Se siamo in modalità modifica, carica i dati esistenti
  const workoutId = new URLSearchParams(window.location.search).get('id');
  if (workoutId) {
    loadWorkoutForEditing(workoutId);
  }
}

// Converti l'ID numerico in UUID per l'activity_id
function getActivityUuid(activityId) {
  console.log('Conversione activity_id in UUID:', activityId);
  
  // Se è già un UUID, restituiscilo
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(activityId)) {
    console.log('Già un UUID, lo restituisco direttamente:', activityId);
    return activityId;
  }
  
  // Altrimenti prova a convertirlo usando la mappatura
  const uuid = activityUuids[activityId];
  if (uuid) {
    console.log('UUID trovato nella mappatura:', uuid);
    return uuid;
  }
  
  console.warn('UUID non trovato per activity_id:', activityId);
  return null;
}

// Crea un nuovo allenamento
async function createNewWorkout() {
  console.log('Creazione nuovo allenamento');
  
  try {
    // Verifica Supabase client
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
      throw new Error('Client Supabase non disponibile');
    }
    
    // Verifica autenticazione
    const { data: { session }, error: authError } = await supabaseClient.auth.getSession();
    if (authError || !session) {
      throw new Error('Utente non autenticato');
    }
    
    // Validazione campi
    const workoutName = document.getElementById('workoutName').value.trim();
    const activityTypeValue = document.getElementById('activityType').value;
    const duration = document.getElementById('duration').value;
    
    if (!workoutName) {
      alert('Inserisci un nome per l\'allenamento');
      return;
    }
    
    if (!activityTypeValue) {
      alert('Seleziona un tipo di attività');
      document.getElementById('activityTypeError').textContent = 'Seleziona un tipo di attività';
      return;
    }
    
    if (!duration || parseInt(duration) < 1) {
      alert('Inserisci una durata valida');
      return;
    }
    
    // Converti l'activity_id in UUID
    const activityUuid = getActivityUuid(activityTypeValue);
    if (!activityUuid) {
      alert('Errore nella conversione dell\'ID attività. Ricarica la pagina e riprova.');
      return;
    }
    
    // Prepara i dati
    const workoutData = {
      name: workoutName,
      activity_id: activityUuid, // UUID invece di numero intero
      total_duration: parseInt(duration),
      difficulty: document.getElementById('difficulty').value,
      objective: document.getElementById('objective').value.trim(),
      user_id: session.user.id,
      created_at: new Date().toISOString()
      // Non includere updated_at perché non esiste nella tabella
    };
    
    // Aggiungi contenuti delle fasi
    workoutData.warmup = getRichTextContent('warmup');
    workoutData.main_phase = getRichTextContent('mainPhase');
    workoutData.cooldown = getRichTextContent('cooldown');
    workoutData.notes = getRichTextContent('notes');
    
    console.log('Dati allenamento:', workoutData);
    
    // Invia a Supabase
    const { data, error } = await supabaseClient
      .from('workout_plans')
      .insert([workoutData]);
      
    if (error) {
      throw error;
    }
    
    alert('Allenamento salvato con successo!');
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 1500);
    
  } catch (error) {
    console.error('Errore durante il salvataggio:', error);
    alert('Errore: ' + error.message);
  }
}

// Popola il dropdown dei tipi di attività
function populateActivityTypes() {
  const activityTypeSelect = document.getElementById('activityType');
  if (!activityTypeSelect) {
    console.warn('Selettore attività non trovato');
    return;
  }
  
  console.log('Popolamento selettore attività');
  
  // Resetta il selettore prima di popolarlo
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
    // Usa direttamente l'UUID come valore
    option.value = activityUuids[activity.id.toString()];
    option.textContent = activity.name;
    option.dataset.originalId = activity.id; // Salva l'ID originale come data-attribute
    activityTypeSelect.appendChild(option);
  });
}

// Carica le informazioni di un allenamento esistente per la modifica
async function loadWorkoutForEditing(workoutId) {
  console.log('Caricamento allenamento per modifica, ID:', workoutId);
  
  try {
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
      throw new Error('Client Supabase non disponibile');
    }
    
    const { data, error } = await supabaseClient
      .from('workout_plans')
      .select('*')
      .eq('id', workoutId)
      .single();
      
    if (error) throw error;
    
    if (!data) {
      throw new Error('Allenamento non trovato');
    }
    
    console.log('Dati allenamento caricati:', data);
    
    // Popola il form con i dati
    document.getElementById('workoutName').value = data.name || '';
    
    // Gestisci l'activity_id correttamente (potrebbe essere un UUID)
    const activityTypeSelect = document.getElementById('activityType');
    if (activityTypeSelect) {
      // Trova l'opzione con il valore UUID corrispondente
      const options = Array.from(activityTypeSelect.options);
      const matchingOption = options.find(option => option.value === data.activity_id);
      
      if (matchingOption) {
        matchingOption.selected = true;
      } else {
        console.warn('Opzione per activity_id non trovata:', data.activity_id);
      }
    }
    
    // Formatta la durata
    if (typeof data.total_duration === 'string' && data.total_duration.includes(':')) {
      // Se è in formato HH:MM:SS, converti in minuti
      const parts = data.total_duration.split(':');
      const minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      document.getElementById('duration').value = minutes;
    } else {
      document.getElementById('duration').value = data.total_duration || '';
    }
    
    document.getElementById('difficulty').value = data.difficulty || 'intermedio';
    document.getElementById('objective').value = data.objective || '';
    
    // Imposta il contenuto degli editor di testo
    setRichTextContent('warmup', data.warmup || '');
    setRichTextContent('mainPhase', data.main_phase || '');
    setRichTextContent('cooldown', data.cooldown || '');
    setRichTextContent('notes', data.notes || '');
    
    // Aggiorna il titolo della pagina
    document.querySelector('.navbar-brand').innerHTML = '<i class="fas fa-dumbbell mr-2"></i> Modifica Allenamento';
    
    // Aggiorna il pulsante di salvataggio
    const saveBtn = document.querySelector('button[type="submit"]');
    if (saveBtn) {
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Aggiorna Allenamento';
    }
    
  } catch (error) {
    console.error('Errore durante il caricamento:', error);
    alert('Errore nel caricamento dell\'allenamento: ' + error.message);
  }
}

// Aggiorna un allenamento esistente
async function updateWorkout(workoutId) {
  console.log('Aggiornamento allenamento, ID:', workoutId);
  
  try {
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
      throw new Error('Client Supabase non disponibile');
    }
    
    // Validazione campi
    const workoutName = document.getElementById('workoutName').value.trim();
    const activityTypeValue = document.getElementById('activityType').value;
    const duration = document.getElementById('duration').value;
    
    if (!workoutName) {
      alert('Inserisci un nome per l\'allenamento');
      return;
    }
    
    if (!activityTypeValue) {
      alert('Seleziona un tipo di attività');
      document.getElementById('activityTypeError').textContent = 'Seleziona un tipo di attività';
      return;
    }
    
    if (!duration || parseInt(duration) < 1) {
      alert('Inserisci una durata valida');
      return;
    }
    
    // Verifica l'UUID dell'attività
    const activityUuid = activityTypeValue; // Già un UUID dal selettore
    
    // Prepara i dati
    const workoutData = {
      name: workoutName,
      activity_id: activityUuid,
      total_duration: parseInt(duration),
      difficulty: document.getElementById('difficulty').value,
      objective: document.getElementById('objective').value.trim()
      // Non includere updated_at perché non esiste nella tabella
    };
    
    // Aggiungi contenuti delle fasi
    workoutData.warmup = getRichTextContent('warmup');
    workoutData.main_phase = getRichTextContent('mainPhase');
    workoutData.cooldown = getRichTextContent('cooldown');
    workoutData.notes = getRichTextContent('notes');
    
    console.log('Dati aggiornamento:', workoutData);
    
    // Invia a Supabase
    const { data, error } = await supabaseClient
      .from('workout_plans')
      .update(workoutData)
      .eq('id', workoutId);
      
    if (error) {
      throw error;
    }
    
    alert('Allenamento aggiornato con successo!');
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 1500);
    
  } catch (error) {
    console.error('Errore durante l\'aggiornamento:', error);
    alert('Errore: ' + error.message);
  }
}

// Carica gli allenamenti per visualizzarli nella dashboard
async function loadWorkouts() {
  console.log('Caricamento elenco allenamenti');
  
  try {
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
      throw new Error('Client Supabase non disponibile');
    }
    
    // Verifica autenticazione
    const { data: { session }, error: authError } = await supabaseClient.auth.getSession();
    if (authError || !session) {
      throw new Error('Utente non autenticato');
    }
    
    // Carica gli allenamenti dell'utente
    const { data, error } = await supabaseClient
      .from('workout_plans')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    // Visualizza gli allenamenti
    displayWorkouts(data || []);
    
  } catch (error) {
    console.error('Errore durante il caricamento degli allenamenti:', error);
    showError('Errore: ' + error.message);
  }
}

// Visualizza gli allenamenti nella dashboard
function displayWorkouts(workouts) {
  const container = document.getElementById('workout-list');
  if (!container) {
    console.warn('Container workout-list non trovato nella pagina');
    return;
  }
  
  console.log('Visualizzazione di', workouts.length, 'allenamenti');
  
  // Svuota il contenitore
  container.innerHTML = '';
  
  if (workouts.length === 0) {
    container.innerHTML = '<div class="no-workouts">Nessun allenamento trovato. Crea il tuo primo allenamento!</div>';
    return;
  }
  
  // Crea una card per ogni allenamento
  workouts.forEach(workout => {
    const workoutCard = document.createElement('div');
    workoutCard.className = 'workout-card';
    workoutCard.dataset.id = workout.id;
    
    // Determina l'icona in base al tipo di attività (UUID)
    const iconClass = getWorkoutIconByUuid(workout.activity_id);
    
    workoutCard.innerHTML = `
      <div class="workout-header">
        <h3>${workout.name || 'Allenamento senza nome'}</h3>
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
        <button class="btn btn-view" onclick="viewWorkout('${workout.id}')">
          <i class="fas fa-eye"></i> Visualizza
        </button>
        <button class="btn btn-edit" onclick="editWorkout('${workout.id}')">
          <i class="fas fa-edit"></i> Modifica
        </button>
        <button class="btn btn-delete" onclick="deleteWorkout('${workout.id}')">
          <i class="fas fa-trash"></i> Elimina
        </button>
      </div>
    `;
    
    container.appendChild(workoutCard);
  });
}

// Formatta la durata in modo leggibile
function formatDuration(duration) {
  if (typeof duration === 'string' && duration.includes(':')) {
    // Se è in formato HH:MM:SS, converti in minuti
    const parts = duration.split(':');
    const minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    return `${minutes} minuti`;
  }
  
  return `${duration || 0} minuti`;
}

// Restituisce la classe dell'icona in base all'UUID dell'attività
function getWorkoutIconByUuid(activityUuid) {
  // Mappatura degli UUID agli ID numerici
  const numericId = uuidToActivityMap[activityUuid];
  
  // Mappatura degli ID numerici alle icone
  const iconMap = {
    1: 'fa-running',
    2: 'fa-bicycle',
    3: 'fa-person-swimming',
    4: 'fa-dumbbell',
    5: 'fa-om',
    'default': 'fa-dumbbell'
  };
  
  return iconMap[numericId] || iconMap.default;
}

// Visualizza un allenamento
function viewWorkout(id) {
  window.location.href = `/workout-details?id=${id}`;
}

// Modifica un allenamento
function editWorkout(id) {
  window.location.href = `/workout?id=${id}`;
}

// Elimina un allenamento
async function deleteWorkout(id) {
  if (confirm('Sei sicuro di voler eliminare questo allenamento?')) {
    try {
      const supabaseClient = window.supabaseClient;
      if (!supabaseClient) {
        throw new Error('Client Supabase non disponibile');
      }
      
      const { error } = await supabaseClient
        .from('workout_plans')
        .delete()
        .eq('id', id);
        
      if (error) throw error;
      
      // Rimuovi la card dal DOM
      const workoutCard = document.querySelector(`.workout-card[data-id="${id}"]`);
      if (workoutCard) {
        workoutCard.remove();
      }
      
      alert('Allenamento eliminato con successo');
      
      // Ricarica gli allenamenti se necessario
      if (document.querySelectorAll('.workout-card').length === 0) {
        loadWorkouts();
      }
      
    } catch (error) {
      console.error('Errore durante l\'eliminazione:', error);
      alert('Errore: ' + error.message);
    }
  }
}

// Mostra un messaggio di errore
function showError(message) {
  alert(message);
}

// Esponi funzioni per l'HTML
window.editWorkout = editWorkout;
window.viewWorkout = viewWorkout;
window.deleteWorkout = deleteWorkout;