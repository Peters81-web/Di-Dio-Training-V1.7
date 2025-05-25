// Gestione del riepilogo settimanale
document.addEventListener('DOMContentLoaded', async () => {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
        
    // Verifica autenticazione
    let currentUser = null;
    
    const checkAuth = async () => {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) {
            window.location.href = '/';
            return null;
        }
        currentUser = session.user;
        return session;
    };
    
 // Modifica alla funzione initDateSelectors nel file weekly_summary.js

const initDateSelectors = () => {
    const yearSelect = document.getElementById('year-select');
    const monthSelect = document.getElementById('month-select');
    const weekSelect = document.getElementById('week-select');
    
    // Svuota le opzioni esistenti
    yearSelect.innerHTML = '';
    
    // Popola anni: inizia dal 2025 (anno corrente) fino al 2035
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
        const date = new Date(year, month, 1);
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        
        // Imposta il primo giorno della settimana a Lunedì (1)
        const firstDayOfWeek = 1; // 0 = Domenica, 1 = Lunedì
        
        // Calcola la data del primo giorno della prima settimana
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
        
        while (weekStart <= lastDay) {
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            const option = document.createElement('option');
            option.value = weekNumber;
            
            const formattedStart = weekStart.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
            const formattedEnd = weekEnd.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
            
            option.textContent = `Settimana ${weekNumber} (${formattedStart} - ${formattedEnd})`;
            option.dataset.start = weekStart.toISOString();
            option.dataset.end = weekEnd.toISOString();
            
            weekSelect.appendChild(option);
            
            // Passa alla settimana successiva
            weekStart.setDate(weekStart.getDate() + 7);
            weekNumber++;
        }
        
        // Imposta la settimana corrente se è il mese corrente
        if (month === new Date().getMonth() && year === new Date().getFullYear()) {
            const today = new Date();
            const currentWeek = Math.ceil((today.getDate() + (firstDay.getDay() || 7) - 1) / 7);
            weekSelect.value = currentWeek;
        } else {
            weekSelect.value = 1;
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
        
        const formattedStart = startDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const formattedEnd = endDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        weekRangeElement.textContent = `${formattedStart} - ${formattedEnd}`;
    };
    
    // Carica i dati per la settimana selezionata
    const loadSelectedWeekData = async () => {
        const weekSelect = document.getElementById('week-select');
        const tableBody = document.getElementById('summary-table-body');
        
        if (!weekSelect.selectedOptions[0]) return;
        
        const startDate = new Date(weekSelect.selectedOptions[0].dataset.start);
        const endDate = new Date(weekSelect.selectedOptions[0].dataset.end);
        
        // Aggiorna intestazione
        updateWeekRange();
        
        // Genera le righe della tabella per ogni giorno della settimana
        tableBody.innerHTML = '';
        
        const days = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
        const currentDate = new Date(startDate);
        
        for (let i = 0; i < 7; i++) {
            const dayName = days[i];
            const date = new Date(currentDate);
            
            // Crea riga per il giorno
            const row = document.createElement('tr');
            
            // Cella con nome giorno e data
            const dayCell = document.createElement('td');
            dayCell.dataset.label = "Giorno";
            dayCell.classList.add('day-cell');
            dayCell.innerHTML = `${dayName}<span class="day-date">${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</span>`;
            row.appendChild(dayCell);
            
            // Cella per l'attività
            const activityCell = document.createElement('td');
            activityCell.dataset.label = "Attività";
            activityCell.classList.add('workout-cell');
            activityCell.innerHTML = `
                <select class="workout-type-select" data-date="${date.toISOString()}">
                    <option value="">Nessun allenamento</option>
                    <option value="cardio">Cardio</option>
                    <option value="forza">Allenamento Forza</option>
                    <option value="flessibilita">Flessibilità</option>
                    <option value="hiit">HIIT</option>
                    <option value="recupero">Recupero Attivo</option>
                </select>
            `;
            row.appendChild(activityCell);
            
            // Cella per la descrizione
            const descriptionCell = document.createElement('td');
            descriptionCell.dataset.label = "Descrizione";
            descriptionCell.classList.add('workout-description');
            descriptionCell.innerHTML = `<textarea placeholder="Descrivi il tuo allenamento qui..."></textarea>`;
            row.appendChild(descriptionCell);
            
            tableBody.appendChild(row);
            
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
                    const activitySelects = document.querySelectorAll('.workout-type-select');
                    
                    activitySelects.forEach(select => {
                        const selectDate = new Date(select.dataset.date);
                        if (selectDate.toDateString() === entryDate.toDateString()) {
                            select.value = entry.workout_type || '';
                            select.closest('tr').querySelector('textarea').value = entry.description || '';
                        }
                    });
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
            const rows = document.querySelectorAll('#summary-table-body tr');
            const summaries = [];
            
            rows.forEach(row => {
                const activitySelect = row.querySelector('.workout-type-select');
                const description = row.querySelector('textarea').value;
                const date = new Date(activitySelect.dataset.date);
                
                if (activitySelect.value || description.trim()) {
                    summaries.push({
                        user_id: currentUser.id,
                        date: date.toISOString(),
                        workout_type: activitySelect.value,
                        description: description,
                        created_at: new Date().toISOString()
                    });
                }
            });
            
            // Prima elimina eventuali record esistenti per questa settimana
            const weekStart = new Date(document.getElementById('week-select').selectedOptions[0].dataset.start);
            const weekEnd = new Date(document.getElementById('week-select').selectedOptions[0].dataset.end);
            
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

// Aggiungi questo script alla fine del file weekly_summary.js o in un file separato
document.addEventListener('DOMContentLoaded', function() {
  // Seleziona il container principale
  const summaryContainers = document.querySelectorAll('.weekly-summary-container, .summary-container');
  
  if (summaryContainers.length === 0) {
    // Se non esiste un container specifico, trova la sezione con le statistiche
    const statsElements = document.querySelectorAll('.stat-value, [class*="stat-"]');
    if (statsElements.length > 0) {
      // Ottieni il genitore comune
      const parentElement = statsElements[0].closest('section') || statsElements[0].closest('div');
      
      if (parentElement) {
        // Converti la struttura esistente alla nuova struttura
        parentElement.classList.add('stat-summary-container');
        
        // Trova tutti i "blocchi" di statistica esistenti
        const statBlocks = parentElement.querySelectorAll('div > div');
        
        statBlocks.forEach(block => {
          // Evita di processare elementi già convertiti
          if (block.classList.contains('stat-card')) return;
          
          // Converti in una card di statistica
          block.classList.add('stat-card');
          
          // Trova il valore numerico e la label
          const valueElement = block.querySelector('[class*="value"], h3, h4, strong');
          const labelElement = block.querySelector('[class*="label"], p, small');
          
          if (valueElement) valueElement.classList.add('stat-value');
          if (labelElement) labelElement.classList.add('stat-label');
        });
      }
    }
  }
});