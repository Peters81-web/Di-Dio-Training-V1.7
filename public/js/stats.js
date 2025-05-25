// Gestione della pagina statistiche - File completamente riscritto
document.addEventListener('DOMContentLoaded', async function() {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
        
    // Variabili globali
    let currentUser = null;
    let activityChart = null;
    let weeklyChart = null;
    let selectedPeriod = {
        type: 'week',   // 'week', 'month', o 'year'
        year: 2025,     // Anno predefinito 2025 invece dell'anno corrente
        month: new Date().getMonth(),
        week: getCurrentWeekNumber()
    };
    
    // Funzione per formattare correttamente la durata
    function formatDuration(duration) {
        // Gestisci caso undefined o null
        if (duration === undefined || duration === null) {
            return "0 min";
        }
        
        // Converti sempre in numero
        let minutes = 0;
        
        // Se è già un numero
        if (typeof duration === 'number') {
            minutes = duration;
        }
        // Se è una stringa in formato HH:MM:SS
        else if (typeof duration === 'string' && duration.includes(':')) {
            const parts = duration.split(':');
            
            // Caso speciale per il formato 00:00:XX (invece di considerarlo come secondi, lo trattiamo come minuti)
            if (parts.length === 3 && parts[0] === '00' && parts[1] === '00') {
                minutes = parseInt(parts[2]);
            }
            // Normale gestione HH:MM:SS
            else if (parts.length === 3) {
                minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            } 
            // Formato MM:SS
            else if (parts.length === 2) {
                minutes = parseInt(parts[0]);
            }
        }
        // Se è una stringa numerica
        else if (typeof duration === 'string') {
            minutes = parseInt(duration) || 0;
        }
        
        // Formatta in ore e minuti per durate più lunghe
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        
        if (hours > 0) {
            return `${hours} h ${remainingMinutes > 0 ? remainingMinutes + ' min' : ''}`;
        } else {
            return `${minutes} min`;
        }
    }
    
    // Costanti
    const MONTHS = [
        'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
    ];
    
    const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    
    // Elementi DOM
    const elements = {
        periodType: document.getElementById('periodTypeSelector'),
        year: document.getElementById('yearSelector'),
        month: document.getElementById('monthSelector'),
        week: document.getElementById('weekSelector'),
        yearContainer: document.getElementById('yearSelectorContainer'),
        monthContainer: document.getElementById('monthSelectorContainer'),
        weekContainer: document.getElementById('weekSelectorContainer'),
        currentPeriod: document.getElementById('currentPeriodDisplay'),
        activityChart: document.getElementById('activityChart'),
        weeklyChart: document.getElementById('weeklyChart'),
        metrics: document.getElementById('performanceMetrics'),
        achievements: document.getElementById('achievementsList'),
        logoutBtn: document.getElementById('logoutBtn')
    };
    
    // Funzioni principali
    async function init() {
        try {
            // Verifica autenticazione
            const session = await checkAuth();
            if (!session) return;
            currentUser = session.user;
            
            // Inizializza selettori di periodo
            initPeriodSelectors();
            
            // Carica i dati
            await loadAllData();
            
            // Gestione logout e reset
            setupLogout();
            setupResetButton();
        } catch (error) {
            console.error('Initialization error:', error);
            showToast('Errore di inizializzazione', 'error');
        }
    }
    
    async function checkAuth() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            if (!session) {
                window.location.href = '/';
                return null;
            }
            return session;
        } catch (error) {
            console.error('Auth error:', error);
            showToast('Errore di autenticazione', 'error');
            return null;
        }
    }
    
    function setupLogout() {
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', async () => {
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
    }
    
    // Funzione per inizializzare il pulsante di reset
    function setupResetButton() {
        const resetBtn = document.getElementById('resetDataBtn');
        const confirmResetBtn = document.getElementById('confirmResetBtn');
        const resetModal = document.getElementById('resetConfirmModal');
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetModal.style.display = 'flex';
            });
        }
        
        if (confirmResetBtn) {
            confirmResetBtn.addEventListener('click', async () => {
                await resetUserData();
                resetModal.style.display = 'none';
            });
        }
    }
    
    // Funzione per resettare i dati dell'utente
    async function resetUserData() {
        if (!currentUser) {
            showToast('Errore: nessun utente autenticato', 'error');
            return;
        }
        
        const loading = showLoading();
        try {
            // Elimina tutti i workout completati dell'utente
            const { error: deleteCompletedError } = await supabaseClient
                .from('completed_workouts')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (deleteCompletedError) throw deleteCompletedError;
            
            // Elimina tutti i workout pianificati dell'utente
            const { error: deleteWorkoutsError } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (deleteWorkoutsError) throw deleteWorkoutsError;
            
            // Elimina tutti i programmi di allenamento dell'utente
            const { error: deleteProgramsError } = await supabaseClient
                .from('training_programs')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (deleteProgramsError) throw deleteProgramsError;
            
            // Elimina tutti i riepiloghi settimanali dell'utente
            const { error: deleteSummariesError } = await supabaseClient
                .from('weekly_summaries')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (deleteSummariesError) throw deleteSummariesError;
            
            showToast('Tutti i dati sono stati eliminati con successo', 'success');
            
            // Ricarica i dati (che ora saranno vuoti)
            await loadAllData();
        } catch (error) {
            console.error('Error resetting data:', error);
            showToast('Errore durante l\'eliminazione dei dati: ' + error.message, 'error');
        } finally {
            hideLoading(loading);
        }
    }
    
    // Inizializzazione selettori periodo
    function initPeriodSelectors() {
        // Popola il selettore degli anni
        populateYearSelector();
        
        // Imposta i valori iniziali
        elements.periodType.value = selectedPeriod.type;
        elements.year.value = selectedPeriod.year;
        elements.month.value = selectedPeriod.month;
        
        // Popola il selettore delle settimane
        populateWeekSelector();
        
        // Attiva i selettori appropriati
        updateSelectorsVisibility();
        
        // Aggiorna il display del periodo
        updatePeriodDisplay();
        
        // Aggiungi event listeners
        elements.periodType.addEventListener('change', handlePeriodTypeChange);
        elements.year.addEventListener('change', handleYearChange);
        elements.month.addEventListener('change', handleMonthChange);
        elements.week.addEventListener('change', handleWeekChange);
    }
    
    function populateYearSelector() {
        // Svuota il selettore
        elements.year.innerHTML = '';
        
        // Imposta il range fisso 2025-2035
        const startYear = 2025;
        const endYear = 2035;
        
        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            elements.year.appendChild(option);
        }
        
        // Imposta il 2025 come anno predefinito se non è già selezionato un altro anno
        if (!selectedPeriod.year || selectedPeriod.year < startYear || selectedPeriod.year > endYear) {
            selectedPeriod.year = startYear;
        }
        
        elements.year.value = selectedPeriod.year;
    }
    
    function populateWeekSelector() {
        // Svuota il selettore
        elements.week.innerHTML = '';
        
        // Utilizziamo un approccio più diretto: creiamo 52 settimane per ogni anno
        // indipendentemente dall'anno effettivo
        for (let weekNum = 1; weekNum <= 52; weekNum++) {
            const option = document.createElement('option');
            option.value = weekNum;
            
            // Calcola le date approssimative della settimana
            // Questo è un calcolo semplificato: inizia dal 1 gennaio e aggiunge 7 giorni per ogni settimana
            const startDay = new Date(selectedPeriod.year, 0, 1 + (weekNum - 1) * 7);
            const endDay = new Date(startDay);
            endDay.setDate(startDay.getDate() + 6);
            
            const startDate = formatDate(startDay, { day: '2-digit', month: '2-digit' });
            const endDate = formatDate(endDay, { day: '2-digit', month: '2-digit' });
            
            option.textContent = `${startDate} - ${endDate}`;
            elements.week.appendChild(option);
        }
        
        // Imposta la settimana selezionata
        if (selectedPeriod.week > 0 && selectedPeriod.week <= 52) {
            elements.week.value = selectedPeriod.week;
        } else {
            elements.week.selectedIndex = 0;
            selectedPeriod.week = parseInt(elements.week.value || "1");
        }
    }
    
    function updateSelectorsVisibility() {
        // Mostra/nascondi selettori in base al tipo di periodo
        switch (selectedPeriod.type) {
            case 'year':
                elements.yearContainer.style.display = 'flex';
                elements.monthContainer.style.display = 'none';
                elements.weekContainer.style.display = 'none';
                break;
            case 'month':
                elements.yearContainer.style.display = 'flex';
                elements.monthContainer.style.display = 'flex';
                elements.weekContainer.style.display = 'none';
                break;
            case 'week':
                elements.yearContainer.style.display = 'flex';
                elements.monthContainer.style.display = 'none';
                elements.weekContainer.style.display = 'flex';
                break;
        }
    }
    
    function updatePeriodDisplay() {
        let displayText = '';
        
        switch (selectedPeriod.type) {
            case 'year':
                displayText = `Anno ${selectedPeriod.year}`;
                break;
            case 'month':
                displayText = `${MONTHS[selectedPeriod.month]} ${selectedPeriod.year}`;
                break;
            case 'week':
                const { start, end } = getWeekDates(selectedPeriod.year, selectedPeriod.week);
                const startDate = formatDate(start, { day: '2-digit', month: '2-digit' });
                const endDate = formatDate(end, { day: '2-digit', month: '2-digit' });
                displayText = `${startDate} - ${endDate}, ${selectedPeriod.year}`;
                break;
        }
        
        elements.currentPeriod.textContent = displayText;
    }
    
    // Event handlers per i selettori
    function handlePeriodTypeChange() {
        selectedPeriod.type = elements.periodType.value;
        updateSelectorsVisibility();
        updatePeriodDisplay();
        loadAllData();
    }
    
    function handleYearChange() {
        selectedPeriod.year = parseInt(elements.year.value);
        
        // Se cambiamo anno, potrebbe cambiare il numero di settimane
        populateWeekSelector();
        
        updatePeriodDisplay();
        loadAllData();
    }
    
    function handleMonthChange() {
        selectedPeriod.month = parseInt(elements.month.value);
        updatePeriodDisplay();
        loadAllData();
    }
    
    function handleWeekChange() {
        selectedPeriod.week = parseInt(elements.week.value);
        updatePeriodDisplay();
        loadAllData();
    }
    
    // Caricamento dati
    async function loadAllData() {
        const loading = showLoading();
        try {
            // Ottieni l'intervallo di date per il periodo selezionato
            const dateRange = getPeriodDateRange();
            
            // Carica i workout nel periodo selezionato
            const { data: workouts, error } = await supabaseClient
                .from('completed_workouts')
                .select(`
                    *,
                    workout_plans (
                        *,
                        activities (name)
                    )
                `)
                .gte('completed_at', dateRange.start.toISOString())
                .lte('completed_at', dateRange.end.toISOString())
                .order('completed_at', { ascending: false });
                    
            if (error) throw error;
            
            // Log dei dati per debug
            console.log('Workout caricati:', workouts);
            if (workouts && workouts.length > 0) {
                console.log('Esempio durata workout:', workouts[0].duration);
                console.log('Esempio actual_duration workout:', workouts[0].actual_duration);
            }
            
            // Aggiorna i grafici e le metriche con i dati ottenuti
            updateActivityChart(workouts);
            updateWeeklyChart(workouts);
            updatePerformanceMetrics(workouts);
            updateAchievements(workouts);
        } catch (error) {
            console.error('Error loading data:', error);
            showToast('Errore nel caricamento dei dati', 'error');
        } finally {
            hideLoading(loading);
        }
    }
    
    // Funzioni per l'aggiornamento dei grafici
    function updateActivityChart(workouts) {
        // Raggruppa i workout per tipo di attività
        const activityData = processActivityData(workouts);
        
        // Se non c'è il grafico, crealo. Altrimenti aggiornalo
        if (!activityChart) {
            activityChart = new Chart(elements.activityChart.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: activityData.labels,
                    datasets: [{
                        data: activityData.data,
                        backgroundColor: [
                            '#4361ee',
                            '#3a0ca3',
                            '#7209b7',
                            '#f72585',
                            '#2ecc71',
                            '#3498db',
                            '#f39c12',
                            '#e74c3c'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                boxWidth: 12,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = Math.round((value / total) * 100);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        } else {
            // Aggiorna il grafico esistente
            activityChart.data.labels = activityData.labels;
            activityChart.data.datasets[0].data = activityData.data;
            activityChart.update();
        }
        
        // Mostra un messaggio se non ci sono dati
        if (activityData.labels.length === 0) {
            showNoDataMessage(elements.activityChart, 'Nessuna attività in questo periodo');
        } else {
            hideNoDataMessage(elements.activityChart);
        }
    }
    
    function updateWeeklyChart(workouts) {
        // Prepara i dati in base al tipo di periodo
        const chartData = processTimeSeriesData(workouts);
        
        // Scegli un titolo appropriato
        let chartTitle = 'Allenamenti per Giorno';
        if (selectedPeriod.type === 'month') {
            chartTitle = 'Allenamenti per Giorno';
        } else if (selectedPeriod.type === 'year') {
            chartTitle = 'Allenamenti per Mese';
        }
        
        // Se non c'è il grafico, crealo. Altrimenti aggiornalo
        if (!weeklyChart) {
            weeklyChart = new Chart(elements.weeklyChart.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: chartData.labels,
                    datasets: [{
                        label: 'Allenamenti',
                        data: chartData.data,
                        backgroundColor: '#4361ee',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: chartTitle,
                            font: {
                                size: 16,
                                weight: 'bold'
                            }
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1,
                                precision: 0
                            }
                        }
                    }
                }
            });
        } else {
            // Aggiorna il grafico esistente
            weeklyChart.data.labels = chartData.labels;
            weeklyChart.data.datasets[0].data = chartData.data;
            weeklyChart.options.plugins.title.text = chartTitle;
            weeklyChart.update();
        }
        
        // Mostra un messaggio se non ci sono dati
        if (chartData.labels.length === 0 || chartData.data.every(val => val === 0)) {
            showNoDataMessage(elements.weeklyChart, 'Nessun allenamento in questo periodo');
        } else {
            hideNoDataMessage(elements.weeklyChart);
        }
    }
    
    function updatePerformanceMetrics(workouts) {
        // Calcola le metriche
        const metrics = calculatePerformanceMetrics(workouts);
        
        // Formatta la durata correttamente
        const formattedDuration = formatDuration(metrics.totalDuration);
        
        // Aggiorna il contenitore delle metriche
        elements.metrics.innerHTML = `
            <div class="metric-item">
                <div class="metric-value">${metrics.totalWorkouts}</div>
                <div class="metric-label">Allenamenti</div>
            </div>
            <div class="metric-item">
                <div class="metric-value">${formattedDuration}</div>
                <div class="metric-label">Durata Totale</div>
            </div>
            <div class="metric-item">
                <div class="metric-value">${metrics.totalDistance.toFixed(1)} km</div>
                <div class="metric-label">Distanza Totale</div>
            </div>
            <div class="metric-item">
                <div class="metric-value">${metrics.totalCalories}</div>
                <div class="metric-label">Calorie Bruciate</div>
            </div>
        `;
        
        // Aggiungi stili CSS alle metriche
        const metricItems = elements.metrics.querySelectorAll('.metric-item');
        metricItems.forEach(item => {
            item.style.backgroundColor = '#f8f9fa';
            item.style.borderRadius = '8px';
            item.style.padding = '15px';
            item.style.textAlign = 'center';
            
            const value = item.querySelector('.metric-value');
            if (value) {
                value.style.fontSize = '1.75rem';
                value.style.fontWeight = 'bold';
                value.style.color = '#4361ee';
                value.style.marginBottom = '5px';
            }
            
            const label = item.querySelector('.metric-label');
            if (label) {
                label.style.color = '#6c757d';
                label.style.fontSize = '0.875rem';
            }
        });
    }
    
    function updateAchievements(workouts) {
        // Calcola gli achievements
        const achievements = calculateAchievements(workouts);
        
        // Aggiorna il contenitore degli achievements
        if (achievements.length === 0) {
            elements.achievements.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 20px;">
                    <i class="fas fa-trophy" style="font-size: 2rem; color: #ccc; margin-bottom: 10px;"></i>
                    <p>Nessun obiettivo raggiunto in questo periodo</p>
                </div>
            `;
            return;
        }
        
        elements.achievements.innerHTML = achievements.map(achievement => `
            <div class="achievement-item">
                <div class="achievement-icon">
                    <i class="${achievement.icon}"></i>
                </div>
                <div class="achievement-content">
                    <div class="achievement-title">${achievement.title}</div>
                    <div class="achievement-desc">${achievement.description}</div>
                </div>
            </div>
        `).join('');
        
        // Aggiungi stili CSS inline
        const achievementItems = elements.achievements.querySelectorAll('.achievement-item');
        achievementItems.forEach(item => {
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '10px';
            item.style.backgroundColor = '#f8f9fa';
            item.style.borderRadius = '8px';
            item.style.padding = '12px';
            
            const icon = item.querySelector('.achievement-icon');
            if (icon) {
                icon.style.backgroundColor = '#4361ee';
                icon.style.color = 'white';
                icon.style.width = '40px';
                icon.style.height = '40px';
                icon.style.borderRadius = '50%';
                icon.style.display = 'flex';
                icon.style.alignItems = 'center';
                icon.style.justifyContent = 'center';
                icon.style.fontSize = '1.25rem';
                icon.style.flexShrink = '0';
            }
            
            const title = item.querySelector('.achievement-title');
            if (title) {
                title.style.fontWeight = 'bold';
                title.style.fontSize = '0.9rem';
            }
            
            const desc = item.querySelector('.achievement-desc');
            if (desc) {
                desc.style.fontSize = '0.8rem';
                desc.style.color = '#6c757d';
            }
        });
    }
    
    // Funzioni di data processing
    function processActivityData(workouts) {
        // Raggruppa i workout per tipo di attività
        const activityCounts = {};
        
        workouts.forEach(workout => {
            if (!workout.workout_plans || !workout.workout_plans.activities) return;
            
            const activityName = workout.workout_plans.activities.name;
            if (!activityName) return;
            
            activityCounts[activityName] = (activityCounts[activityName] || 0) + 1;
        });
        
        return {
            labels: Object.keys(activityCounts),
            data: Object.values(activityCounts)
        };
    }
    
    function processTimeSeriesData(workouts) {
        let labels = [];
        let data = [];
        
        // In base al tipo di periodo, crea le etichette e i dati appropriati
        switch (selectedPeriod.type) {
            case 'week':
                // Per la settimana, mostra i giorni
                const weekDates = getWeekDates(selectedPeriod.year, selectedPeriod.week);
                
                // Crea un array di date per i giorni della settimana
                const days = [];
                for (let i = 0; i < 7; i++) {
                    const day = new Date(weekDates.start);
                    day.setDate(weekDates.start.getDate() + i);
                    days.push(day);
                }
                
                // Prepara le etichette (giorni della settimana)
                labels = days.map(d => DAYS_SHORT[d.getDay()]);
                
                // Inizializza i contatori per ogni giorno a 0
                data = new Array(7).fill(0);
                
                // Conta i workout per ogni giorno
                workouts.forEach(workout => {
                    const workoutDate = new Date(workout.completed_at);
                    for (let i = 0; i < days.length; i++) {
                        if (isSameDay(workoutDate, days[i])) {
                            data[i]++;
                            break;
                        }
                    }
                });
                break;
                
            case 'month':
                // Per il mese, mostra i giorni del mese
                const daysInMonth = new Date(selectedPeriod.year, selectedPeriod.month + 1, 0).getDate();
                
                // Prepara le etichette (numeri dei giorni)
                labels = Array.from({length: daysInMonth}, (_, i) => (i + 1).toString());
                
                // Inizializza i contatori per ogni giorno a 0
                data = new Array(daysInMonth).fill(0);
                
                // Conta i workout per ogni giorno
                workouts.forEach(workout => {
                    const workoutDate = new Date(workout.completed_at);
                    if (workoutDate.getMonth() === selectedPeriod.month && 
                        workoutDate.getFullYear() === selectedPeriod.year) {
                        const day = workoutDate.getDate() - 1; // Indice 0-based
                        data[day]++;
                    }
                });
                break;
                
            case 'year':
                // Per l'anno, mostra i mesi
                labels = MONTHS.map(m => m.substring(0, 3)); // Abbrevia i nomi dei mesi
                
                // Inizializza i contatori per ogni mese a 0
                data = new Array(12).fill(0);
                
                // Conta i workout per ogni mese
                workouts.forEach(workout => {
                    const workoutDate = new Date(workout.completed_at);
                    if (workoutDate.getFullYear() === selectedPeriod.year) {
                        const month = workoutDate.getMonth();
                        data[month]++;
                    }
                });
                break;
        }
        
        return { labels, data };
    }
    
    function calculatePerformanceMetrics(workouts) {
        // Se non ci sono workout, restituisci valori predefiniti
        if (!workouts || workouts.length === 0) {
            return {
                totalWorkouts: 0,
                totalDuration: 0,
                totalDistance: 0,
                totalCalories: 0
            };
        }
        
        // Calcola la durata totale verificando ogni possibile campo di durata
        let totalDuration = 0;
        for (const workout of workouts) {
            // Considera tutti i possibili campi di durata, in ordine di priorità
            let duration;
            
            if (typeof workout.actual_duration === 'number') {
                duration = workout.actual_duration;
            } else if (typeof workout.duration === 'number') {
                duration = workout.duration;
            } else if (typeof workout.actual_duration === 'string' && workout.actual_duration.includes(':')) {
                // Formato HH:MM:SS
                const parts = workout.actual_duration.split(':');
                // Caso speciale per il formato 00:00:XX (invece di considerarlo come secondi, lo trattiamo come minuti)
                if (parts.length === 3 && parts[0] === '00' && parts[1] === '00') {
                    duration = parseInt(parts[2]);
                } else if (parts.length === 3) {
                    duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                } else if (parts.length === 2) {
                    duration = parseInt(parts[0]);
                }
            } else if (typeof workout.duration === 'string' && workout.duration.includes(':')) {
                // Formato HH:MM:SS
                const parts = workout.duration.split(':');
                // Caso speciale per il formato 00:00:XX (invece di considerarlo come secondi, lo trattiamo come minuti)
                if (parts.length === 3 && parts[0] === '00' && parts[1] === '00') {
                    duration = parseInt(parts[2]);
                } else if (parts.length === 3) {
                    duration = parseInt(parts[0]);
                }
                    if (parts.length === 3 && parts[0] === '00' && parts[1] === '00') {
                        duration = parseInt(parts[2]);
                    } else if (parts.length === 3) {
                        duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    } else if (parts.length === 2) {
                        duration = parseInt(parts[0]);
                    }
                } else {
                    // Tenta di convertire qualsiasi stringa in un numero
                    duration = parseInt(workout.actual_duration || workout.duration || 0);
                }
                
                // Verifica che sia un numero valido
                if (!isNaN(duration)) {
                    totalDuration += duration;
                }
            }
            
            return {
                totalWorkouts: workouts.length,
                totalDuration: totalDuration,
                totalDistance: workouts.reduce((sum, w) => sum + (parseFloat(w.distance) || 0), 0),
                totalCalories: workouts.reduce((sum, w) => sum + (parseInt(w.calories_burned) || 0), 0)
            };
        }
        
        function calculateAchievements(workouts) {
            const achievements = [];
            
            // Se non ci sono workout, restituisci un array vuoto
            if (workouts.length === 0) {
                return achievements;
            }
            
            // Achievement: Completati 3+ allenamenti
            if (workouts.length >= 3) {
                achievements.push({
                    icon: 'fas fa-award',
                    title: 'Costanza',
                    description: `${workouts.length} allenamenti completati`
                });
            }
            
            // Achievement: Distanza totale >= 10km
            const totalDistance = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
            if (totalDistance >= 10) {
                achievements.push({
                    icon: 'fas fa-road',
                    title: 'Maratoneta',
                    description: `${totalDistance.toFixed(1)}km percorsi`
                });
            }
            
            // Achievement: Durata media >= 30 minuti
            const avgDuration = workouts.reduce((sum, w) => {
                // Estrai la durata correttamente
                let duration = 0;
                if (typeof w.actual_duration === 'number') {
                    duration = w.actual_duration;
                } else if (typeof w.duration === 'number') {
                    duration = w.duration;
                } else if (typeof w.actual_duration === 'string' && w.actual_duration.includes(':')) {
                    const parts = w.actual_duration.split(':');
                    // Caso speciale per il formato 00:00:XX
                    if (parts.length === 3 && parts[0] === '00' && parts[1] === '00') {
                        duration = parseInt(parts[2]);
                    } else if (parts.length === 3) {
                        duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    }
                } else if (typeof w.duration === 'string') {
                    duration = parseInt(w.duration) || 0;
                }
                return sum + duration;
            }, 0) / workouts.length;
            
            if (avgDuration >= 30) {
                achievements.push({
                    icon: 'fas fa-stopwatch',
                    title: 'Resistenza',
                    description: `${Math.round(avgDuration)} min di durata media`
                });
            }
            
            // Achievement: Allenamenti in 3+ giorni diversi
            const uniqueDays = new Set();
            workouts.forEach(workout => {
                const date = new Date(workout.completed_at);
                uniqueDays.add(date.toDateString());
            });
            
            if (uniqueDays.size >= 3) {
                achievements.push({
                    icon: 'fas fa-calendar-check',
                    title: 'Regolarità',
                    description: `Allenamenti in ${uniqueDays.size} giorni diversi`
                });
            }
            
            return achievements;
        }
        
        // Funzioni di utilità per le date
        function getCurrentWeekNumber() {
            return getWeekNumber(new Date())[1];
        }
        
        function getWeekNumber(date) {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return [
                d.getUTCFullYear(), 
                Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
            ];
        }
        
        function getWeeksInYear(year) {
            const lastDay = new Date(year, 11, 31);
            return getWeekNumber(lastDay)[1];
        }
        
        function getWeekDates(year, weekNum) {
            // Calcolo semplificato: inizia dal 1 gennaio e aggiunge 7 giorni per ogni settimana
            const startDate = new Date(year, 0, 1 + (weekNum - 1) * 7);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            
            return { start: startDate, end: endDate };
        }
        
        function getPeriodDateRange() {
            let start, end;
            
            switch (selectedPeriod.type) {
                case 'week':
                    const weekDates = getWeekDates(selectedPeriod.year, selectedPeriod.week);
                    start = weekDates.start;
                    end = weekDates.end;
                    break;
                    
                case 'month':
                    start = new Date(selectedPeriod.year, selectedPeriod.month, 1);
                    end = new Date(selectedPeriod.year, selectedPeriod.month + 1, 0);
                    break;
                    
                case 'year':
                    start = new Date(selectedPeriod.year, 0, 1);
                    end = new Date(selectedPeriod.year, 11, 31);
                    break;
            }
            
            // Imposta l'ora di inizio a 00:00:00 e l'ora di fine a 23:59:59
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            
            return { start, end };
        }
        
        function formatDate(date, options = {}) {
            const defaultOptions = { day: 'numeric', month: 'numeric', year: 'numeric' };
            return date.toLocaleDateString('it-IT', { ...defaultOptions, ...options });
        }
        
        function isSameDay(date1, date2) {
            return date1.getDate() === date2.getDate() &&
                   date1.getMonth() === date2.getMonth() &&
                   date1.getFullYear() === date2.getFullYear();
        }
        
        // Funzioni di utilità per l'UI
        function showNoDataMessage(chartElement, message) {
            // Verifico se il messaggio è già presente
            let messageElement = chartElement.parentNode.querySelector('.no-data-message');
            
            if (!messageElement) {
                messageElement = document.createElement('div');
                messageElement.className = 'no-data-message';
                messageElement.style.position = 'absolute';
                messageElement.style.top = '50%';
                messageElement.style.left = '50%';
                messageElement.style.transform = 'translate(-50%, -50%)';
                messageElement.style.textAlign = 'center';
                messageElement.style.color = '#888';
                messageElement.style.fontSize = '0.9rem';
                messageElement.style.width = '100%';
                
                chartElement.parentNode.appendChild(messageElement);
            }
            
            messageElement.innerHTML = `
                <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                <p>${message}</p>
            `;
            
            // Riduci l'opacità del canvas
            chartElement.style.opacity = '0.2';
        }
        
        function hideNoDataMessage(chartElement) {
            const messageElement = chartElement.parentNode.querySelector('.no-data-message');
            if (messageElement) {
                messageElement.remove();
            }
            
            // Ripristina l'opacità del canvas
            chartElement.style.opacity = '1';
        }
        
        // Inizializzazione
        init();
    });

    // Grafici avanzati
function initializeAdvancedCharts(completedWorkouts) {
  // Grafico peso nel tempo - Richiede body_measurements
  initializeWeightChart();
  
  // Grafico distanza per attività
  initializeDistanceChart(completedWorkouts);
  
  // Grafico calorie bruciate settimanalmente
  initializeCaloriesChart(completedWorkouts);
  
  // Grafico frequenza cardiaca media
  initializeHeartRateChart(completedWorkouts);
}

// Grafico peso nel tempo
async function initializeWeightChart() {
  const ctx = document.getElementById('weightTrendChart');
  if (!ctx) return;
  
  const rangeSelector = document.getElementById('weightChartRange');
  let daysRange = 30; // Default
  
  if (rangeSelector) {
    daysRange = parseInt(rangeSelector.value);
    
    // Aggiungi event listener per cambiare il range
    rangeSelector.addEventListener('change', () => {
      daysRange = parseInt(rangeSelector.value);
      loadWeightData(daysRange);
    });
  }
  
  // Carica i dati di peso
  loadWeightData(daysRange);
  
  // Funzione per caricare i dati di peso
  async function loadWeightData(days) {
    try {
      const supabaseClient = window.supabaseClient;
      if (!supabaseClient || !currentUser) {
        return;
      }
      
      // Calcola la data di inizio
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Carica i dati dal database
      const { data, error } = await supabaseClient
        .from('body_measurements')
        .select('date, weight')
        .eq('user_id', currentUser.id)
        .gte('date', startDate.toISOString())
        .order('date', { ascending: true });
        
      if (error) {
        throw error;
      }
      
      // Prepara i dati per il grafico
      const dates = data.map(d => new Date(d.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
      const weights = data.map(d => d.weight);
      
      // Crea o aggiorna il grafico
      if (window.weightChart) {
        window.weightChart.data.labels = dates;
        window.weightChart.data.datasets[0].data = weights;
        window.weightChart.update();
      } else {
        window.weightChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: dates,
            datasets: [{
              label: 'Peso (kg)',
              data: weights,
              borderColor: '#4361ee',
              backgroundColor: 'rgba(67, 97, 238, 0.1)',
              tension: 0.3,
              fill: true,
              pointRadius: 4,
              pointBackgroundColor: '#4361ee'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: {
                mode: 'index',
                intersect: false
              },
              legend: {
                position: 'top',
              }
            },
            scales: {
              y: {
                beginAtZero: false,
                title: {
                  display: true,
                  text: 'Peso (kg)'
                }
              },
              x: {
                title: {
                  display: true,
                  text: 'Data'
                }
              }
            }
          }
        });
      }
      
    } catch (error) {
      console.error('Errore nel caricamento dei dati di peso:', error);
    }
  }
}

// Grafico distanza per attività
function initializeDistanceChart(completedWorkouts) {
  const ctx = document.getElementById('distanceByActivityChart');
  if (!ctx) return;
  
  const filterSelector = document.getElementById('distanceChartFilter');
  let activityFilter = 'all'; // Default
  
  if (filterSelector) {
    // Aggiungi event listener per cambiare il filtro
    filterSelector.addEventListener('change', () => {
      activityFilter = filterSelector.value;
      updateDistanceChart(completedWorkouts, activityFilter);
    });
  }
  
  // Aggiorna il grafico con i dati
  updateDistanceChart(completedWorkouts, activityFilter);
  
  // Funzione per aggiornare il grafico
  function updateDistanceChart(workouts, filter) {
    // Filtra per attività se necessario
    let filteredWorkouts = workouts;
    if (filter !== 'all') {
      filteredWorkouts = workouts.filter(w => 
        w.workout_plans && w.workout_plans.activity_id === filter
      );
    }
    
    // Raggruppa per data
    const workoutsByDate = {};
    
    filteredWorkouts.forEach(workout => {
      if (!workout.distance || workout.distance <= 0) return;
      
      const date = new Date(workout.completed_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      
      if (!workoutsByDate[date]) {
        workoutsByDate[date] = 0;
      }
      
      workoutsByDate[date] += workout.distance;
    });
    
    // Converti in arrays per il grafico
    const dates = Object.keys(workoutsByDate);
    const distances = Object.values(workoutsByDate);
    
    // Crea o aggiorna il grafico
    if (window.distanceChart) {
      window.distanceChart.data.labels = dates;
      window.distanceChart.data.datasets[0].data = distances;
      window.distanceChart.update();
    } else {
      window.distanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [{
            label: 'Distanza (km)',
            data: distances,
            backgroundColor: '#3a0ca3',
            borderRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: function(context) {
                  return `${context.parsed.y.toFixed(2)} km`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Distanza (km)'
              }
            },
            x: {
              title: {
                display: true,
                text: 'Data'
              }
            }
          }
        }
      });
    }
  }
}

// Grafico calorie bruciate settimanalmente
function initializeCaloriesChart(completedWorkouts) {
  const ctx = document.getElementById('caloriesBurnedChart');
  if (!ctx) return;
  
  // Calcola calorie bruciate per ogni giorno della settimana
  const weekdayCalories = [0, 0, 0, 0, 0, 0, 0]; // [Dom, Lun, Mar, Mer, Gio, Ven, Sab]
  const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  
  completedWorkouts.forEach(workout => {
    if (!workout.calories_burned || workout.calories_burned <= 0) return;
    
    const date = new Date(workout.completed_at);
    const dayOfWeek = date.getDay(); // 0-6 (Dom-Sab)
    
    weekdayCalories[dayOfWeek] += workout.calories_burned;
  });
  
  // Crea il grafico
  window.caloriesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dayNames,
      datasets: [{
        label: 'Calorie bruciate',
        data: weekdayCalories,
        backgroundColor: '#f72585',
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.parsed.y} kcal`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Calorie (kcal)'
          }
        }
      }
    }
  });
}

