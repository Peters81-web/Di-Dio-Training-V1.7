// Gestione della pagina statistiche - Versione corretta e migliorata
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Inizializzazione pagina statistiche...');
    
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    
    // Variabili globali
    let currentUser = null;
    let allWorkouts = [];
    let currentPeriod = {
        type: 'month',
        year: new Date().getFullYear(),
        month: new Date().getMonth(),
        week: getCurrentWeekNumber()
    };
    
    // Elementi DOM
    const elements = {
        periodType: document.getElementById('periodTypeSelector'),
        year: document.getElementById('yearSelector'),
        month: document.getElementById('monthSelector'),
        week: document.getElementById('weekSelector'),
        currentPeriod: document.getElementById('currentPeriodDisplay'),
        activityChart: document.getElementById('activityChart'),
        weeklyChart: document.getElementById('weeklyChart'),
        performanceMetrics: document.getElementById('performanceMetrics'),
        achievements: document.getElementById('achievementsList'),
        logoutBtn: document.getElementById('logoutBtn'),
        resetBtn: document.getElementById('resetDataBtn')
    };
    
    // Grafici
    let charts = {
        activity: null,
        weekly: null,
        weight: null,
        distance: null,
        calories: null,
        heartRate: null
    };
    
    // Funzione principale di inizializzazione
    async function init() {
        try {
            console.log('Verifica autenticazione...');
            
            // Verifica autenticazione
            const session = await checkAuth();
            if (!session) {
                console.error('Sessione non valida, reindirizzamento al login');
                return;
            }
            
            currentUser = session.user;
            console.log('Utente autenticato:', currentUser.email);
            
            // Configura event listeners
            setupEventListeners();
            
            // Carica e visualizza i dati
            await loadAndDisplayData();
            
            console.log('Inizializzazione completata con successo');
            
        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            showError('Errore di inizializzazione: ' + error.message);
        }
    }
    
    // Verifica autenticazione
    async function checkAuth() {
        try {
            if (!supabaseClient) {
                throw new Error('Client Supabase non disponibile');
            }
            
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error) {
                throw error;
            }
            
            if (!session) {
                console.log('Nessuna sessione attiva, reindirizzamento...');
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
    
    // Carica e visualizza tutti i dati
    async function loadAndDisplayData() {
        try {
            console.log('Caricamento dati...');
            
            // Mostra loading
            showLoading();
            
            // Carica tutti gli allenamenti completati
            await loadCompletedWorkouts();
            
            // Aggiorna visualizzazioni
            updatePerformanceMetrics();
            updateActivityChart();
            updateWeeklyChart();
            updateAchievements();
            
            // Inizializza grafici avanzati
            await initializeAdvancedCharts();
            
            console.log('Dati caricati e visualizzati con successo');
            
        } catch (error) {
            console.error('Errore nel caricamento dei dati:', error);
            showError('Errore nel caricamento dei dati: ' + error.message);
        } finally {
            hideLoading();
        }
    }
    
    // Carica gli allenamenti completati
    async function loadCompletedWorkouts() {
        try {
            const { data, error } = await supabaseClient
                .from('completed_workouts')
                .select(`
                    *,
                    workout_plans (
                        *,
                        activities (name)
                    )
                `)
                .eq('user_id', currentUser.id)
                .order('completed_at', { ascending: false });
                
            if (error) {
                throw error;
            }
            
            allWorkouts = data || [];
            console.log(`Caricati ${allWorkouts.length} allenamenti completati`);
            
        } catch (error) {
            console.error('Errore nel caricamento degli allenamenti:', error);
            allWorkouts = [];
        }
    }
    
    // Aggiorna le metriche di performance
    function updatePerformanceMetrics() {
        if (!elements.performanceMetrics) return;
        
        const metrics = calculateMetrics(allWorkouts);
        
        elements.performanceMetrics.innerHTML = `
            <div class="metric-card">
                <div class="metric-icon">
                    <i class="fas fa-dumbbell"></i>
                </div>
                <div class="metric-content">
                    <div class="metric-value">${metrics.totalWorkouts}</div>
                    <div class="metric-label">Allenamenti Totali</div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon">
                    <i class="fas fa-clock"></i>
                </div>
                <div class="metric-content">
                    <div class="metric-value">${formatDuration(metrics.totalDuration)}</div>
                    <div class="metric-label">Tempo Totale</div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon">
                    <i class="fas fa-route"></i>
                </div>
                <div class="metric-content">
                    <div class="metric-value">${metrics.totalDistance.toFixed(1)} km</div>
                    <div class="metric-label">Distanza Totale</div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon">
                    <i class="fas fa-fire"></i>
                </div>
                <div class="metric-content">
                    <div class="metric-value">${metrics.totalCalories}</div>
                    <div class="metric-label">Calorie Bruciate</div>
                </div>
            </div>
        `;
    }
    
    // Aggiorna il grafico delle attività
    function updateActivityChart() {
        if (!elements.activityChart) return;
        
        // Distruggi grafico esistente
        if (charts.activity) {
            charts.activity.destroy();
        }
        
        const activityData = processActivityData(allWorkouts);
        
        if (activityData.labels.length === 0) {
            showNoDataMessage(elements.activityChart, 'Nessuna attività registrata');
            return;
        }
        
        const ctx = elements.activityChart.getContext('2d');
        charts.activity = new Chart(ctx, {
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
                    ],
                    borderWidth: 0,
                    hoverBorderWidth: 3,
                    hoverBorderColor: '#fff'
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
                            usePointStyle: true,
                            font: {
                                size: 12,
                                family: 'Inter'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#4361ee',
                        borderWidth: 1,
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
                },
                cutout: '60%'
            }
        });
    }
    
    // Aggiorna il grafico settimanale
    function updateWeeklyChart() {
        if (!elements.weeklyChart) return;
        
        // Distruggi grafico esistente
        if (charts.weekly) {
            charts.weekly.destroy();
        }
        
        const weeklyData = processWeeklyData(allWorkouts);
        
        if (weeklyData.labels.length === 0) {
            showNoDataMessage(elements.weeklyChart, 'Nessun dato settimanale disponibile');
            return;
        }
        
        const ctx = elements.weeklyChart.getContext('2d');
        charts.weekly = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: weeklyData.labels,
                datasets: [{
                    label: 'Allenamenti',
                    data: weeklyData.data,
                    backgroundColor: 'rgba(67, 97, 238, 0.8)',
                    borderColor: '#4361ee',
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#4361ee',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            font: {
                                family: 'Inter'
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                family: 'Inter'
                            }
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    // Aggiorna gli achievements
    function updateAchievements() {
        if (!elements.achievements) return;
        
        const achievements = calculateAchievements(allWorkouts);
        
        if (achievements.length === 0) {
            elements.achievements.innerHTML = `
                <div class="no-achievements">
                    <i class="fas fa-trophy"></i>
                    <p>Completa alcuni allenamenti per sbloccare i tuoi primi traguardi!</p>
                </div>
            `;
            return;
        }
        
        elements.achievements.innerHTML = achievements.map(achievement => `
            <div class="achievement-card">
                <div class="achievement-icon">
                    <i class="${achievement.icon}"></i>
                </div>
                <div class="achievement-content">
                    <h4>${achievement.title}</h4>
                    <p>${achievement.description}</p>
                </div>
            </div>
        `).join('');
    }
    
    // Inizializza grafici avanzati
    async function initializeAdvancedCharts() {
        try {
            // Grafico peso nel tempo
            await initializeWeightChart();
            
            // Grafico distanza per attività
            initializeDistanceChart();
            
            // Grafico calorie bruciate
            initializeCaloriesChart();
            
            // Grafico frequenza cardiaca
            initializeHeartRateChart();
            
        } catch (error) {
            console.error('Errore nell\'inizializzazione dei grafici avanzati:', error);
        }
    }
    
    // Grafico peso nel tempo
    async function initializeWeightChart() {
        const ctx = document.getElementById('weightTrendChart');
        if (!ctx) return;
        
        try {
            // Simuliamo alcuni dati di peso per il grafico
            const weightData = generateSampleWeightData();
            
            if (charts.weight) {
                charts.weight.destroy();
            }
            
            charts.weight = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: weightData.labels,
                    datasets: [{
                        label: 'Peso (kg)',
                        data: weightData.data,
                        borderColor: '#4361ee',
                        backgroundColor: 'rgba(67, 97, 238, 0.1)',
                        borderWidth: 2,
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
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.1)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error('Errore nel grafico del peso:', error);
        }
    }
    
    // Altri grafici avanzati
    function initializeDistanceChart() {
        const ctx = document.getElementById('distanceByActivityChart');
        if (!ctx) return;
        
        const distanceData = processDistanceByActivity(allWorkouts);
        
        if (charts.distance) {
            charts.distance.destroy();
        }
        
        charts.distance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: distanceData.labels,
                datasets: [{
                    label: 'Distanza (km)',
                    data: distanceData.data,
                    backgroundColor: '#3a0ca3',
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
                }
            }
        });
    }
    
    function initializeCaloriesChart() {
        const ctx = document.getElementById('caloriesBurnedChart');
        if (!ctx) return;
        
        const caloriesData = processCaloriesByDay(allWorkouts);
        
        if (charts.calories) {
            charts.calories.destroy();
        }
        
        charts.calories = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
                datasets: [{
                    label: 'Calorie bruciate',
                    data: caloriesData,
                    backgroundColor: '#f72585',
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
                }
            }
        });
    }
    
    function initializeHeartRateChart() {
        const ctx = document.getElementById('heartRateChart');
        if (!ctx) return;
        
        // Dati simulati per la frequenza cardiaca
        const hrData = generateSampleHeartRateData();
        
        if (charts.heartRate) {
            charts.heartRate.destroy();
        }
        
        charts.heartRate = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hrData.labels,
                datasets: [{
                    label: 'Frequenza cardiaca media (bpm)',
                    data: hrData.data,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    // Funzioni di elaborazione dati
    function calculateMetrics(workouts) {
        if (!workouts || workouts.length === 0) {
            return {
                totalWorkouts: 0,
                totalDuration: 0,
                totalDistance: 0,
                totalCalories: 0
            };
        }
        
        return {
            totalWorkouts: workouts.length,
            totalDuration: workouts.reduce((sum, w) => sum + (parseFloat(w.actual_duration) || 0), 0),
            totalDistance: workouts.reduce((sum, w) => sum + (parseFloat(w.distance) || 0), 0),
            totalCalories: workouts.reduce((sum, w) => sum + (parseInt(w.calories_burned) || 0), 0)
        };
    }
    
    function processActivityData(workouts) {
        const activityCounts = {};
        
        workouts.forEach(workout => {
            const activityName = workout.workout_plans?.activities?.name || 'Altro';
            activityCounts[activityName] = (activityCounts[activityName] || 0) + 1;
        });
        
        return {
            labels: Object.keys(activityCounts),
            data: Object.values(activityCounts)
        };
    }
    
    function processWeeklyData(workouts) {
        const last7Days = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            last7Days.push(date);
        }
        
        const labels = last7Days.map(date => 
            date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
        );
        
        const data = last7Days.map(date => {
            return workouts.filter(workout => {
                const workoutDate = new Date(workout.completed_at);
                return workoutDate.toDateString() === date.toDateString();
            }).length;
        });
        
        return { labels, data };
    }
    
    function processDistanceByActivity(workouts) {
        const activities = {};
        
        workouts.forEach(workout => {
            if (workout.distance && workout.distance > 0) {
                const activity = workout.workout_plans?.activities?.name || 'Altro';
                activities[activity] = (activities[activity] || 0) + parseFloat(workout.distance);
            }
        });
        
        return {
            labels: Object.keys(activities),
            data: Object.values(activities)
        };
    }
    
    function processCaloriesByDay(workouts) {
        const dayCalories = [0, 0, 0, 0, 0, 0, 0]; // Dom-Sab
        
        workouts.forEach(workout => {
            if (workout.calories_burned && workout.calories_burned > 0) {
                const day = new Date(workout.completed_at).getDay();
                dayCalories[day] += parseInt(workout.calories_burned);
            }
        });
        
        return dayCalories;
    }
    
    function calculateAchievements(workouts) {
        const achievements = [];
        
        if (workouts.length >= 1) {
            achievements.push({
                icon: 'fas fa-play',
                title: 'Primo Passo',
                description: 'Hai completato il tuo primo allenamento!'
            });
        }
        
        if (workouts.length >= 5) {
            achievements.push({
                icon: 'fas fa-award',
                title: 'Costanza',
                description: `${workouts.length} allenamenti completati`
            });
        }
        
        if (workouts.length >= 10) {
            achievements.push({
                icon: 'fas fa-medal',
                title: 'Determinazione',
                description: 'Hai raggiunto 10 allenamenti!'
            });
        }
        
        const totalDistance = workouts.reduce((sum, w) => sum + (parseFloat(w.distance) || 0), 0);
        if (totalDistance >= 10) {
            achievements.push({
                icon: 'fas fa-road',
                title: 'Esploratore',
                description: `${totalDistance.toFixed(1)}km percorsi`
            });
        }
        
        return achievements;
    }
    
    // Funzioni di utilità
    function formatDuration(minutes) {
        if (!minutes) return '0 min';
        
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = Math.round(minutes % 60);
        
        if (hours > 0) {
            return `${hours}h ${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
        } else {
            return `${minutes}m`;
        }
    }
    
    function getCurrentWeekNumber() {
        const today = new Date();
        const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
        const pastDaysOfYear = (today - firstDayOfYear) / 86400000;
        return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    }
    
    function generateSampleWeightData() {
        const labels = [];
        const data = [];
        const today = new Date();
        
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            labels.push(date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
            
            // Genera dati simulati del peso
            data.push(70 + Math.random() * 3 - 1.5); // Peso tra 68.5 e 71.5 kg
        }
        
        return { labels, data };
    }
    
    function generateSampleHeartRateData() {
        const labels = [];
        const data = [];
        
        for (let i = 9; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
            
            // Genera dati simulati della frequenza cardiaca
            data.push(140 + Math.random() * 40); // FC tra 140-180 bpm
        }
        
        return { labels, data };
    }
    
    function showNoDataMessage(canvas, message) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#6c757d';
        ctx.font = '16px Inter, sans-serif';
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    }
    
    function showLoading() {
        // Implementa loading spinner se necessario
        console.log('Loading...');
    }
    
    function hideLoading() {
        // Nascondi loading spinner
        console.log('Loading completato');
    }
    
    function showError(message) {
        console.error(message);
        
        // Mostra toast di errore
        const toast = document.createElement('div');
        toast.className = 'toast error-toast';
        toast.innerHTML = `
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }
    
    // Event listeners
    function setupEventListeners() {
        // Logout
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', async () => {
                try {
                    const { error } = await supabaseClient.auth.signOut();
                    if (error) throw error;
                    window.location.href = '/';
                } catch (error) {
                    console.error('Logout error:', error);
                    showError('Errore durante il logout');
                }
            });
        }
        
        // Reset dati
        if (elements.resetBtn) {
            elements.resetBtn.addEventListener('click', () => {
                if (confirm('Sei sicuro di voler eliminare tutti i tuoi dati?')) {
                    resetUserData();
                }
            });
        }
    }
    
    // Reset dati utente
    async function resetUserData() {
        try {
            const { error } = await supabaseClient
                .from('completed_workouts')
                .delete()
                .eq('user_id', currentUser.id);
                
            if (error) throw error;
            
            allWorkouts = [];
            await loadAndDisplayData();
            
            showError('Dati eliminati con successo');
            
        } catch (error) {
            console.error('Errore reset dati:', error);
            showError('Errore durante l\'eliminazione dei dati');
        }
    }
    
    // Avvia inizializzazione
    init();
});