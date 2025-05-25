// Gestione del riepilogo settimanale (versione migliorata)
document.addEventListener('DOMContentLoaded', async () => {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
        
    // Verifica autenticazione
    let currentUser = null;
    
    // Categorie di attività con icone
    const activityCategories = [
        { value: "", label: "Nessun allenamento", icon: "fas fa-times-circle" },
        { value: "cardio_running", label: "Cardio - Running", icon: "fas fa-running" },
        { value: "cardio_cycling", label: "Cardio - Ciclismo", icon: "fas fa-biking" },
        { value: "cardio_swimming", label: "Cardio - Nuoto", icon: "fas fa-swimmer" },
        { value: "cardio_other", label: "Cardio - Altro", icon: "fas fa-heartbeat" },
        { value: "strength_weights", label: "Forza - Pesi", icon: "fas fa-dumbbell" },
        { value: "strength_bodyweight", label: "Forza - Corpo libero", icon: "fas fa-child" },
        { value: "strength_functional", label: "Forza - Funzionale", icon: "fas fa-atom" },
        { value: "flexibility_yoga", label: "Flessibilità - Yoga", icon: "fas fa-spa" },
        { value: "flexibility_pilates", label: "Flessibilità - Pilates", icon: "fas fa-wind" },
        { value: "flexibility_stretching", label: "Flessibilità - Stretching", icon: "fas fa-arrows-alt-h" },
        { value: "hiit", label: "HIIT", icon: "fas fa-bolt" },
        { value: "team_sport", label: "Sport di squadra", icon: "fas fa-users" },
        { value: "individual_sport", label: "Sport individuale", icon: "fas fa-user" },
        { value: "recovery", label: "Recupero attivo", icon: "fas fa-battery-half" }
    ];
    
    const checkAuth = async () => {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) {
            window.location.href = '/';
            return null;
        }
        currentUser = session.user;
        return session;
    };
 
    const initDateSelectors = () => {
        const yearSelect = document.getElementById('year-select');
        const monthSelect = document.getElementById('month-select');
        const weekSelect = document.getElementById('week-select');
        
        // Svuota le opzioni esistenti
        yearSelect.innerHTML = '';
        
        // Popola anni: inizia dal 2025 fino al 2035
        const startYear = 2025;
        const endYear = 2035;
        
        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        }
        
        // Inizializza mese corrente
        const currentMonth = new Date().getMonth();
        monthSelect.value = currentMonth;
        
        // Event listeners
        yearSelect.addEventListener('change', updateWeekOptions);
        monthSelect.addEventListener('change', updateWeekOptions);
        weekSelect.addEventListener('change', loadSelectedWeekData);
        
        // Inizializza opzioni settimane
        updateWeekOptions();
    };
    
    // Aggiorna le opzioni delle settimane in base a anno e mese
    const updateWeekOptions = () => {
        const yearSelect = document.getElementById('year-select');
        const monthSelect = document.getElementById('month-select');
        const weekSelect = document.getElementById('week-select');
        
        const year = parseInt(yearSelect.value);
        const month = parseInt(monthSelect.value);
        
        // Calcola il numero di settimane nel mese
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        // Imposta il primo giorno della settimana a Lunedì (1)
        const firstDayOfWeek = 1; // 0 = Domenica, 1 = Lunedì
        
        // Calcola la data del primo lunedì del mese (o il primo giorno del mese se è lunedì)
        const firstMonday = new Date(firstDay);
        const dayOfWeek = firstDay.getDay() || 7; // 1-7 dove 7 è Domenica
        if (dayOfWeek !== firstDayOfWeek) {
            firstMonday.setDate(firstDay.getDate() + (firstDayOfWeek - dayOfWeek + 7) % 7);
        }
        
        // Svuota il selettore delle settimane
        weekSelect.innerHTML = '';
        
        // Genera le opzioni per le settimane
        let weekStart = new Date(firstMonday);
        let weekNumber = 1;
        
        // Se il primo lunedì è nel mese precedente, inizia da lì
        if (weekStart > firstDay) {
            weekStart = new Date(firstMonday);
            weekStart.setDate(weekStart.getDate() - 7);
        }
        
        while (weekStart.getMonth() === month || weekStart < firstDay) {
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            // Includi la settimana solo se almeno un giorno è nel mese selezionato
            if (weekEnd >= firstDay && weekStart <= lastDay) {
                const option = document.createElement('option');
                option.value = weekNumber;
                
                const formattedStart = formatDate(weekStart, { day: '2-digit', month: '2-digit' });
                const formattedEnd = formatDate(weekEnd, { day: '2-digit', month: '2-digit' });
                
                option.textContent = `Settimana ${weekNumber} (${formattedStart} - ${formattedEnd})`;
                option.dataset.start = weekStart.toISOString();
                option.dataset.end = weekEnd.toISOString();
                
                weekSelect.appendChild(option);
                weekNumber++;
            }
            
            // Passa alla settimana successiva
            weekStart.setDate(weekStart.getDate() + 7);
        }
        
        // Imposta la settimana corrente se è il mese corrente
        if (month === new Date().getMonth() && year === new Date().getFullYear()) {
            // Trova la settimana che contiene la data odierna
            const today = new Date();
            for (let i = 0; i < weekSelect.options.length; i++) {
                const start = new Date(weekSelect.options[i].dataset.start);
                const end = new Date(weekSelect.options[i].dataset.end);
                if (today >= start && today <= end) {
                    weekSelect.selectedIndex = i;
                    break;
                }
            }
        } else {
            weekSelect.selectedIndex = 0;
        }
        
        // Aggiorna i dati per la settimana selezionata
        loadSelectedWeekData();
        
        // Aggiorna l'intestazione con il range di date
        updateWeekRange();
    };
    
    // Aggiorna l'intervallo di date visualizzato
    const updateWeekRange = () => {
        const weekSelect = document.getElementById('week-select');
        const weekRangeElement = document.getElementById('week-range');
        
        if (!weekSelect.selectedOptions[0]) return;
        
        const startDate = new Date(weekSelect.selectedOptions[0].dataset.start);
        const endDate = new Date(weekSelect.selectedOptions[0].dataset.end);
        
        const formattedStart = formatDate(startDate, { day: '2-digit', month: '2-digit', year: 'numeric' });
        const formattedEnd = formatDate(endDate, { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        weekRangeElement.textContent = `${formattedStart} - ${formattedEnd}`;
    };
    
    // Carica i dati per la settimana selezionata
    const loadSelectedWeekData = async () => {
        const weekSelect = document.getElementById('week-select');
        const weekdaysContainer = document.getElementById('weekdays-container');
        
        if (!weekSelect.selectedOptions[0]) return;
        
        const startDate = new Date(weekSelect.selectedOptions[0].dataset.start);
        const endDate = new Date(weekSelect.selectedOptions[0].dataset.end);
        
        // Aggiorna intestazione
        updateWeekRange();
        
        // Genera le card per ogni giorno della settimana
        weekdaysContainer.innerHTML = '';
        
        const days = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
        const currentDate = new Date(startDate);
        
        for (let i = 0; i < 7; i++) {
            const dayName = days[i];
            const date = new Date(currentDate);
            const formattedDate = formatDate(date, { day: '2-digit', month: '2-digit' });
            
            // Crea card per il giorno
            const dayCard = document.createElement('div');
            dayCard.className = 'weekday-card';
            dayCard.dataset.date = date.toISOString();
            
            // Intestazione con nome giorno e data
            const dayHeader = document.createElement('div');
            dayHeader.className = 'weekday-header';
            dayHeader.innerHTML = `
                <span class="weekday-name">${dayName}</span>
                <span class="weekday-date">${formattedDate}</span>
            `;
            
            // Contenuto con selettore attività e descrizione
            const dayContent = document.createElement('div');
            dayContent.className = 'weekday-content';
            
            // Selettore attività
            const activitySelector = document.createElement('div');
            activitySelector.className = 'activity-selector';
            
            const select = document.createElement('select');
            select.className = 'workout-type-select';
            select.dataset.date = date.toISOString();
            
            // Aggiungi le opzioni con icone
            activityCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.value;
                option.innerHTML = `<i class="${category.icon} activity-icon"></i> ${category.label}`;
                select.appendChild(option);
            });
            
            // Event listener per aggiornare la classe quando si seleziona un'attività
            select.addEventListener('change', function() {
                const card = this.closest('.weekday-card');
                if (this.value) {
                    card.classList.add('day-with-workout');
                } else {
                    card.classList.remove('day-with-workout');
                }
            });
            
            activitySelector.appendChild(select);
            
            // Area descrizione
            const activityDescription = document.createElement('div');
            activityDescription.className = 'activity-description';
            
            const textarea = document.createElement('textarea');
            textarea.placeholder = 'Descrivi il tuo allenamento qui...';
            
            activityDescription.appendChild(textarea);
            
            // Aggiungi gli elementi al contenuto
            dayContent.appendChild(activitySelector);
            dayContent.appendChild(activityDescription);
            
            // Aggiungi intestazione e contenuto alla card
            dayCard.appendChild(dayHeader);
            dayCard.appendChild(dayContent);
            
            // Aggiungi la card al container
            weekdaysContainer.appendChild(dayCard);
            
            // Passa al giorno successivo
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Carica eventuali dati salvati per questa settimana
        await loadSavedWeekData(startDate, endDate);
    };
    
    // Carica dati salvati per la settimana selezionata
    const loadSavedWeekData = async (startDate, endDate) => {
        if (!currentUser) return;
        
        try {
            const { data, error } = await supabaseClient
                .from('weekly_summaries')
                .select('*')
                .eq('user_id', currentUser.id)
                .gte('date', startDate.toISOString())
                .lte('date', endDate.toISOString());
                
            if (error) throw error;
            
            if (data && data.length > 0) {
                // Popola i campi con i dati salvati
                data.forEach(entry => {
                    const entryDate = new Date(entry.date);
                    const dayCard = document.querySelector(`.weekday-card[data-date="${entryDate.toISOString()}"]`);
                    
                    if (dayCard) {
                        const select = dayCard.querySelector('select');
                        const textarea = dayCard.querySelector('textarea');
                        
                        if (select) select.value = entry.workout_type || '';
                        if (textarea) textarea.value = entry.description || '';
                        
                        // Aggiorna la classe se c'è un allenamento
                        if (entry.workout_type) {
                            dayCard.classList.add('day-with-workout');
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error loading saved data:', error);
            showToast('Errore nel caricamento dei dati salvati', 'error');
        }
    };
    
    // Salva il riepilogo settimanale
    const saveWeeklySummary = async () => {
        if (!currentUser) return;
        
        const loading = showLoading();
        try {
            const dayCards = document.querySelectorAll('.weekday-card');
            const summaries = [];
            
            dayCards.forEach(card => {
                const date = new Date(card.dataset.date);
                const select = card.querySelector('select');
                const textarea = card.querySelector('textarea');
                
                const workoutType = select ? select.value : '';
                const description = textarea ? textarea.value.trim() : '';
                
                if (workoutType || description) {
                    summaries.push({
                        user_id: currentUser.id,
                        date: date.toISOString(),
                        workout_type: workoutType,
                        description: description,
                        created_at: new Date().toISOString()
                    });
                }
            });
            
            // Prima elimina eventuali record esistenti per questa settimana
            const weekSelect = document.getElementById('week-select');
            const weekStart = new Date(weekSelect.selectedOptions[0].dataset.start);
            const weekEnd = new Date(weekSelect.selectedOptions[0].dataset.end);
            
            const { error: deleteError } = await supabaseClient
                .from('weekly_summaries')
                .delete()
                .eq('user_id', currentUser.id)
                .gte('date', weekStart.toISOString())
                .lte('date', weekEnd.toISOString());
                
            if (deleteError) throw deleteError;
            
            // Poi inserisci i nuovi record
            if (summaries.length > 0) {
                const { error } = await supabaseClient
                    .from('weekly_summaries')
                    .insert(summaries);
                    
                if (error) throw error;
            }
            
            showToast('Riepilogo settimanale salvato con successo', 'success');
        } catch (error) {
            console.error('Error saving summary:', error);
            showToast('Errore nel salvataggio del riepilogo', 'error');
        } finally {
            hideLoading(loading);
        }
    };
    
    // Formatta una data
    const formatDate = (date, options = {}) => {
        const defaultOptions = { day: 'numeric', month: 'numeric' };
        return date.toLocaleDateString('it-IT', { ...defaultOptions, ...options });
    };
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
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
    
    // Save button
    const saveBtn = document.getElementById('save-summary-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveWeeklySummary);
    }
    
    // Inizializzazione
    await checkAuth();
    initDateSelectors();
});