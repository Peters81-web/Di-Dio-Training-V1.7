// DiDio Training App - Profile Enhanced Script
document.addEventListener('DOMContentLoaded', async () => {
    // Variabili globali
    let supabaseClient;
    let currentUser = null;
    let currentProfile = null;
    let cropper = null;
    let specificGoals = [];
    let weightChartInstance = null;
    let userPreferences = {
        distanceUnit: 'km',
        weightUnit: 'kg',
        weekStartDay: '1',
        calorieCalculation: 'auto'
    };
  
    // Gestore di errori globale per promesse non gestite
    window.addEventListener('unhandledrejection', function(event) {
      console.error('Promessa non gestita:', event.reason);
      showToast('Si è verificato un errore: ' + (event.reason.message || 'Errore sconosciuto'), 'error');
    });
  
    // Inizializzazione dell'app
    async function initialize() {
      try {
        // Inizializza Supabase
        initializeSupabase();
        
        // Carica il profilo dalla cache se disponibile
        loadCachedProfile();
        
        // Verifica autenticazione (operazione bloccante)
        const authResult = await checkAuth();
        if (!authResult) {
          console.error('Autenticazione fallita o utente non disponibile');
          return;
        }
        
        // Inizializza il profilo
        await initProfile();
      } catch (error) {
        console.error('Errore durante l\'inizializzazione dell\'app:', error);
        showToast('Errore durante l\'avvio dell\'applicazione', 'error');
      }
    }
  
    // Inizializzazione di Supabase
    function initializeSupabase() {
      try {
        // Prova prima ad usare direttamente window.supabaseClient
        if (window.supabaseClient) {
          supabaseClient = window.supabaseClient;
          console.log('Usando window.supabaseClient esistente');
        } else {
          // Fallback al metodo createSupabaseClient
          supabaseClient = createSupabaseClient();
          console.log('Usando createSupabaseClient() come fallback');
        }
        
        // Verifica che il client sia valido
        if (!supabaseClient) {
          throw new Error('Impossibile inizializzare il client Supabase');
        }
      } catch (error) {
        console.error('Errore nell\'inizializzazione di Supabase:', error);
        showToast('Errore di connessione al database', 'error');
      }
    }
  
    // Carica il profilo dalla cache se disponibile
    function loadCachedProfile() {
      const cachedProfile = localStorage.getItem('userProfile');
      if (cachedProfile) {
        try {
          const parsedProfile = JSON.parse(cachedProfile);
          currentProfile = parsedProfile;
          // Aggiorna l'UI con i dati in cache
          updateUIWithUserData();
          console.log('Profilo caricato dalla cache:', parsedProfile);
        } catch (error) {
          console.error('Errore nel parsing del profilo in cache:', error);
          localStorage.removeItem('userProfile');
        }
      }
    }
  
    // ===== AUTENTICAZIONE =====
    async function checkAuth() {
      try {
        console.log('Verifico autenticazione...');
        
        if (!supabaseClient || !supabaseClient.auth) {
          console.error('Client Supabase non inizializzato correttamente');
          window.location.href = '/';
          return false;
        }
        
        const { data, error } = await supabaseClient.auth.getUser();
        
        console.log('Risposta auth.getUser():', data);
        
        if (error) {
          console.error('Errore di autenticazione:', error.message);
          window.location.href = '/';
          return false;
        }
        
        if (!data || !data.user) {
          console.error('Utente non trovato nella risposta di autenticazione');
          window.location.href = '/';
          return false;
        }
        
        // Imposta correttamente currentUser
        currentUser = data.user;
        console.log('Utente autenticato:', currentUser);
        return true;
      } catch (error) {
        console.error('Errore durante il controllo dell\'autenticazione:', error);
        window.location.href = '/';
        return false;
      }
    }
  
    // ===== INIZIALIZZAZIONE PROFILO =====
    async function initProfile() {
      try {
        // Verifica che currentUser sia impostato
        if (!currentUser) {
          console.error('Utente non autenticato');
          return;
        }
        
        console.log('ID utente corrente:', currentUser.id);
        
        // Carica i dati del profilo
        await loadUserProfile();
        
        // Carica le misure corporee
        await loadBodyMeasurements();
        
        // Carica gli obiettivi specifici
        await loadSpecificGoals();
        
        // Carica le statistiche di allenamento
        await loadWorkoutStats();
        
        // Imposta gli event listener
        setupEventListeners();
        
        // Inizializza i grafici
        initCharts();
        
        // Aggiorna la UI con i dati caricati
        updateUIWithUserData();
      } catch (error) {
        console.error('Errore nell\'inizializzazione del profilo:', error);
        showToast('Si è verificato un errore nel caricamento del profilo', 'error');
      }
    }
  
    // ===== CARICAMENTO DATI PROFILO =====
    async function loadUserProfile() {
      if (!currentUser || !currentUser.id) {
        console.error('loadUserProfile: currentUser non definito o senza ID');
        return;
      }
      
      try {
        console.log("Query Supabase profiles:", {
          operation: 'select',
          params: { id: currentUser.id }
        });
        
        // Carica i dati del profilo da Supabase
        const { data: profile, error } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        
        console.log("Profilo caricato:", { profile, error });
        
        if (error && error.code !== 'PGRST116') {
          throw error;
        }
        
        // Se il profilo non esiste, creane uno nuovo
        if (!profile) {
          // Crea un nuovo profilo
          const newProfile = {
            id: currentUser.id,  // Usa l'ID utente come chiave primaria
            user_id: currentUser.id,  // Aggiungi anche questo campo per compatibilità
            username: currentUser.user_metadata?.username || '',
            full_name: '',
            birthdate: null,
            gender: '',
            location: '',
            bio: '',
            avatar_url: null,
            preferences: userPreferences,
            fitness_goals: {
              primary_goal: 'overall_health',
              target_weight: null,
              weekly_workouts: 3,
              description: ''
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          console.log("Creazione nuovo profilo:", newProfile);
          
          // Inserisci il nuovo profilo nel database
          const { data: insertedProfile, error: insertError } = await supabaseClient
            .from('profiles')
            .insert([newProfile])
            .select();
          
          if (insertError) {
            console.error("Errore inserimento profilo:", insertError);
            throw insertError;
          }
          
          console.log("Profilo inserito:", insertedProfile);
          currentProfile = insertedProfile?.[0] || newProfile;
        } else {
          currentProfile = profile;
          
          // Assicurati che le preferenze abbiano tutti i campi necessari
          if (!currentProfile.preferences) {
            currentProfile.preferences = userPreferences;
          } else {
            // Merge con i valori di default
            currentProfile.preferences = {
              ...userPreferences,
              ...currentProfile.preferences
            };
          }
          
          // Assicurati che gli obiettivi abbiano tutti i campi necessari
          if (!currentProfile.fitness_goals) {
            currentProfile.fitness_goals = {
              primary_goal: 'overall_health',
              target_weight: null,
              weekly_workouts: 3,
              description: ''
            };
          }
        }
        
        // Salva il profilo nella cache locale
        localStorage.setItem('userProfile', JSON.stringify(currentProfile));
        
        // Salva le preferenze dell'utente
        userPreferences = currentProfile.preferences || userPreferences;
        
        console.log('Profilo caricato completamente:', currentProfile);
      } catch (error) {
        console.error('Errore nel caricamento del profilo:', error);
        showToast('Errore nel caricamento del profilo', 'error');
      }
    }
  
    // ===== CARICAMENTO MISURE CORPOREE =====
    async function loadBodyMeasurements() {
      if (!currentUser || !currentUser.id) {
        console.error('loadBodyMeasurements: currentUser non definito o senza ID');
        return;
      }
      
      try {
        const { data: measurements, error } = await supabaseClient
          .from('body_measurements')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('date', { ascending: false })
          .limit(10);
        
        if (error) {
          throw error;
        }
        
        console.log("Misure caricate:", measurements);
        
        if (measurements && measurements.length > 0) {
          // Usa le misure più recenti per popolare il form
          const latestMeasurement = measurements[0];
          
          const heightInput = document.getElementById('height');
          const weightInput = document.getElementById('weight');
          const bodyFatInput = document.getElementById('bodyFat');
          const muscleMassInput = document.getElementById('muscleMass');
          
          if (heightInput) heightInput.value = latestMeasurement.height || '';
          if (weightInput) weightInput.value = latestMeasurement.weight || '';
          if (bodyFatInput) bodyFatInput.value = latestMeasurement.body_fat || '';
          if (muscleMassInput) muscleMassInput.value = latestMeasurement.muscle_mass || '';
          
          // Prepara i dati per il grafico
          const chartData = prepareMeasurementsChartData(measurements);
          updateWeightChart(chartData);
        }
      } catch (error) {
        console.error('Errore nel caricamento delle misure corporee:', error);
        showToast('Errore nel caricamento delle misure', 'error');
      }
    }
  
    // ===== CARICAMENTO OBIETTIVI SPECIFICI =====
    async function loadSpecificGoals() {
      if (!currentUser || !currentUser.id) {
        console.error('loadSpecificGoals: currentUser non definito o senza ID');
        return;
      }
      
      try {
        const { data: goals, error } = await supabaseClient
          .from('specific_goals')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });
        
        if (error) {
          throw error;
        }
        
        specificGoals = goals || [];
        renderSpecificGoals();
      } catch (error) {
        console.error('Errore nel caricamento degli obiettivi specifici:', error);
        showToast('Errore nel caricamento degli obiettivi', 'error');
      }
    }
  
    // ===== CARICAMENTO STATISTICHE ALLENAMENTO =====
    async function loadWorkoutStats() {
      if (!currentUser || !currentUser.id) {
        console.error('loadWorkoutStats: currentUser non definito o senza ID');
        return;
      }
      
      try {
        const { data: workouts, error } = await supabaseClient
          .from('completed_workouts')
          .select(`
            *,
            workout_plans(
              name,
              activities(name)
            )
          `)
          .eq('user_id', currentUser.id)
          .order('completed_at', { ascending: false });
        
        if (error) {
          throw error;
        }
        
        updateStatsUI(workouts || []);
        renderRecentActivities(workouts || []);
      } catch (error) {
        console.error('Errore nel caricamento delle statistiche di allenamento:', error);
        showToast('Errore nel caricamento delle statistiche', 'error');
      }
    }
  
    // ===== AGGIORNAMENTO UI =====
    function updateUIWithUserData() {
      if (!currentProfile) {
        console.warn('updateUIWithUserData: currentProfile non definito');
        return;
      }
      
      // Aggiorna i campi del profilo
      const displayUsernameEl = document.getElementById('displayUsername');
      const displayEmailEl = document.getElementById('displayEmail');
      const memberSinceEl = document.getElementById('memberSince');
      const profileImageEl = document.getElementById('profileImage');
      
      if (displayUsernameEl) displayUsernameEl.textContent = currentProfile.username || 'Nome Utente';
      if (displayEmailEl && currentUser) displayEmailEl.textContent = currentUser.email || '';
      
      // Data di registrazione
      if (memberSinceEl && currentUser) {
        const memberSince = new Date(currentUser.created_at || currentProfile.created_at);
        const formattedDate = memberSince.toLocaleDateString('it-IT', { 
          year: 'numeric', 
          month: 'long' 
        });
        memberSinceEl.innerHTML = `Membro dal: <span>${formattedDate}</span>`;
      }
      
      // Immagine profilo
      if (profileImageEl && currentProfile.avatar_url) {
        profileImageEl.src = currentProfile.avatar_url;
      }
      
      // Form informazioni personali
      const usernameInput = document.getElementById('username');
      const fullNameInput = document.getElementById('fullName');
      const birthdateInput = document.getElementById('birthdate');
      const genderInput = document.getElementById('gender');
      const locationInput = document.getElementById('location');
      const bioInput = document.getElementById('bio');
      
      if (usernameInput) usernameInput.value = currentProfile.username || '';
      if (fullNameInput) fullNameInput.value = currentProfile.full_name || '';
      if (birthdateInput) birthdateInput.value = currentProfile.birthdate || '';
      if (genderInput) genderInput.value = currentProfile.gender || '';
      if (locationInput) locationInput.value = currentProfile.location || '';
      if (bioInput) bioInput.value = currentProfile.bio || '';
      
      // Form preferenze
      if (currentProfile.preferences) {
        const distanceUnitInput = document.getElementById('distanceUnit');
        const weightUnitInput = document.getElementById('weightUnit');
        const weekStartDayInput = document.getElementById('weekStartDay');
        const calorieCalculationInput = document.getElementById('calorieCalculation');
        const emailNotificationsInput = document.getElementById('emailNotifications');
        const workoutRemindersInput = document.getElementById('workoutReminders');
        const progressUpdatesInput = document.getElementById('progressUpdates');
        
        if (distanceUnitInput) distanceUnitInput.value = currentProfile.preferences.distanceUnit || 'km';
        if (weightUnitInput) weightUnitInput.value = currentProfile.preferences.weightUnit || 'kg';
        if (weekStartDayInput) weekStartDayInput.value = currentProfile.preferences.weekStartDay || '1';
        if (calorieCalculationInput) calorieCalculationInput.value = currentProfile.preferences.calorieCalculation || 'auto';
        
        // Notifiche
        if (emailNotificationsInput) emailNotificationsInput.checked = currentProfile.preferences.emailNotifications !== false;
        if (workoutRemindersInput) workoutRemindersInput.checked = currentProfile.preferences.workoutReminders !== false;
        if (progressUpdatesInput) progressUpdatesInput.checked = currentProfile.preferences.progressUpdates !== false;
      }
      
      // Form obiettivi di fitness
      if (currentProfile.fitness_goals) {
        const primaryGoalInput = document.getElementById('primaryGoal');
        const targetWeightInput = document.getElementById('targetWeight');
        const weeklyWorkoutsInput = document.getElementById('weeklyWorkouts');
        const goalDescriptionInput = document.getElementById('goalDescription');
        
        if (primaryGoalInput) primaryGoalInput.value = currentProfile.fitness_goals.primary_goal || 'overall_health';
        if (targetWeightInput) targetWeightInput.value = currentProfile.fitness_goals.target_weight || '';
        if (weeklyWorkoutsInput) weeklyWorkoutsInput.value = currentProfile.fitness_goals.weekly_workouts || 3;
        if (goalDescriptionInput) goalDescriptionInput.value = currentProfile.fitness_goals.description || '';
      }
      
      // Aggiorna le unità di misura visualizzate
      updateUnitLabels();
    }
    
    function updateUnitLabels() {
      if (!currentProfile || !currentProfile.preferences) {
        return;
      }
      
      // Aggiorna le etichette delle unità di misura
      const weightUnit = currentProfile.preferences.weightUnit || 'kg';
      const distanceUnit = currentProfile.preferences.distanceUnit || 'km';
      
      // Seleziona tutti gli elementi con classe weight-unit
      document.querySelectorAll('.weight-unit').forEach(el => {
        el.textContent = weightUnit;
      });
      
      // Seleziona tutti gli elementi con classe distance-unit
      document.querySelectorAll('.distance-unit').forEach(el => {
        el.textContent = distanceUnit;
      });
      
      // Specifica per height-unit (cm o inches)
      document.querySelectorAll('.height-unit').forEach(el => {
        el.textContent = weightUnit === 'kg' ? 'cm' : 'in';
      });
    }
    
    function updateStatsUI(workouts) {
      // Aggiorna le statistiche mostrate
      const totalWorkoutsEl = document.getElementById('totalWorkouts');
      const monthlyWorkoutsEl = document.getElementById('monthlyWorkouts');
      const favoriteActivityEl = document.getElementById('favoriteActivity');
      const totalTimeEl = document.getElementById('totalTime');
      
      if (!totalWorkoutsEl || !monthlyWorkoutsEl || !favoriteActivityEl || !totalTimeEl) {
        return;
      }
      
      totalWorkoutsEl.textContent = workouts.length;
      
      // Calcola allenamenti questo mese
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      const monthlyWorkouts = workouts.filter(workout => {
        const workoutDate = new Date(workout.completed_at);
        return workoutDate.getMonth() === currentMonth && 
               workoutDate.getFullYear() === currentYear;
      }).length;
      
      monthlyWorkoutsEl.textContent = monthlyWorkouts;
      
      // Calcola attività preferita
      favoriteActivityEl.textContent = getFavoriteActivity(workouts);
      
      // Calcola tempo totale
      const totalMinutes = workouts.reduce((total, workout) => {
        return total + (workout.actual_duration || 0);
      }, 0);
      
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      totalTimeEl.textContent = hours > 0 
        ? `${hours}h ${minutes}m` 
        : `${minutes}m`;
    }
    
    function renderRecentActivities(workouts) {
      if (!currentProfile) return;
      
      const activitiesContainer = document.getElementById('recentActivitiesList');
      
      if (!activitiesContainer) return;
      
      if (!workouts || workouts.length === 0) {
        activitiesContainer.innerHTML = '<p>Nessuna attività recente</p>';
        return;
      }
      
      // Prendi solo le prime 5 attività
      const recentWorkouts = workouts.slice(0, 5);
      
      const distanceUnit = currentProfile.preferences?.weightUnit === 'kg' ? 'km' : 'mi';
      
      const activitiesHTML = recentWorkouts.map(workout => {
        const workoutDate = new Date(workout.completed_at);
        const formattedDate = workoutDate.toLocaleDateString('it-IT', {
          day: '2-digit',
          month: '2-digit'
        });
        
        // Converti la distanza se necessario
        let distance = workout.distance || 0;
        let displayDistance = '';
        
        if (distance > 0) {
          if (distanceUnit === 'mi' && currentProfile.preferences?.distanceUnit === 'km') {
            // Converti km a miglia (1 km = 0.621371 mi)
            distance = distance * 0.621371;
          } else if (distanceUnit === 'km' && currentProfile.preferences?.distanceUnit === 'mi') {
            // Converti miglia a km (1 mi = 1.60934 km)
            distance = distance * 1.60934;
          }
          
          displayDistance = `${distance.toFixed(1)} ${distanceUnit}`;
        }
        
        return `
          <div class="activity-item">
            <div class="activity-header">
              <span class="activity-name">${workout.workout_plans?.name || 'Allenamento'}</span>
              <span class="activity-date">${formattedDate}</span>
            </div>
            <div class="activity-details">
              <span class="activity-type">${workout.workout_plans?.activities?.name || 'Attività'}</span>
              <span class="activity-duration">${workout.actual_duration || 0} min</span>
              ${distance > 0 ? `<span class="activity-distance">${displayDistance}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
      
      activitiesContainer.innerHTML = `<div class="activities-list">${activitiesHTML}</div>`;
    }
    
    function renderSpecificGoals() {
      const goalsContainer = document.getElementById('specificGoalsList');
      
      if (!goalsContainer) return;
      
      if (!specificGoals || specificGoals.length === 0) {
        goalsContainer.innerHTML = '';
        return;
      }
      
      const goalsHTML = specificGoals.map(goal => `
        <div class="goal-item" data-goal-id="${goal.id}">
          <div class="goal-content">
            <label class="custom-checkbox">
              <input type="checkbox" ${goal.completed ? 'checked' : ''} onchange="toggleGoalCompletion('${goal.id}')">
              <span class="checkmark"></span>
              <span class="goal-text ${goal.completed ? 'completed' : ''}">${goal.description}</span>
            </label>
          </div>
          <button type="button" class="btn btn-sm btn-danger delete-goal-btn" onclick="deleteGoal('${goal.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `).join('');
      
      goalsContainer.innerHTML = goalsHTML;
    }
    
    // Funzione per preparare i dati per il grafico delle misure
    function prepareMeasurementsChartData(measurements) {
      if (!currentProfile || !currentProfile.preferences) {
        return {
          labels: [],
          datasets: [{
            label: 'Peso (kg)',
            data: [],
            borderColor: '#4361ee',
            backgroundColor: 'rgba(67, 97, 238, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#4361ee'
          }]
        };
      }
      
      // Ordina le misure per data (dalla più vecchia alla più recente)
      const sortedMeasurements = [...measurements].sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      );
      
      const labels = sortedMeasurements.map(m => {
        const date = new Date(m.date);
        return date.toLocaleDateString('it-IT', {
          day: '2-digit',
          month: '2-digit'
        });
      });
      
      // Converti unità se necessario
      const weightUnit = currentProfile.preferences.weightUnit || 'kg';
      
      const weightData = sortedMeasurements.map(m => {
        let weight = m.weight || 0;
        
        // Converti kg a libbre se necessario
        if (weightUnit === 'lb' && weight > 0) {
          weight = weight * 2.20462; // 1 kg = 2.20462 lb
        }
        
        return weight;
      });
      
      return {
        labels,
        datasets: [{
          label: `Peso (${weightUnit})`,
          data: weightData,
          borderColor: '#4361ee',
          backgroundColor: 'rgba(67, 97, 238, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#4361ee'
        }]
      };
    }
    
    // ===== FUNZIONI PER I GRAFICI =====
    function initCharts() {
      const ctx = document.getElementById('weightProgressChart');
      
      if (!ctx) {
        console.warn('Canvas element for weight chart not found');
        return;
      }
      
      // Prima di tentare di usare il canvas, verifica che il contesto sia disponibile
      try {
        const context = ctx.getContext('2d');
        if (!context) {
          console.error('Impossibile ottenere il contesto 2D dal canvas');
          return;
        }
        
        // Se esiste già un'istanza del grafico, distruggila prima di crearne una nuova
        if (weightChartInstance) {
          weightChartInstance.destroy();
        }
        
        // Imposta l'unità di peso corretta
        const weightUnit = currentProfile?.preferences?.weightUnit || 'kg';
        
        // Crea un grafico vuoto
        weightChartInstance = new Chart(ctx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              label: `Peso (${weightUnit})`,
              data: [],
              borderColor: '#4361ee',
              backgroundColor: 'rgba(67, 97, 238, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: '#4361ee'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
              },
              tooltip: {
                mode: 'index',
                intersect: false
              }
            },
            scales: {
              x: {
                display: true,
                title: {
                  display: true,
                  text: 'Data'
                }
              },
              y: {
                display: true,
                title: {
                  display: true,
                  text: `Peso (${weightUnit})`
                },
                beginAtZero: false
              }
            }
          }
        });
      } catch (error) {
        console.error('Errore nella creazione del grafico:', error);
      }
    }
    
    function updateWeightChart(data) {
      if (!weightChartInstance) return;
      
      try {
        weightChartInstance.data.labels = data.labels;
        weightChartInstance.data.datasets[0].data = data.datasets[0].data;
        weightChartInstance.data.datasets[0].label = data.datasets[0].label;
        
        // Aggiorna il titolo dell'asse Y
        const weightUnit = currentProfile?.preferences?.weightUnit || 'kg';
        weightChartInstance.options.scales.y.title.text = `Peso (${weightUnit})`;
        
        weightChartInstance.update();
      } catch (error) {
        console.error('Errore nell\'aggiornamento del grafico:', error);
      }
    }
    
    // ===== FUNZIONI DI UTILITÀ =====
    function getFavoriteActivity(workouts) {
      if (!workouts || workouts.length === 0) {
        return 'Nessuna';
      }
      
      const activityCounts = {};
      
      workouts.forEach(workout => {
        const activityName = workout.workout_plans?.activities?.name;
        if (!activityName) return;
        
        activityCounts[activityName] = (activityCounts[activityName] || 0) + 1;
      });
      
      if (Object.keys(activityCounts).length === 0) {
        return 'Nessuna';
      }
      
      // Trova l'attività con il conteggio più alto
      return Object.entries(activityCounts)
        .sort((a, b) => b[1] - a[1])[0][0];
    }
    
    // ===== GESTIONE FOTO PROFILO =====
    function setupProfilePhotoHandler() {
      const profilePhotoDisplay = document.getElementById('profilePhotoDisplay');
      const profilePhotoInput = document.getElementById('profilePhotoInput');
      const photoCropModal = document.getElementById('photoCropModal');
      const cropArea = document.getElementById('cropArea');
      const saveCropBtn = document.getElementById('saveCropBtn');
      const cancelCropBtn = document.getElementById('cancelCropBtn');
      const closeCropModalBtn = document.getElementById('closeCropModalBtn');
      const changePhotoOverlay = document.getElementById('changePhotoOverlay');
      
      if (!profilePhotoDisplay || !profilePhotoInput || !photoCropModal || 
          !cropArea || !saveCropBtn || !cancelCropBtn || 
          !closeCropModalBtn || !changePhotoOverlay) {
        console.warn('Elementi per gestione foto profilo non trovati');
        return;
      }
      
      // Click sulla foto per aprire il selettore di file
      changePhotoOverlay.addEventListener('click', () => {
        profilePhotoInput.click();
      });
      
      // Gestione dell'upload della foto
      profilePhotoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (e) => {
            // Mostra la modal per il ritaglio
          photoCropModal.style.display = 'flex';
          
          // Crea o ripulisci il contenitore per il crop
          cropArea.innerHTML = '';
          const img = document.createElement('img');
          img.id = 'cropImage';
          img.src = e.target.result;
          cropArea.appendChild(img);
          
          // Inizializza cropper.js
          if (cropper) {
            cropper.destroy();
          }
          
          try {
            cropper = new Cropper(img, {
              aspectRatio: 1, // Rapporto 1:1 per una foto profilo rotonda
              viewMode: 1,
              dragMode: 'move',
              autoCropArea: 0.8,
              responsive: true,
              restore: false,
              guides: true,
              center: true,
              highlight: false,
              cropBoxMovable: true,
              cropBoxResizable: true,
              toggleDragModeOnDblclick: false
            });
          } catch (error) {
            console.error('Errore nell\'inizializzazione del cropper:', error);
            showToast('Errore nella preparazione dell\'immagine', 'error');
          }
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    });
    
    // Gestione del pulsante Salva
    saveCropBtn.addEventListener('click', async () => {
      if (!cropper) return;
      
      try {
        // Ottieni l'immagine ritagliata
        const canvas = cropper.getCroppedCanvas({
          width: 300,
          height: 300,
          fillColor: '#fff',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });
        
        // Converti in blob
        canvas.toBlob(async (blob) => {
          try {
            const loading = showLoading();
            
            // Upload al bucket Storage di Supabase
            const avatarFileName = `${currentUser.id}/avatar.jpg`;
            
            // Assicurati che supabaseClient sia definito
            if (!supabaseClient || !supabaseClient.storage) {
              throw new Error('Client Supabase non inizializzato correttamente');
            }
            
            const { data, error } = await supabaseClient
              .storage
              .from('avatars')
              .upload(avatarFileName, blob, {
                upsert: true,
                contentType: 'image/jpeg'
              });
            
            if (error) {
              throw error;
            }
            
            // Ottieni l'URL pubblico
            const { data: urlData } = supabaseClient
              .storage
              .from('avatars')
              .getPublicUrl(avatarFileName);
            
            const avatarUrl = urlData.publicUrl;
            
            // Aggiorna il profilo con l'URL dell'avatar
            const { error: updateError } = await supabaseClient
              .from('profiles')
              .update({ avatar_url: avatarUrl })
              .eq('id', currentUser.id);
            
            if (updateError) {
              throw updateError;
            }
            
            // Aggiorna l'immagine del profilo nell'UI
            document.getElementById('profileImage').src = avatarUrl;
            
            // Aggiorna il profilo in memoria
            currentProfile.avatar_url = avatarUrl;
            
            // Salva il profilo aggiornato nella cache
            localStorage.setItem('userProfile', JSON.stringify(currentProfile));
            
            // Chiudi la modal
            photoCropModal.style.display = 'none';
            
            // Mostra un messaggio di successo
            showToast('Foto profilo aggiornata con successo', 'success');
            
            hideLoading(loading);
          } catch (error) {
            console.error('Errore nell\'upload della foto:', error);
            showToast('Errore nel salvataggio della foto: ' + error.message, 'error');
            hideLoading();
          }
        }, 'image/jpeg', 0.95);
      } catch (error) {
        console.error('Errore nel ritaglio della foto:', error);
        showToast('Errore nella preparazione della foto', 'error');
      }
    });
    
    // Gestione del pulsante Annulla
    cancelCropBtn.addEventListener('click', () => {
      photoCropModal.style.display = 'none';
      if (cropper) {
        cropper.destroy();
        cropper = null;
      }
    });
    
    // Gestione del pulsante di chiusura della modal
    closeCropModalBtn.addEventListener('click', () => {
      photoCropModal.style.display = 'none';
      if (cropper) {
        cropper.destroy();
        cropper = null;
      }
    });
  }
  
  // ===== GESTIONE FORM SUBMISSIONS =====
  async function setupFormSubmissions() {
    if (!currentUser || !currentUser.id) {
      console.error('setupFormSubmissions: currentUser non definito o senza ID');
      return;
    }
    
    // Form Informazioni Personali
    const personalInfoForm = document.getElementById('personalInfoForm');
    if (personalInfoForm) {
      personalInfoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
          const loading = showLoading();
          
          const formData = {
            id: currentUser.id,  // Usa l'ID utente come chiave primaria
            user_id: currentUser.id,  // Aggiungi anche questo campo per compatibilità
            username: document.getElementById('username').value.trim(),
            full_name: document.getElementById('fullName').value.trim(),
            birthdate: document.getElementById('birthdate').value || null,
            gender: document.getElementById('gender').value,
            location: document.getElementById('location').value.trim(),
            bio: document.getElementById('bio').value.trim(),
            updated_at: new Date().toISOString()
          };
          
          console.log("Dati da salvare:", formData);
          
          // Aggiorna il profilo esistente
          const { data: updatedData, error } = await supabaseClient
            .from('profiles')
            .upsert(formData)
            .select();
          
          if (error) {
            throw error;
          }
          
          console.log("Risultato aggiornamento:", updatedData);
          
          // Aggiorna i dati in memoria
          if (updatedData && updatedData.length > 0) {
            // Mantieni le preferenze e gli obiettivi esistenti
            const updatedProfile = {
              ...currentProfile,
              ...updatedData[0]
            };
            currentProfile = updatedProfile;
            
            // Salva il profilo aggiornato nella cache
            localStorage.setItem('userProfile', JSON.stringify(currentProfile));
          }
          
          // Aggiorna la UI
          const displayUsernameEl = document.getElementById('displayUsername');
          if (displayUsernameEl) {
            displayUsernameEl.textContent = formData.username;
          }
          
          showToast('Informazioni personali aggiornate con successo', 'success');
          hideLoading(loading);
        } catch (error) {
          console.error('Errore nell\'aggiornamento delle informazioni:', error);
          showToast('Errore nell\'aggiornamento delle informazioni: ' + error.message, 'error');
          hideLoading();
        }
      });
    }
    
    // Form Misure Corporee
    const bodyMeasurementsForm = document.getElementById('bodyMeasurementsForm');
    if (bodyMeasurementsForm) {
      bodyMeasurementsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
          const loading = showLoading();
          
          // Ottieni i valori dal form
          let height = parseFloat(document.getElementById('height').value) || null;
          let weight = parseFloat(document.getElementById('weight').value) || null;
          const bodyFat = parseFloat(document.getElementById('bodyFat').value) || null;
          let muscleMass = parseFloat(document.getElementById('muscleMass').value) || null;
          
          // Converti unità se necessario
          const weightUnit = currentProfile.preferences?.weightUnit || 'kg';
          
          if (weightUnit === 'lb') {
            // Converti da libbre a kg per il database
            if (weight) weight = weight / 2.20462;
            if (muscleMass) muscleMass = muscleMass / 2.20462;
            
            // Converti da pollici a cm
            if (height) height = height * 2.54;
          }
          
          // Prepara i dati per il database
          const measurementData = {
            user_id: currentUser.id,
            height,
            weight,
            body_fat: bodyFat,
            muscle_mass: muscleMass,
            date: new Date().toISOString()
          };
          
          // Salva nel database
          const { data, error } = await supabaseClient
            .from('body_measurements')
            .insert([measurementData])
            .select();
          
          if (error) {
            throw error;
          }
          
          // Ricarica le misure
          await loadBodyMeasurements();
          
          showToast('Misure corporee aggiornate con successo', 'success');
          hideLoading(loading);
        } catch (error) {
          console.error('Errore nell\'aggiornamento delle misure:', error);
          showToast('Errore nell\'aggiornamento delle misure: ' + error.message, 'error');
          hideLoading();
        }
      });
    }
    
    // Form Preferenze
    const preferencesForm = document.getElementById('preferencesForm');
    if (preferencesForm) {
      preferencesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
          const loading = showLoading();
          
          // Prendi i valori precedenti per verificare se sono cambiati
          const prevWeightUnit = currentProfile.preferences?.weightUnit || 'kg';
          const prevDistanceUnit = currentProfile.preferences?.distanceUnit || 'km';
          
          // Ottieni i nuovi valori dal form
          const newPreferences = {
            distanceUnit: document.getElementById('distanceUnit').value,
            weightUnit: document.getElementById('weightUnit').value,
            weekStartDay: document.getElementById('weekStartDay').value,
            calorieCalculation: document.getElementById('calorieCalculation').value,
            emailNotifications: document.getElementById('emailNotifications').checked,
            workoutReminders: document.getElementById('workoutReminders').checked,
            progressUpdates: document.getElementById('progressUpdates').checked
          };
          
          // Crea una copia del profilo corrente
          const updatedProfile = { ...currentProfile };
          
          // Aggiorna le preferenze
          updatedProfile.preferences = newPreferences;
          updatedProfile.updated_at = new Date().toISOString();
          
          // Aggiorna il profilo con le nuove preferenze
          const { error } = await supabaseClient
            .from('profiles')
            .update({
              preferences: newPreferences,
              updated_at: updatedProfile.updated_at
            })
            .eq('id', currentUser.id);
          
          if (error) {
            throw error;
          }
          
          // Aggiorna le preferenze in memoria
          currentProfile = updatedProfile;
          userPreferences = newPreferences;
          
          // Salva il profilo aggiornato nella cache
          localStorage.setItem('userProfile', JSON.stringify(currentProfile));
          
          // Aggiorna le etichette delle unità
          updateUnitLabels();
          
          // Se sono cambiate le unità di peso, ricarica le misure e aggiorna il grafico
          if (prevWeightUnit !== newPreferences.weightUnit) {
            await loadBodyMeasurements();
          }
          
          // Se sono cambiate le unità di distanza, ricarica le statistiche di allenamento
          if (prevDistanceUnit !== newPreferences.distanceUnit) {
            await loadWorkoutStats();
          }
          
          showToast('Preferenze aggiornate con successo', 'success');
          hideLoading(loading);
        } catch (error) {
          console.error('Errore nell\'aggiornamento delle preferenze:', error);
          showToast('Errore nell\'aggiornamento delle preferenze: ' + error.message, 'error');
          hideLoading();
        }
      });
    }
    
    // Form Obiettivi Fitness
    const fitnessGoalsForm = document.getElementById('fitnessGoalsForm');
    if (fitnessGoalsForm) {
      fitnessGoalsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
          const loading = showLoading();
          
          // Ottieni i valori dal form
          let targetWeight = parseFloat(document.getElementById('targetWeight').value) || null;
          const weeklyWorkouts = parseInt(document.getElementById('weeklyWorkouts').value) || 3;
          
          // Converti unità se necessario
          if (currentProfile.preferences?.weightUnit === 'lb' && targetWeight) {
            // Converti da libbre a kg per il database
            targetWeight = targetWeight / 2.20462;
          }
          
          const fitnessGoalsData = {
            primary_goal: document.getElementById('primaryGoal').value,
            target_weight: targetWeight,
            weekly_workouts: weeklyWorkouts,
            description: document.getElementById('goalDescription').value.trim()
          };
          
          // Crea una copia del profilo corrente
          const updatedProfile = { ...currentProfile };
          
          // Aggiorna gli obiettivi
          updatedProfile.fitness_goals = fitnessGoalsData;
          updatedProfile.updated_at = new Date().toISOString();
          
          // Aggiorna il profilo con i nuovi obiettivi
          const { error } = await supabaseClient
            .from('profiles')
            .update({
              fitness_goals: fitnessGoalsData,
              updated_at: updatedProfile.updated_at
            })
            .eq('id', currentUser.id);
          
          if (error) {
            throw error;
          }
          
          // Aggiorna gli obiettivi in memoria
          currentProfile = updatedProfile;
          
          // Salva il profilo aggiornato nella cache
          localStorage.setItem('userProfile', JSON.stringify(currentProfile));
          
          showToast('Obiettivi di fitness aggiornati con successo', 'success');
          hideLoading(loading);
        } catch (error) {
          console.error('Errore nell\'aggiornamento degli obiettivi:', error);
          showToast('Errore nell\'aggiornamento degli obiettivi: ' + error.message, 'error');
          hideLoading();
        }
      });
    }
  }
  
  // ===== GESTIONE OBIETTIVI SPECIFICI =====
  function setupGoalsHandlers() {
    const addGoalBtn = document.getElementById('addGoalBtn');
    const newGoalInput = document.getElementById('newGoalInput');
    
    if (!addGoalBtn || !newGoalInput) {
      return;
    }
    
    addGoalBtn.addEventListener('click', async () => {
      const goalDescription = newGoalInput.value.trim();
      if (!goalDescription) return;
      
      try {
        const loading = showLoading();
        
        // Prepara i dati per l'obiettivo
        const goalData = {
          user_id: currentUser.id,
          description: goalDescription,
          completed: false,
          created_at: new Date().toISOString()
        };
        
        // Salva nel database
        const { data, error } = await supabaseClient
          .from('specific_goals')
          .insert([goalData])
          .select();
        
        if (error) {
          throw error;
        }
        
        // Aggiungi il nuovo obiettivo all'array
        if (data && data.length > 0) {
          specificGoals.unshift(data[0]);
          
          // Renderizza gli obiettivi
          renderSpecificGoals();
          
          // Pulisci l'input
          newGoalInput.value = '';
        }
        
        hideLoading(loading);
      } catch (error) {
        console.error('Errore nell\'aggiunta dell\'obiettivo:', error);
        showToast('Errore nell\'aggiunta dell\'obiettivo: ' + error.message, 'error');
        hideLoading();
      }
    });
    
    // Premi Invio per aggiungere l'obiettivo
    newGoalInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGoalBtn.click();
      }
    });
  }
  
  // Funzione per eliminare un obiettivo specifico
  async function deleteGoal(goalId) {
    if (!goalId || !currentUser || !currentUser.id) {
      console.error('deleteGoal: parametri mancanti');
      return;
    }
    
    try {
      const loading = showLoading();
      
      // Elimina dal database
      const { error } = await supabaseClient
        .from('specific_goals')
        .delete()
        .eq('id', goalId)
        .eq('user_id', currentUser.id);
      
      if (error) {
        throw error;
      }
      
      // Rimuovi dall'array
      specificGoals = specificGoals.filter(goal => goal.id !== goalId);
      
      // Aggiorna la UI
      renderSpecificGoals();
      
      showToast('Obiettivo eliminato con successo', 'success');
      hideLoading(loading);
    } catch (error) {
      console.error('Errore nell\'eliminazione dell\'obiettivo:', error);
      showToast('Errore nell\'eliminazione dell\'obiettivo: ' + error.message, 'error');
      hideLoading();
    }
  }
  
  // Funzione per cambiare lo stato di completamento di un obiettivo
  async function toggleGoalCompletion(goalId) {
    if (!goalId || !currentUser || !currentUser.id) {
      console.error('toggleGoalCompletion: parametri mancanti');
      return;
    }
    
    // Trova l'obiettivo nella lista
    const goal = specificGoals.find(g => g.id === goalId);
    if (!goal) return;
    
    try {
      const loading = showLoading();
      
      // Inverte lo stato di completamento
      const newCompletedState = !goal.completed;
      
      // Aggiorna nel database
      const { error } = await supabaseClient
        .from('specific_goals')
        .update({ completed: newCompletedState })
        .eq('id', goalId)
        .eq('user_id', currentUser.id);
      
      if (error) {
        throw error;
      }
      
      // Aggiorna l'obiettivo in memoria
      goal.completed = newCompletedState;
      
      // Aggiorna la UI
      const goalText = document.querySelector(`.goal-item[data-goal-id="${goalId}"] .goal-text`);
      if (goalText) {
        if (newCompletedState) {
          goalText.classList.add('completed');
        } else {
          goalText.classList.remove('completed');
        }
      }
      
      hideLoading(loading);
    } catch (error) {
      console.error('Errore nell\'aggiornamento dell\'obiettivo:', error);
      showToast('Errore nell\'aggiornamento dell\'obiettivo: ' + error.message, 'error');
      hideLoading();
    }
  }
  
  // ===== EVENT LISTENERS =====
  function setupEventListeners() {
    try {
      // Setup per la gestione della foto profilo
      setupProfilePhotoHandler();
      
      // Setup per la gestione dei form
      setupFormSubmissions();
      
      // Setup per la gestione degli obiettivi
      setupGoalsHandlers();
      
      // Gestore per il pulsante di modifica profilo
      const editProfileBtn = document.getElementById('editProfileBtn');
      if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => {
          // Scorri alla scheda delle informazioni personali
          const personalInfoCard = document.getElementById('personalInfoCard');
          if (personalInfoCard) {
            personalInfoCard.scrollIntoView({ behavior: 'smooth' });
          }
        });
      }
      
      // Gestore per il pulsante di logout
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            if (!supabaseClient || !supabaseClient.auth) {
              throw new Error('Client Supabase non inizializzato correttamente');
            }
            
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw error;
            
            // Pulisci la cache locale
            localStorage.removeItem('userProfile');
            
            window.location.href = '/';
          } catch (error) {
            console.error('Errore durante il logout:', error);
            showToast('Errore durante il logout: ' + error.message, 'error');
            
            // Forza il redirect in caso di errore
            window.location.href = '/';
          }
        });
      }
    } catch (error) {
      console.error('Errore nella configurazione degli event listener:', error);
    }
  }
  
  // ===== ESPOSIZIONE FUNZIONI GLOBALI =====
  // Queste funzioni devono essere accessibili globalmente per i listener inline
  window.deleteGoal = deleteGoal;
  window.toggleGoalCompletion = toggleGoalCompletion;
  
  // ===== INIZIALIZZAZIONE =====
  // Avvia l'inizializzazione
  initialize();
});