// Grafico frequenza cardiaca media
function initializeHeartRateChart(completedWorkouts) {
  const ctx = document.getElementById('heartRateChart');
  if (!ctx) return;
  
  // Filtra solo i workout con dati di frequenza cardiaca
  const workoutsWithHR = completedWorkouts.filter(w => 
    w.heart_rate_avg && w.heart_rate_avg > 0
  );
  
  // Ordina per data
  workoutsWithHR.sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
  
  // Estrai i dati per il grafico
  const dates = workoutsWithHR.map(w => new Date(w.completed_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
  const heartRates = workoutsWithHR.map(w => w.heart_rate_avg);
  
  // Crea il grafico
  window.heartRateChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Frequenza cardiaca media (bpm)',
        data: heartRates,
        borderColor: '#e74c3c',
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: '#e74c3c'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              return `${context.parsed.y} bpm`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: 'BPM'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Data'
          }
        }
      }
    }
  });
}

// Aggiorna la funzione loadCompletedWorkouts per inizializzare i grafici avanzati
async function loadCompletedWorkouts() {
  const loading = showLoading();
  try {
    // ... codice esistente ...
    
    // Aggiorna grafici e statistiche
    updateCharts(data);
    updateStatistics(data);
    
    // Inizializza grafici avanzati
    initializeAdvancedCharts(data);
    
  } catch (error) {
    // ... gestione errori ...
  } finally {
    hideLoading(loading);
  }
}