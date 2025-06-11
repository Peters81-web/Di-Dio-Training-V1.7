// DiDio Training - Advanced Reporting System
document.addEventListener('DOMContentLoaded', async function() {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    
    // Variabili globali
    let currentUser = null;
    let reportData = null;
    let progressChart = null;
    let activityChart = null;
    let intensityChart = null;
    let selectedFormat = 'pdf';
    
    // Elementi DOM
    const elements = {
        reportType: document.getElementById('reportType'),
        timeRange: document.getElementById('timeRange'),
        startDate: document.getElementById('startDate'),
        endDate: document.getElementById('endDate'),
        dateRangeSelector: document.querySelector('.date-range-selector'),
        generateReportBtn: document.getElementById('generateReportBtn'),
        exportReportBtn: document.getElementById('exportReportBtn'),
        reportLoading: document.querySelector('.report-loading'),
        
        // Card values
        totalWorkoutsValue: document.getElementById('totalWorkoutsValue'),
        totalTimeValue: document.getElementById('totalTimeValue'),
        totalDistanceValue: document.getElementById('totalDistanceValue'),
        totalCaloriesValue: document.getElementById('totalCaloriesValue'),
        workoutsTrend: document.getElementById('workoutsTrend'),
        timeTrend: document.getElementById('timeTrend'),
        distanceTrend: document.getElementById('distanceTrend'),
        caloriesTrend: document.getElementById('caloriesTrend'),
        
        // Chart canvases
        progressChartCanvas: document.getElementById('progressChartCanvas'),
        activityChartCanvas: document.getElementById('activityChartCanvas'),
        intensityChartCanvas: document.getElementById('intensityChartCanvas'),
        
        // Lists and containers
        goalsContainer: document.getElementById('goalsContainer'),
        workoutsTableBody: document.getElementById('workoutsTableBody'),
        
        // Modal elements
        exportModal: document.getElementById('exportModal'),
        exportOptions: document.querySelectorAll('.export-option'),
        exportFilename: document.getElementById('exportFilename'),
        includeChartsCheckbox: document.getElementById('includeChartsCheckbox'),
        includeRawDataCheckbox: document.getElementById('includeRawDataCheckbox'),
        confirmExportBtn: document.getElementById('confirmExportBtn')
    };
    
    // Funzione di inizializzazione
    async function init() {
        try {
            // Verifica autenticazione
            const session = await checkAuth();
            if (!session) return;
            currentUser = session.user;
            
            // Imposta date predefinite
            setDefaultDates();
            
            // Setup degli event listeners
            setupEventListeners();
            
            // Genera report iniziale
            await generateReport();
        } catch (error) {
            console.error('Initialization error:', error);
            showToast('Errore di inizializzazione', 'error');
        }
    }
    
    // Verifica autenticazione
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
    
    // Imposta date predefinite
    function setDefaultDates() {
        const now = new Date();
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        
        // Formatta le date nel formato YYYY-MM-DD
        elements.startDate.value = formatDateForInput(oneMonthAgo);
        elements.endDate.value = formatDateForInput(now);
    }
    
    // Formatta una data per un input date
    function formatDateForInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Setup degli event listeners
    function setupEventListeners() {
        // Listener per il cambio di intervallo temporale
        elements.timeRange.addEventListener('change', function() {
            const selectedRange = this.value;
            
            // Mostra/nascondi il selettore personalizzato
            if (selectedRange === 'custom') {
                elements.dateRangeSelector.style.display = 'grid';
            } else {
                elements.dateRangeSelector.style.display = 'none';
                
                // Imposta le date in base all'intervallo selezionato
                setDateRangeFromSelection(selectedRange);
            }
        });
        
        // Listener per il pulsante di generazione report
        elements.generateReportBtn.addEventListener('click', generateReport);
        
        // Listener per il pulsante di esportazione
        elements.exportReportBtn.addEventListener('click', showExportModal);
        
        // Listener per il pulsante di conferma esportazione
        elements.confirmExportBtn.addEventListener('click', exportReport);
        
        // Gestione delle opzioni di esportazione
        elements.exportOptions.forEach(option => {
            option.addEventListener('click', function() {
                // Rimuovi la classe 'selected' da tutte le opzioni
                elements.exportOptions.forEach(opt => opt.classList.remove('selected'));
                
                // Aggiungi la classe 'selected' all'opzione cliccata
                this.classList.add('selected');
                
                // Aggiorna il formato selezionato
                selectedFormat = this.getAttribute('data-format');
                
                // Abilita/disabilita l'opzione "Includi grafici" in base al formato
                elements.includeChartsCheckbox.disabled = selectedFormat !== 'pdf';
                if (selectedFormat !== 'pdf') {
                    elements.includeChartsCheckbox.checked = false;
                } else {
                    elements.includeChartsCheckbox.checked = true;
                }
            });
        });
        
        // Listener per il logout
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
    }
    
    // Imposta le date in base all'intervallo selezionato
    function setDateRangeFromSelection(range) {
        const now = new Date();
        let startDate;
        
        switch (range) {
           case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 1);
                break;
            case 'quarter':
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 3);
                break;
            case 'year':
                startDate = new Date(now);
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            default:
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 1);
        }
        
        elements.startDate.value = formatDateForInput(startDate);
        elements.endDate.value = formatDateForInput(now);
    }
    
    // Genera il report
    async function generateReport() {
        try {
            // Mostra il loader
            elements.reportLoading.style.display = 'flex';
            
            // Ottieni l'intervallo di date
            const dateRange = getDateRange();
            
            // Carica i dati
            const data = await loadReportData(dateRange);
            
            // Memorizza i dati per l'esportazione
            reportData = data;
            
            // Aggiorna le metriche e i grafici
            updateReportMetrics(data);
            updateReportCharts(data);
            updateGoalsList(data.goals);
            updateWorkoutsTable(data.workouts);
            
            // Rimuovi il loader
            elements.reportLoading.style.display = 'none';
        } catch (error) {
            console.error('Error generating report:', error);
            showToast('Errore nella generazione del report', 'error');
            elements.reportLoading.style.display = 'none';
        }
    }
    
    // Ottieni il range di date
    function getDateRange() {
        const timeRange = elements.timeRange.value;
        
        if (timeRange === 'custom') {
            return {
                start: new Date(elements.startDate.value),
                end: new Date(elements.endDate.value)
            };
        } else {
            const now = new Date();
            now.setHours(23, 59, 59, 999); // Fine della giornata
            
            let startDate;
            switch (timeRange) {
                case 'week':
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    startDate = new Date(now);
                    startDate.setMonth(now.getMonth() - 1);
                    break;
                case 'quarter':
                    startDate = new Date(now);
                    startDate.setMonth(now.getMonth() - 3);
                    break;
                case 'year':
                    startDate = new Date(now);
                    startDate.setFullYear(now.getFullYear() - 1);
                    break;
                default:
                    startDate = new Date(now);
                    startDate.setMonth(now.getMonth() - 1);
            }
            
            startDate.setHours(0, 0, 0, 0); // Inizio della giornata
            
            return { start: startDate, end: now };
        }
    }
    
    // Carica i dati per il report
    async function loadReportData(dateRange) {
        if (!currentUser) {
            throw new Error('Utente non autenticato');
        }
        
        // Prepara il timestamp di inizio e fine
        const startTimestamp = dateRange.start.toISOString();
        const endTimestamp = dateRange.end.toISOString();
        
        // Carica i workout nel periodo selezionato
        const { data: currentWorkouts, error: workoutsError } = await supabaseClient
            .from('completed_workouts')
            .select(`
                *,
                workout_plans (
                    *,
                    activities (name)
                )
            `)
            .eq('user_id', currentUser.id)
            .gte('completed_at', startTimestamp)
            .lte('completed_at', endTimestamp)
            .order('completed_at', { ascending: false });
            
        if (workoutsError) throw workoutsError;
        
        // Calcola l'intervallo di riferimento precedente (per calcolare i trend)
        const previousStart = new Date(dateRange.start);
        const previousEnd = new Date(dateRange.end);
        const intervalDuration = dateRange.end.getTime() - dateRange.start.getTime();
        previousStart.setTime(previousStart.getTime() - intervalDuration);
        previousEnd.setTime(previousEnd.getTime() - intervalDuration);
        
        // Carica i workout nel periodo precedente per confronto
        const { data: previousWorkouts, error: prevWorkoutsError } = await supabaseClient
            .from('completed_workouts')
            .select('*')
            .eq('user_id', currentUser.id)
            .gte('completed_at', previousStart.toISOString())
            .lte('completed_at', previousEnd.toISOString());
            
        if (prevWorkoutsError) throw prevWorkoutsError;
        
        // Carica gli obiettivi nel periodo
        const { data: goals, error: goalsError } = await supabaseClient
            .from('specific_goals')
            .select('*')
            .eq('user_id', currentUser.id)
            .or(`created_at.gte.${startTimestamp},completed_at.gte.${startTimestamp}`)
            .order('created_at', { ascending: false });
            
        if (goalsError) throw goalsError;
        
        return {
            workouts: currentWorkouts || [],
            previousWorkouts: previousWorkouts || [],
            goals: goals || [],
            dateRange: {
                start: dateRange.start,
                end: dateRange.end,
                previousStart,
                previousEnd
            }
        };
    }
    
    // Aggiorna le metriche del report
    function updateReportMetrics(data) {
        const currentWorkouts = data.workouts;
        const previousWorkouts = data.previousWorkouts;
        
        // Calcola le metriche attuali
        const totalWorkouts = currentWorkouts.length;
        
        // Calcola la durata totale
        const totalMinutes = currentWorkouts.reduce((sum, workout) => {
            // Considera actual_duration, oppure duration se non c'è actual_duration
            const duration = workout.actual_duration || workout.duration || 0;
            return sum + parseFloat(duration);
        }, 0);
        
        // Calcola la distanza totale
        const totalDistance = currentWorkouts.reduce((sum, workout) => {
            return sum + (parseFloat(workout.distance) || 0);
        }, 0);
        
        // Calcola le calorie totali
        const totalCalories = currentWorkouts.reduce((sum, workout) => {
            return sum + (parseInt(workout.calories_burned) || 0);
        }, 0);
        
        // Calcola le metriche precedenti
        const prevTotalWorkouts = previousWorkouts.length;
        
        const prevTotalMinutes = previousWorkouts.reduce((sum, workout) => {
            const duration = workout.actual_duration || workout.duration || 0;
            return sum + parseFloat(duration);
        }, 0);
        
        const prevTotalDistance = previousWorkouts.reduce((sum, workout) => {
            return sum + (parseFloat(workout.distance) || 0);
        }, 0);
        
        const prevTotalCalories = previousWorkouts.reduce((sum, workout) => {
            return sum + (parseInt(workout.calories_burned) || 0);
        }, 0);
        
        // Calcola i trend (variazione percentuale)
        const workoutsTrend = calculateTrend(totalWorkouts, prevTotalWorkouts);
        const timeTrend = calculateTrend(totalMinutes, prevTotalMinutes);
        const distanceTrend = calculateTrend(totalDistance, prevTotalDistance);
        const caloriesTrend = calculateTrend(totalCalories, prevTotalCalories);
        
        // Aggiorna i valori nelle card
        elements.totalWorkoutsValue.textContent = totalWorkouts;
        
        // Formatta durata in ore e minuti
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.round(totalMinutes % 60);
        
        if (hours > 0) {
            elements.totalTimeValue.textContent = `${hours}h ${minutes > 0 ? minutes + 'm' : ''}`;
        } else {
            elements.totalTimeValue.textContent = `${minutes}m`;
        }
        
        elements.totalDistanceValue.textContent = `${totalDistance.toFixed(1)} km`;
        elements.totalCaloriesValue.textContent = totalCalories;
        
        // Aggiorna i trend e le icone
        updateTrendDisplay(elements.workoutsTrend, workoutsTrend);
        updateTrendDisplay(elements.timeTrend, timeTrend);
        updateTrendDisplay(elements.distanceTrend, distanceTrend);
        updateTrendDisplay(elements.caloriesTrend, caloriesTrend);
    }
    
    // Calcola il trend (variazione percentuale)
    function calculateTrend(current, previous) {
        if (previous === 0) {
            return current > 0 ? 100 : 0;
        }
        
        return Math.round(((current - previous) / previous) * 100);
    }
    
    // Aggiorna la visualizzazione del trend
    function updateTrendDisplay(element, trendValue) {
        let trendClass = 'positive';
        let trendIcon = 'fa-arrow-up';
        
        if (trendValue < 0) {
            trendClass = 'negative';
            trendIcon = 'fa-arrow-down';
            trendValue = Math.abs(trendValue); // Rimuovi il segno negativo per la visualizzazione
        } else if (trendValue === 0) {
            trendClass = '';
            trendIcon = 'fa-minus';
        }
        
        // Aggiorna la classe
        element.parentElement.className = `report-card-trend ${trendClass}`;
        
        // Aggiorna l'icona
        const iconElement = element.previousElementSibling;
        if (iconElement && iconElement.tagName === 'I') {
            iconElement.className = `fas ${trendIcon}`;
        }
        
        // Aggiorna il valore
        element.textContent = `${trendValue}%`;
    }
    
    // Aggiorna i grafici del report
    function updateReportCharts(data) {
        updateProgressChart(data);
        updateActivityChart(data);
        updateIntensityChart(data);
    }
    
    // Aggiorna il grafico dei progressi
    function updateProgressChart(data) {
        const workouts = data.workouts;
        
        // Se non ci sono workout, mostra un messaggio e non aggiornare il grafico
        if (workouts.length === 0) {
            showNoDataMessage(elements.progressChartCanvas, 'Nessun allenamento nel periodo selezionato');
            return;
        }
        
        // Ordina i workout per data
        const sortedWorkouts = [...workouts].sort((a, b) => 
            new Date(a.completed_at) - new Date(b.completed_at)
        );
        
        // Prepara i dati per il grafico
        const labels = [];
        const durationData = [];
        const distanceData = [];
        
        // Raggruppa per settimana o giorno in base al numero di workout
        const groupByDay = sortedWorkouts.length <= 30;
        
        if (groupByDay) {
            // Raggruppa per giorno
            const dailyData = {};
            
            sortedWorkouts.forEach(workout => {
                const date = new Date(workout.completed_at);
                const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
                
                if (!dailyData[dateStr]) {
                    dailyData[dateStr] = {
                        totalDuration: 0,
                        totalDistance: 0
                    };
                }
                
                dailyData[dateStr].totalDuration += parseFloat(workout.actual_duration || workout.duration || 0);
                dailyData[dateStr].totalDistance += parseFloat(workout.distance || 0);
            });
            
            // Converti in array
            Object.entries(dailyData).forEach(([dateStr, metrics]) => {
                const date = new Date(dateStr);
                const formattedDate = `${date.getDate()}/${date.getMonth() + 1}`;
                
                labels.push(formattedDate);
                durationData.push(metrics.totalDuration);
                distanceData.push(metrics.totalDistance);
            });
        } else {
            // Raggruppa per settimana
            const weeklyData = {};
            
            sortedWorkouts.forEach(workout => {
                const date = new Date(workout.completed_at);
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay()); // Primo giorno della settimana (domenica)
                const weekKey = weekStart.toISOString().split('T')[0]; // YYYY-MM-DD
                
                if (!weeklyData[weekKey]) {
                    weeklyData[weekKey] = {
                        totalDuration: 0,
                        totalDistance: 0,
                        weekStart
                    };
                }
                
                weeklyData[weekKey].totalDuration += parseFloat(workout.actual_duration || workout.duration || 0);
                weeklyData[weekKey].totalDistance += parseFloat(workout.distance || 0);
            });
            
            // Converti in array
            Object.values(weeklyData).sort((a, b) => a.weekStart - b.weekStart).forEach(metrics => {
                const weekStart = metrics.weekStart;
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                
                const formattedDate = `${weekStart.getDate()}/${weekStart.getMonth() + 1} - ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`;
                
                labels.push(formattedDate);
                durationData.push(metrics.totalDuration);
                distanceData.push(metrics.totalDistance);
            });
        }
        
        // Configura il grafico
        const chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Durata (min)',
                        data: durationData,
                        borderColor: '#4361ee',
                        backgroundColor: 'rgba(67, 97, 238, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Distanza (km)',
                        data: distanceData,
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: groupByDay ? 'Giorno' : 'Settimana'
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Durata (min)'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Distanza (km)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        };
        
        // Crea o aggiorna il grafico
        if (progressChart) {
            progressChart.destroy();
        }
        
        progressChart = new Chart(elements.progressChartCanvas, chartConfig);
    }
    
    // Aggiorna il grafico delle attività
    function updateActivityChart(data) {
        const workouts = data.workouts;
        
        // Se non ci sono workout, mostra un messaggio e non aggiornare il grafico
        if (workouts.length === 0) {
            showNoDataMessage(elements.activityChartCanvas, 'Nessun allenamento nel periodo selezionato');
            return;
        }
        
        // Raggruppa i workout per tipo di attività
        const activityCounts = {};
        
        workouts.forEach(workout => {
            if (!workout.workout_plans || !workout.workout_plans.activities) return;
            
            const activityName = workout.workout_plans.activities.name;
            if (!activityName) return;
            
            activityCounts[activityName] = (activityCounts[activityName] || 0) + 1;
        });
        
        // Prepara i dati per il grafico
        const labels = Object.keys(activityCounts);
        const data = Object.values(activityCounts);
        
        // Configura il grafico
        const chartConfig = {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#4361ee',
                        '#3a0ca3',
                        '#7209b7',
                        '#f72585',
                        '#2ecc71',
                        '#3498db',
                        '#f39c12',
                        '#e74c3c'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
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
        };
        
        // Crea o aggiorna il grafico
        if (activityChart) {
            activityChart.destroy();
        }
        
        activityChart = new Chart(elements.activityChartCanvas, chartConfig);
    }
    
    // Aggiorna il grafico dell'intensità
    function updateIntensityChart(data) {
        const workouts = data.workouts;
        
        // Se non ci sono workout, mostra un messaggio e non aggiornare il grafico
        if (workouts.length === 0) {
            showNoDataMessage(elements.intensityChartCanvas, 'Nessun allenamento nel periodo selezionato');
            return;
        }
        
        // Conta le intensità
        const intensityCounts = {
            'Bassa': 0,
            'Media': 0,
            'Alta': 0
        };
        
        workouts.forEach(workout => {
            // Determina l'intensità in base alla difficoltà
            const difficulty = workout.difficulty || 
                               (workout.workout_plans ? workout.workout_plans.difficulty : '');
            
            if (difficulty) {
                if (difficulty.toLowerCase().includes('princ') || difficulty.toLowerCase() === 'bassa') {
                    intensityCounts['Bassa']++;
                } else if (difficulty.toLowerCase().includes('interm') || difficulty.toLowerCase() === 'media') {
                    intensityCounts['Media']++;
                } else if (difficulty.toLowerCase().includes('avanz') || difficulty.toLowerCase() === 'alta') {
                    intensityCounts['Alta']++;
                } else {
                    intensityCounts['Media']++; // Default a media se non riconosciuta
                }
            } else {
                intensityCounts['Media']++; // Default a media se non specificata
            }
        });
        
        // Configura il grafico
        const chartConfig = {
            type: 'bar',
            data: {
                labels: Object.keys(intensityCounts),
                datasets: [{
                    label: 'Numero di allenamenti',
                    data: Object.values(intensityCounts),
                    backgroundColor: [
                        '#2ecc71', // Verde per bassa intensità
                        '#f39c12', // Arancione per media intensità
                        '#e74c3c'  // Rosso per alta intensità
                    ],
                    borderWidth: 1,
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
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
        };
        
        // Crea o aggiorna il grafico
        if (intensityChart) {
            intensityChart.destroy();
        }
        
        intensityChart = new Chart(elements.intensityChartCanvas, chartConfig);
    }
    
    // Aggiorna la lista degli obiettivi
    function updateGoalsList(goals) {
        const container = elements.goalsContainer;
        
        // Se non ci sono obiettivi, mostra un messaggio
        if (!goals || goals.length === 0) {
            container.innerHTML = `
                <div class="no-data-message">
                    <i class="fas fa-info-circle"></i>
                    <p>Nessun obiettivo impostato per questo periodo</p>
                </div>
            `;
            return;
        }
        
        // Crea gli elementi HTML per ogni obiettivo
        const goalsHTML = goals.map(goal => {
            const completed = goal.completed;
            let status = 'in-progress';
            let statusText = 'In Corso';
            let progress = 50; // Valore predefinito
            
            if (completed) {
                status = 'completed';
                statusText = 'Completato';
                progress = 100;
            } else {
                // Calcola un valore di progresso simulato basato sulla data di creazione
                const creationDate = new Date(goal.created_at);
                const now = new Date();
                const daysSinceCreation = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
                
                if (daysSinceCreation < 2) {
                    progress = 10;
                } else if (daysSinceCreation < 5) {
                    progress = 30;
                } else if (daysSinceCreation < 10) {
                    progress = 50;
                } else if (daysSinceCreation < 20) {
                    progress = 75;
                } else {
                    progress = 90;
                }
            }
            
            return `
                <div class="goal-item">
                    <div class="goal-header">
                        <div class="goal-title">${goal.description}</div>
                        <div class="goal-status ${status}">${statusText}</div>
                    </div>
                    <div class="goal-progress-bar">
                        <div class="goal-progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = goalsHTML;
    }
    
    // Aggiorna la tabella degli allenamenti
    function updateWorkoutsTable(workouts) {
        const tableBody = elements.workoutsTableBody;
        
        // Se non ci sono workout, mostra un messaggio
        if (!workouts || workouts.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="no-data-cell">
                        <div class="no-data-message">
                            <i class="fas fa-info-circle"></i>
                            <p>Nessun allenamento nel periodo selezionato</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        // Crea le righe della tabella
        const rowsHTML = workouts.map(workout => {
            // Formatta la data
            const workoutDate = new Date(workout.completed_at);
            const formattedDate = workoutDate.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            
            // Determina l'attività
            const activityName = workout.workout_plans?.activities?.name || 'Non specificata';
            
            // Determina la durata
            const duration = workout.actual_duration || workout.duration || 0;
            
            // Determina la distanza
            const distance = workout.distance || 0;
            
            // Determina le calorie
            const calories = workout.calories_burned || 0;
            
            // Determina l'intensità in base alla difficoltà
            let intensity = 'Media';
            let intensityClass = 'intensity-medium';
            
            const difficulty = workout.difficulty || 
                               (workout.workout_plans ? workout.workout_plans.difficulty : '');
            
            if (difficulty) {
                if (difficulty.toLowerCase().includes('princ') || difficulty.toLowerCase() === 'bassa') {
                    intensity = 'Bassa';
                    intensityClass = 'intensity-low';
                } else if (difficulty.toLowerCase().includes('interm') || difficulty.toLowerCase() === 'media') {
                    intensity = 'Media';
                    intensityClass = 'intensity-medium';
                } else if (difficulty.toLowerCase().includes('avanz') || difficulty.toLowerCase() === 'alta') {
                    intensity = 'Alta';
                    intensityClass = 'intensity-high';
                }
            }
            
            return `
                <tr>
                    <td>${formattedDate}</td>
                    <td>${activityName}</td>
                    <td>${duration} min</td>
                    <td>${distance} km</td>
                    <td>${calories}</td>
                    <td><span class="intensity-badge ${intensityClass}">${intensity}</span></td>
                </tr>
            `;
        }).join('');
        
        tableBody.innerHTML = rowsHTML;
    }
    
    // Mostra un messaggio "Nessun dato" sul canvas di un grafico
    function showNoDataMessage(canvas, message) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#6c757d';
        ctx.font = '14px Inter, sans-serif';
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    }
    
    // Mostra il modal di esportazione
    function showExportModal() {
        // Verifica che ci siano dati da esportare
        if (!reportData || !reportData.workouts || reportData.workouts.length === 0) {
            showToast('Nessun dato da esportare', 'warning');
            return;
        }
        
        // Imposta il nome del file con la data corrente
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
        elements.exportFilename.value = `report_allenamenti_${dateStr}`;
        
        // Imposta PDF come opzione predefinita
        elements.exportOptions.forEach(opt => opt.classList.remove('selected'));
        elements.exportOptions[0].classList.add('selected'); // PDF è la prima opzione
        selectedFormat = 'pdf';
        
        // Mostra il modal
        elements.exportModal.style.display = 'flex';
    }
    
    // Esporta il report nel formato selezionato
    function exportReport() {
        try {
            if (!reportData || !reportData.workouts || reportData.workouts.length === 0) {
                showToast('Nessun dato da esportare', 'warning');
                return;
            }
            
            const filename = elements.exportFilename.value || 'report_allenamenti';
            const includeCharts = elements.includeChartsCheckbox.checked;
            const includeRawData = elements.includeRawDataCheckbox.checked;
            
            switch (selectedFormat) {
                case 'pdf':
                    exportToPdf(filename, includeCharts, includeRawData);
                    break;
                case 'csv':
                    exportToCsv(filename, includeRawData);
                    break;
                case 'excel':
                    exportToExcel(filename, includeRawData);
                    break;
                case 'json':
                    exportToJson(filename, includeRawData);
                    break;
                default:
                    showToast('Formato non supportato', 'error');
                    return;
            }
            
            // Chiudi il modal
            closeModal('exportModal');
            
            // Mostra un messaggio di successo
            showToast('Report esportato con successo', 'success');
        } catch (error) {
            console.error('Error exporting report:', error);
            showToast('Errore nell\'esportazione del report', 'error');
        }
    }
    
    // Esporta in PDF
    function exportToPdf(filename, includeCharts, includeRawData) {
        // Nota: per una vera implementazione, usa jsPDF
        // Qui simuliamo solo l'esportazione
        console.log('Exporting to PDF:', { filename, includeCharts, includeRawData });
        
        // Esempio di come potrebbe essere l'esportazione reale con jsPDF
        /*
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Titolo
        doc.setFontSize(20);
        doc.text('Report Allenamenti', 105, 20, { align: 'center' });
        
        // Sottotitolo con intervallo di date
        const startDate = reportData.dateRange.start.toLocaleDateString('it-IT');
        const endDate = reportData.dateRange.end.toLocaleDateString('it-IT');
        doc.setFontSize(12);
        doc.text(`Periodo: ${startDate} - ${endDate}`, 105, 30, { align: 'center' });
        
        // Panoramica
        doc.setFontSize(16);
        doc.text('Panoramica', 20, 45);
        
        // Metriche
        doc.setFontSize(12);
        doc.text(`Allenamenti Totali: ${reportData.workouts.length}`, 20, 55);
        
        // Calcola la durata totale
        const totalMinutes = reportData.workouts.reduce((sum, w) => 
            sum + parseFloat(w.actual_duration || w.duration || 0), 0);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.round(totalMinutes % 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes > 0 ? minutes + 'm' : ''}` : `${minutes}m`;
        
        doc.text(`Tempo Totale: ${timeStr}`, 20, 65);
        
        // Calcola la distanza totale
        const totalDistance = reportData.workouts.reduce((sum, w) => 
            sum + parseFloat(w.distance || 0), 0);
        doc.text(`Distanza Totale: ${totalDistance.toFixed(1)} km`, 20, 75);
        
        // Calcola le calorie totali
        const totalCalories = reportData.workouts.reduce((sum, w) => 
            sum + parseInt(w.calories_burned || 0), 0);
        doc.text(`Calorie Bruciate: ${totalCalories}`, 20, 85);
        
        if (includeCharts) {
            // Aggiungi i grafici come immagini
            // Questo richiede la conversione dei canvas in immagini
            let currentY = 100;
            
            if (progressChart) {
                const progressImg = progressChart.toBase64Image();
                doc.addImage(progressImg, 'JPEG', 15, currentY, 180, 90);
                currentY += 100;
            }
            
            if (activityChart) {
                const activityImg = activityChart.toBase64Image();
                doc.addImage(activityImg, 'JPEG', 15, currentY, 180, 90);
                currentY += 100;
            }
            
            if (intensityChart) {
                const intensityImg = intensityChart.toBase64Image();
                doc.addImage(intensityImg, 'JPEG', 15, currentY, 180, 90);
                currentY += 100;
            }
        }
        
        if (includeRawData) {
            // Aggiungi una nuova pagina per i dati grezzi
            doc.addPage();
            
            doc.setFontSize(16);
            doc.text('Dettaglio Allenamenti', 20, 20);
            
            // Intestazione tabella
            doc.setFontSize(10);
            doc.text('Data', 20, 30);
            doc.text('Attività', 60, 30);
            doc.text('Durata', 100, 30);
            doc.text('Distanza', 130, 30);
            doc.text('Calorie', 160, 30);
            
            // Righe tabella
            let y = 40;
            reportData.workouts.forEach((workout, index) => {
                // Aggiungi una nuova pagina se necessario
                if (y > 280) {
                    doc.addPage();
                    y = 20;
                    
                    // Ripeti le intestazioni
                    doc.text('Data', 20, y);
                    doc.text('Attività', 60, y);
                    doc.text('Durata', 100, y);
                    doc.text('Distanza', 130, y);
                    doc.text('Calorie', 160, y);
                    
                    y += 10;
                }
                
                const date = new Date(workout.completed_at).toLocaleDateString('it-IT');
                const activity = workout.workout_plans?.activities?.name || 'N/A';
                const duration = workout.actual_duration || workout.duration || 0;
                const distance = workout.distance || 0;
                const calories = workout.calories_burned || 0;
                
                doc.text(date, 20, y);
                doc.text(activity, 60, y);
                doc.text(`${duration} min`, 100, y);
                doc.text(`${distance} km`, 130, y);
                doc.text(calories.toString(), 160, y);
                
                y += 10;
            });
        }
        
        // Salva il PDF
        doc.save(`${filename}.pdf`);
        */
        
        // Simula il download
        simulateFileDownload(`${filename}.pdf`);
    }
    
    // Esporta in CSV
    function exportToCsv(filename, includeRawData) {
        if (!includeRawData || !reportData.workouts.length) {
            showToast('Nessun dato da esportare', 'warning');
            return;
        }
        
        // Intestazioni
        const headers = [
            'Data',
            'Attività',
            'Durata (min)',
            'Distanza (km)',
            'Calorie',
            'Intensità'
        ];
        
        // Righe di dati
        const rows = reportData.workouts.map(workout => {
            // Formatta la data
            const date = new Date(workout.completed_at).toLocaleDateString('it-IT');
            
            // Determina l'attività
            const activity = workout.workout_plans?.activities?.name || 'Non specificata';
            
            // Determina la durata
            const duration = workout.actual_duration || workout.duration || 0;
            
            // Determina la distanza
            const distance = workout.distance || 0;
            
            // Determina le calorie
            const calories = workout.calories_burned || 0;
            
            // Determina l'intensità
            let intensity = 'Media';
            const difficulty = workout.difficulty || 
                               (workout.workout_plans ? workout.workout_plans.difficulty : '');
            
            if (difficulty) {
                if (difficulty.toLowerCase().includes('princ') || difficulty.toLowerCase() === 'bassa') {
                    intensity = 'Bassa';
                } else if (difficulty.toLowerCase().includes('interm') || difficulty.toLowerCase() === 'media') {
                    intensity = 'Media';
                } else if (difficulty.toLowerCase().includes('avanz') || difficulty.toLowerCase() === 'alta') {
                    intensity = 'Alta';
                }
            }
            
            return [
                date,
                activity,
                duration,
                distance,
                calories,
                intensity
            ];
        });
        
        // Aggiungi righe di riepilogo
        const summaryRows = [
            [],  // Riga vuota
            ['Riepilogo'],
            ['Allenamenti Totali', reportData.workouts.length],
            ['Tempo Totale (min)', reportData.workouts.reduce((sum, w) => sum + parseFloat(w.actual_duration || w.duration || 0), 0)],
            ['Distanza Totale (km)', reportData.workouts.reduce((sum, w) => sum + parseFloat(w.distance || 0), 0).toFixed(1)],
            ['Calorie Bruciate', reportData.workouts.reduce((sum, w) => sum + parseInt(w.calories_burned || 0), 0)]
        ];
        
        // Combina tutte le righe
        const allRows = [headers, ...rows, ...summaryRows];
        
        // Converti in CSV
        const csvContent = allRows
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        // Crea un link per il download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Esporta in Excel
    function exportToExcel(filename, includeRawData) {
        if (!includeRawData || !reportData.workouts.length) {
            showToast('Nessun dato da esportare', 'warning');
            return;
        }
        
        // Nota: per una vera implementazione, usa xlsx
        // Qui simuliamo solo l'esportazione
        console.log('Exporting to Excel:', { filename, includeRawData });
        
        // Esempio di come potrebbe essere l'esportazione reale con xlsx
        /*
        const workbook = XLSX.utils.book_new();
        
        // Dati di riepilogo
        const summaryData = [
            ['Report Allenamenti'],
            [`Periodo: ${reportData.dateRange.start.toLocaleDateString('it-IT')} - ${reportData.dateRange.end.toLocaleDateString('it-IT')}`],
            [],
            ['Metriche', 'Valore', 'Variazione'],
            ['Allenamenti Totali', reportData.workouts.length, calculateTrend(reportData.workouts.length, reportData.previousWorkouts.length) + '%'],
            ['Tempo Totale (min)', reportData.workouts.reduce((sum, w) => sum + parseFloat(w.actual_duration || w.duration || 0), 0), ''],
            ['Distanza Totale (km)', reportData.workouts.reduce((sum, w) => sum + parseFloat(w.distance || 0), 0).toFixed(1), ''],
            ['Calorie Bruciate', reportData.workouts.reduce((sum, w) => sum + parseInt(w.calories_burned || 0), 0), '']
        ];
        
        // Crea un foglio per il riepilogo
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Riepilogo');
        
        if (includeRawData) {
            // Prepara i dati per il foglio dettagliato
            const headers = [
                'Data',
                'Attività',
                'Durata (min)',
                'Distanza (km)',
                'Calorie',
                'Intensità'
            ];
            
            const rows = reportData.workouts.map(workout => {
                const date = new Date(workout.completed_at).toLocaleDateString('it-IT');
                const activity = workout.workout_plans?.activities?.name || 'Non specificata';
                const duration = workout.actual_duration || workout.duration || 0;
                const distance = workout.distance || 0;
                const calories = workout.calories_burned || 0;
                
                let intensity = 'Media';
                const difficulty = workout.difficulty || 
                                 (workout.workout_plans ? workout.workout_plans.difficulty : '');
                
                if (difficulty) {
                    if (difficulty.toLowerCase().includes('princ') || difficulty.toLowerCase() === 'bassa') {
                        intensity = 'Bassa';
                    } else if (difficulty.toLowerCase().includes('interm') || difficulty.toLowerCase() === 'media') {
                        intensity = 'Media';
                    } else if (difficulty.toLowerCase().includes('avanz') || difficulty.toLowerCase() === 'alta') {
                        intensity = 'Alta';
                    }
                }
                
                return [
                    date,
                    activity,
                    duration,
                    distance,
                    calories,
                    intensity
                ];
            });
            
            // Crea un foglio per i dettagli
            const detailsData = [headers, ...rows];
            const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);
            XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Dettagli Allenamenti');
        }
        
        // Scarica il file Excel
        XLSX.writeFile(workbook, `${filename}.xlsx`);
        */
        
        // Simula il download
        simulateFileDownload(`${filename}.xlsx`);
    }
    
    // Esporta in JSON
    function exportToJson(filename, includeRawData) {
        let data = {
            reportDate: new Date().toISOString(),
            period: {
                start: reportData.dateRange.start.toISOString(),
                end: reportData.dateRange.end.toISOString()
            },
            summary: {
                totalWorkouts: reportData.workouts.length,
                totalDuration: reportData.workouts.reduce((sum, w) => sum + parseFloat(w.actual_duration || w.duration || 0), 0),
                totalDistance: reportData.workouts.reduce((sum, w) => sum + parseFloat(w.distance || 0), 0),
                totalCalories: reportData.workouts.reduce((sum, w) => sum + parseInt(w.calories_burned || 0), 0)
            }
        };
        
        // Aggiungi i dati grezzi se richiesto
        if (includeRawData) {
            data.workouts = reportData.workouts.map(workout => ({
                id: workout.id,
                date: workout.completed_at,
                activity: workout.workout_plans?.activities?.name || 'Non specificata',
                duration: workout.actual_duration || workout.duration || 0,
                distance: workout.distance || 0,
                calories: workout.calories_burned || 0,
                difficulty: workout.difficulty || (workout.workout_plans ? workout.workout_plans.difficulty : 'Media')
            }));
        }
        
        // Converti in stringa JSON
        const jsonString = JSON.stringify(data, null, 2);
        
        // Crea un link per il download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Simula il download di un file (per i formati non implementati completamente)
    function simulateFileDownload(filename) {
        // Crea un elemento di testo temporaneo
        const blob = new Blob(['Simulazione di download del file: ' + filename], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Chiudi un modal
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    // Inizializza l'app
    init();
});