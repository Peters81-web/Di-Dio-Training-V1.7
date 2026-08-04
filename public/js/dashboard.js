/**
 * ===== DASHBOARD.JS - VERSIONE COMPLETA E OTTIMIZZATA =====
 * File: public/js/dashboard.js
 * 
 * Gestisce la dashboard principale dell'applicazione Di Dio Training
 * Include: caricamento allenamenti, statistiche, modal, gestione completa
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('Inizializzazione dashboard...');
    
    // ===== VARIABILI GLOBALI =====
    let currentUser = null;
    let workouts = [];
    let supabaseClient = null;
    
    // ===== ELEMENTI DOM =====
    const elements = {
        workoutList: document.getElementById('workout-list'),
        weeklyStats: document.getElementById('weekly-stats'),
        logoutBtn: document.getElementById('logoutBtn'),
        configureDashboardBtn: document.getElementById('configureDashboardBtn'),
        completeWorkoutForm: document.getElementById('completeWorkoutForm')
    };
    
    // ===== INIZIALIZZAZIONE PRINCIPALE =====
    
    /**
     * Funzione principale di inizializzazione
     */
    async function init() {
        try {
            // Inizializzazione Supabase
             supabaseClient = window.supabaseClient;
            if (!supabaseClient) {
                showToast('Errore di configurazione: ricarica la pagina.', 'error');
                throw new Error('window.supabaseClient non disponibile');
            }
            
            // Verifica autenticazione
            const session = await checkAuthentication();
            if (!session) return;
            
            currentUser = session.user;

            // Setup della dashboard
            setupEventListeners();
            await loadDashboardData();
            
            console.log('Dashboard inizializzata con successo');
            
        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            showToast('Errore durante l\'inizializzazione della dashboard', 'error');
        }
    }
    
    /**
     * Verifica dell'autenticazione utente
     */
    async function checkAuthentication() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error) {
                console.error('Errore autenticazione:', error);
                window.location.href = '/';
                return null;
            }
            
            if (!session || !session.user) {
                console.log('Nessuna sessione valida, reindirizzamento al login');
                window.location.href = '/';
                return null;
            }
            
            return session;
        } catch (error) {
            console.error('Errore controllo autenticazione:', error);
            window.location.href = '/';
            return null;
        }
    }
    
    // ===== CARICAMENTO DATI =====
    
    /**
     * Carica tutti i dati della dashboard
     */
    async function loadDashboardData() {
        try {
            showLoading();

            // Carica dati in parallelo per migliori performance
            await Promise.all([
                loadWorkouts(),
                loadCompletions(),
                loadWeeklyStats(),
                loadCaloricBalance()
            ]);

        } catch (error) {
            console.error('Errore nel caricamento dati dashboard:', error);
            showToast('Errore nel caricamento dei dati', 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Carica e mostra il "Bilancio Calorico Stimato" del giorno corrente.
     *
     * Logica:
     *   1) profile.gender + profile.birthdate → età
     *   2) body_measurements: ultimo peso e ultima altezza non-null
     *   3) completed_workouts di OGGI → somma calories_burned
     *   4) CaloricMath.computeAll() → BMR/TDEE/deficit potenziale
     *
     * Se mancano dati essenziali, mostra una card "completa il profilo"
     * con link al /profile. Sempre con disclaimer onesto.
     */
    async function loadCaloricBalance() {
        const section = document.getElementById('caloricBalanceSection');
        const card    = document.getElementById('caloricBalanceCard');
        if (!section || !card || !window.CaloricMath) return;

        // Mostra la sezione (sempre — anche se profilo incompleto, l'utente
        // deve sapere che la feature esiste e come abilitarla)
        section.style.display = '';

        try {
            const todayIso = new Date().toISOString().slice(0, 10);

            // 3 query parallele
            const [profileRes, measureRes, todayWorkoutsRes] = await Promise.all([
                // NB: activity_level non esiste come colonna oggi; useremo
                // 'sedentary' di default. Quando aggiungeremo la colonna basta
                // includerla nel select.
                supabaseClient
                    .from('profiles')
                    .select('gender, birthdate')
                    .eq('id', currentUser.id)
                    .maybeSingle(),
                supabaseClient
                    .from('body_measurements')
                    .select('weight, height, date')
                    .eq('user_id', currentUser.id)
                    .order('date', { ascending: false })
                    .limit(30),
                supabaseClient
                    .from('completed_workouts')
                    .select('calories_burned, completed_at')
                    .eq('user_id', currentUser.id)
                    .gte('completed_at', todayIso + 'T00:00:00')
            ]);

            // Profilo: prendi gender + birthdate (activity_level può non esistere)
            const profile = profileRes.data || {};
            // Misurazioni: trova ultimo weight e ultimo height non-null
            const measures = measureRes.data || [];
            const latestWeight = measures.find(m => m.weight != null);
            const latestHeight = measures.find(m => m.height != null);
            // Calorie oggi
            const todayWorkouts = todayWorkoutsRes.data || [];
            const todayKcal = todayWorkouts.reduce((s, w) => s + (w.calories_burned || 0), 0);

            // Chiama l'utility pura
            const result = window.CaloricMath.computeAll({
                gender:    profile.gender,
                birthdate: profile.birthdate,
                weight:    latestWeight ? latestWeight.weight : null,
                height:    latestHeight ? latestHeight.height : null,
                activity:  profile.activity_level || 'sedentary' // fallback per quando aggiungeremo la colonna
            }, todayKcal);

            if (!result.ok) {
                renderCaloricCardIncomplete(card, result.missing, todayKcal);
            } else {
                renderCaloricCardComplete(card, result);
            }
        } catch (err) {
            console.warn('Caloric balance load error:', err);
            card.innerHTML = `
                <div class="cb-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Impossibile calcolare il bilancio adesso. Riprova più tardi.</span>
                </div>
            `;
        }
    }

    function renderCaloricCardIncomplete(card, missing, todayKcal) {
        const missingList = missing.map(m => `<li>${escapeHtml(m)}</li>`).join('');
        card.innerHTML = `
            <div class="cb-incomplete">
                <div class="cb-incomplete-icon">
                    <i class="fas fa-user-cog"></i>
                </div>
                <div class="cb-incomplete-content">
                    <h3>Completa il tuo profilo</h3>
                    <p>Per stimare il tuo fabbisogno calorico giornaliero servono questi dati:</p>
                    <ul>${missingList}</ul>
                    <a href="/profile" class="btn btn-primary">
                        <i class="fas fa-arrow-right"></i> Vai al profilo
                    </a>
                </div>
                ${todayKcal > 0 ? `
                <div class="cb-incomplete-aside">
                    <div class="cb-aside-label">Hai bruciato oggi</div>
                    <div class="cb-aside-value">${todayKcal} <span>kcal</span></div>
                </div>` : ''}
            </div>
        `;
    }

    function renderCaloricCardComplete(card, r) {
        const deficitAbs = Math.abs(r.potentialDeficit);
        const inDeficit  = r.potentialDeficit < 0;
        const reliabilityMsg = r.reliability.message
            ? `<div class="cb-warn"><i class="fas fa-info-circle"></i> ${escapeHtml(r.reliability.message)}</div>`
            : '';

        // Vista compatta: il numero che conta (spesa stimata oggi) e lo stato
        // del bilancio. Il dettaglio BMR/TDEE occupava mezzo schermo sopra la
        // piega per un'informazione che si consulta, non che guida la
        // giornata: ora si apre al tocco.
        //
        // <details>/<summary> nativi: accessibili da tastiera e da screen
        // reader senza una riga di JavaScript.
        // Composizione della spesa: metabolismo basale, movimento quotidiano
        // e allenamenti. Una barra a segmenti dice a colpo d'occhio da dove
        // arriva il numero, cosa che il solo totale non comunica.
        const dailyMove = Math.max(0, r.tdeeBase - r.bmr);
        const total     = Math.max(1, r.totalExpenditure);
        const seg = v => (v / total * 100).toFixed(1);

        card.innerHTML = `
            <div class="cb-compact">
                <div class="cb-compact-main">
                    <div class="cb-compact-value">${r.totalExpenditure} <span>kcal</span></div>
                    <div class="cb-compact-label">Spesa stimata oggi</div>
                </div>
                <div class="cb-compact-chip ${inDeficit ? 'is-deficit' : 'is-surplus'}">
                    <i class="fas ${inDeficit ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up'}" aria-hidden="true"></i>
                    <span>${inDeficit ? '−' + deficitAbs + ' kcal' : 'Pareggio'}</span>
                </div>
            </div>

            <div class="cb-bar" role="img"
                 aria-label="Composizione: ${r.bmr} kcal di metabolismo basale, ${dailyMove} di movimento quotidiano, ${r.workoutKcal} di allenamenti">
                <span class="cb-bar-seg cb-bar-seg--bmr"     style="width:${seg(r.bmr)}%"></span>
                <span class="cb-bar-seg cb-bar-seg--daily"   style="width:${seg(dailyMove)}%"></span>
                <span class="cb-bar-seg cb-bar-seg--workout" style="width:${seg(r.workoutKcal)}%"></span>
            </div>
            <div class="cb-legend">
                <span class="cb-legend-item"><i class="cb-dot cb-dot--bmr"></i>Basale <strong>${r.bmr}</strong></span>
                <span class="cb-legend-item"><i class="cb-dot cb-dot--daily"></i>Movimento <strong>${dailyMove}</strong></span>
                <span class="cb-legend-item"><i class="cb-dot cb-dot--workout"></i>Allenamenti <strong>${r.workoutKcal}</strong></span>
            </div>

            <details class="cb-details">
                <summary class="cb-details-toggle">
                    <i class="fas fa-chevron-right" aria-hidden="true"></i> Come è calcolato
                </summary>
                <div class="cb-breakdown">
                    <div class="cb-row">
                        <div class="cb-row-label"><i class="fas fa-bed"></i> Fabbisogno base (BMR)</div>
                        <div class="cb-row-value">${r.bmr} <span>kcal</span></div>
                    </div>
                    <div class="cb-row">
                        <div class="cb-row-label"><i class="fas fa-walking"></i> Stile ${escapeHtml(r.activityLabel)} × ${r.activityFactor}</div>
                        <div class="cb-row-value">${r.tdeeBase} <span>kcal</span></div>
                    </div>
                    <div class="cb-row cb-row-plus">
                        <div class="cb-row-label"><i class="fas fa-dumbbell"></i> Allenamenti oggi</div>
                        <div class="cb-row-value">+ ${r.workoutKcal} <span>kcal</span></div>
                    </div>
                    <div class="cb-row cb-row-total">
                        <div class="cb-row-label"><i class="fas fa-fire"></i> Spesa totale stimata</div>
                        <div class="cb-row-value">${r.totalExpenditure} <span>kcal</span></div>
                    </div>
                </div>
                <p class="cb-balance-note">
                    ${inDeficit
                        ? 'Se mantieni la dieta abituale, sei in deficit di queste calorie grazie agli allenamenti di oggi.'
                        : 'Oggi non hai ancora generato deficit con gli allenamenti. Aggiungi una sessione per crearne uno.'
                    }
                </p>
                ${reliabilityMsg}
                <div class="cb-disclaimer">
                    <i class="fas fa-info-circle"></i>
                    <span>
                        <strong>Stima indicativa</strong> basata su formula Mifflin-St Jeor (BMR) e moltiplicatore attività ${r.activityFactor}.
                        Variazione individuale ±10-15%. Per un piano nutrizionale personalizzato consulta un dietista certificato.
                        Non include cosa mangi (intake calorico) — il "deficit potenziale" assume che tu mangi al tuo TDEE base abituale.
                    </span>
                </div>
            </details>
        `;
    }
    
    /**
     * Carica gli allenamenti dell'utente
     */
    // gps_track e max_heart_rate arrivano da migrations/001-gps-track.sql.
    // Se mancassero, Postgres farebbe fallire l'INTERA query e la dashboard
    // resterebbe senza allenamenti: qui è la pagina principale, quindi vale
    // la pena tenere un ripiego invece di rischiare di svuotarla.
    // Elenco unico: non serve più distinguere "base" da "completa", perché
    // selectWorkouts() toglie solo le colonne che il database dichiara di
    // non conoscere, una alla volta. Aggiungere qui una colonna nuova è
    // quindi sicuro anche prima di eseguire la migrazione corrispondente.
    //
    // Da migrazioni:  001 → gps_track, max_heart_rate
    //                 003 → temperature, weather
    //                 004 → source
    const WORKOUT_COLS = [
        'id', 'name', 'activity_id', 'activity_type', 'total_duration',
        'difficulty', 'objective', 'warmup', 'main_phase', 'cooldown', 'notes',
        'created_at', 'scheduled_date', 'completed',
        'gps_track', 'max_heart_rate', 'temperature', 'weather', 'source'
    ];

    function isMissingColumnError(err) {
        if (!err) return false;
        if (err.code === 'PGRST204' || err.code === '42703') return true;
        const m = String(err.message || '').toLowerCase();
        return m.includes('could not find') && m.includes('column');
    }

    /**
     * Estrae il nome della colonna mancante dal messaggio d'errore.
     * PostgREST:  Could not find the 'source' column of 'workout_plans' ...
     * Postgres :  column workout_plans.source does not exist
     */
    function missingColumnName(err) {
        const msg = String((err && err.message) || '');
        let m = msg.match(/could not find the '([^']+)' column/i);
        if (m) return m[1];
        m = msg.match(/column\s+(?:[\w.]*\.)?"?([\w]+)"?\s+does not exist/i);
        return m ? m[1] : null;
    }

    /**
     * Esegue una select togliendo UNA ALLA VOLTA solo le colonne che il
     * database dice di non conoscere.
     *
     * Prima il ripiego era tutto-o-niente: bastava che mancasse una colonna
     * (per esempio 'source' della migrazione 004) perché si ricadesse su una
     * lista minima, perdendo ANCHE gps_track e temperature, che invece
     * esistevano. Risultato: nel dettaglio spariva la mappa pur essendo la
     * traccia regolarmente salvata — e nell'Archivio, che non chiede
     * 'source', la stessa mappa si vedeva benissimo.
     */
    async function selectWorkouts(cols) {
        let current = cols.slice();
        const dropped = [];

        for (let attempt = 0; attempt < 8; attempt++) {
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .select(current.join(', '))
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });

            if (!error) {
                if (dropped.length) {
                    console.warn('Dashboard: colonne non ancora presenti nel database, ' +
                                 'eseguire le migrazioni in migrations/. Ignorate: ' +
                                 dropped.join(', '));
                }
                return { data, error: null, dropped };
            }
            if (!isMissingColumnError(error)) return { data: null, error, dropped };

            const bad = missingColumnName(error);
            // Se non riusciamo a capire QUALE colonna manca, non possiamo
            // togliere alla cieca: meglio restituire l'errore vero.
            if (!bad || !current.includes(bad)) return { data: null, error, dropped };

            current = current.filter(c => c !== bad);
            dropped.push(bad);
        }
        return { data: null, error: new Error('Troppi tentativi di ripiego'), dropped };
    }

    // workout_id -> { distance, calories_burned, heart_rate_avg }
    // Serve al dettaglio: distanza, calorie e FC vivono in
    // completed_workouts, mentre la dashboard legge solo workout_plans.
    // Per le attività importate quei numeri finivano dentro una stringa di
    // testo in main_phase, quindi non erano riutilizzabili.
    let completionsByWorkout = {};

    async function loadCompletions() {
        try {
            const { data, error } = await supabaseClient
                .from('completed_workouts')
                .select('workout_id, distance, calories_burned, heart_rate_avg')
                .eq('user_id', currentUser.id);
            if (error) throw error;
            completionsByWorkout = {};
            (data || []).forEach(c => {
                if (c.workout_id) completionsByWorkout[c.workout_id] = c;
            });
        } catch (err) {
            // Non critico: senza, il dettaglio mostra solo i dati del piano
            console.warn('Dettagli completamenti non disponibili:', err);
            completionsByWorkout = {};
        }
    }

    async function loadWorkouts() {
        try {
            const { data, error } = await selectWorkouts(WORKOUT_COLS);
            if (error) throw error;

            workouts = data || [];
            // renderToday PRIMA di displayWorkouts: se quest'ultima
            // sollevasse un errore, il riquadro "Oggi" resterebbe bloccato
            // sullo spinner per sempre. Ogni render è isolato dagli altri.
            safe(function () { renderToday(workouts); });
            safe(function () { renderSourceFilters(workouts); });
            safe(function () { displayWorkouts(filterBySource(workouts)); });
            safe(function () { loadProgressionHints(workouts); });

        } catch (error) {
            console.error('Errore caricamento allenamenti:', error);
            showToast('Errore nel caricamento degli allenamenti', 'error');
            workouts = [];
            // Anche in errore il riquadro "Oggi" va chiuso: uno spinner
            // eterno non dice niente all'utente.
            safe(function () { renderToday([]); });
            safe(function () { displayWorkouts([]); });
        }
    }

    // Esegue fn isolando gli errori: un render rotto non deve impedire
    // agli altri di completare.
    function safe(fn) {
        try { fn(); } catch (e) { console.error('Dashboard render:', e); }
    }

    // ===== SEZIONE "OGGI" =====

    /**
     * Risponde a "cosa devo fare oggi?" sopra la piega.
     * Gli allenamenti sono raggruppati per mese in cartelle collassabili:
     * senza questa sezione, per sapere cosa c'è oggi bisognava aprire la
     * cartella del mese e cercare la data a mano.
     */
    function renderToday(list) {
        const greetEl = document.getElementById('todayGreeting');
        const dateEl  = document.getElementById('todayDate');
        const bodyEl  = document.getElementById('todayBody');
        if (!bodyEl) return;

        if (dateEl) {
            const d = new Date();
            const s = d.toLocaleDateString('it-IT', {
                weekday: 'long', day: 'numeric', month: 'long'
            });
            dateEl.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        }
        if (greetEl) greetEl.textContent = greeting();

        const todayKey = new Date().toISOString().slice(0, 10);
        const todays = (list || []).filter(w =>
            (w.scheduled_date || '').slice(0, 10) === todayKey
        );

        if (todays.length === 0) {
            bodyEl.innerHTML = `
                <div class="today-empty">
                    <p class="today-empty-msg">Nessun allenamento in programma per oggi.</p>
                    <div class="today-empty-actions">
                        <a href="/workout" class="btn btn-primary">
                            <i class="fas fa-plus" aria-hidden="true"></i> Crea allenamento
                        </a>
                        <a href="/ai-trainer" class="btn btn-outline">
                            <i class="fas fa-robot" aria-hidden="true"></i> Chiedi all'AI
                        </a>
                    </div>
                </div>
            `;
            return;
        }

        bodyEl.innerHTML = todays.map(w => {
            const icon = window.AppCore
                ? window.AppCore.getActivityIcon(w.activity_id, w.activity_type)
                : 'fa-dumbbell';
            const done = !!w.completed;
            return `
                <div class="today-item${done ? ' is-done' : ''}">
                    <div class="today-item-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
                    <div class="today-item-info">
                        <div class="today-item-name">${escapeHtml(w.name || 'Allenamento')}</div>
                        <div class="today-item-meta">
                            ${w.total_duration ? escapeHtml(String(w.total_duration)) + ' min' : ''}
                            ${w.objective ? ' · ' + escapeHtml(w.objective) : ''}
                        </div>
                    </div>
                    ${done
                        ? '<span class="today-item-done"><i class="fas fa-check" aria-hidden="true"></i> Fatto</span>'
                        : `<button class="btn btn-success btn-sm" onclick="completeWorkout('${escapeHtml(w.id)}')">
                             <i class="fas fa-check" aria-hidden="true"></i> Completa
                           </button>`}
                </div>
            `;
        }).join('');
    }

    function greeting() {
        const h = new Date().getHours();
        if (h < 6)  return 'Buonanotte!';
        if (h < 12) return 'Buongiorno!';
        if (h < 18) return 'Buon pomeriggio!';
        return 'Buonasera!';
    }

    /**
     * Carica le statistiche settimanali
     */
    async function loadWeeklyStats() {
        try {
            if (!elements.weeklyStats) return;
            
            // Calcola intervallo settimana corrente
            const today = new Date();
            const firstDayOfWeek = new Date(today);
            const day = today.getDay() || 7; // Domenica = 7
            firstDayOfWeek.setDate(today.getDate() - day + 1); // Lunedì
            firstDayOfWeek.setHours(0, 0, 0, 0);
            
            const lastDayOfWeek = new Date(firstDayOfWeek);
            lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6); // Domenica
            lastDayOfWeek.setHours(23, 59, 59, 999);
            
            // Carica allenamenti completati questa settimana.
            // completed_at incluso per separare "totale settimana" da "oggi".
            const { data: completedWorkouts, error } = await supabaseClient
                .from('completed_workouts')
                .select('actual_duration, calories_burned, distance, completed_at')
                .eq('user_id', currentUser.id)
                .gte('completed_at', firstDayOfWeek.toISOString())
                .lte('completed_at', lastDayOfWeek.toISOString());
                
            if (error) throw error;
            
            displayWeeklyStats(completedWorkouts || []);
            
        } catch (error) {
            console.error('Errore caricamento statistiche settimanali:', error);
            elements.weeklyStats.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Errore nel caricamento delle statistiche</span>
                </div>
            `;
        }
    }
    
    // ===== VISUALIZZAZIONE DATI =====
    
    /**
     * Visualizza gli allenamenti nella dashboard
     */
    function displayWorkouts(workoutsData) {
        if (!elements.workoutList) return;

        elements.workoutList.innerHTML = '';
        elements.workoutList.classList.toggle('has-groups', workoutsData.length > 0);

        if (workoutsData.length === 0) {
            // Distinguere i due casi: un filtro senza risultati non è la
            // stessa cosa di un utente che non ha ancora nulla. Proporre
            // "crea il tuo primo allenamento" a chi ne ha venti, solo perché
            // ha filtrato per Garmin, sarebbe assurdo.
            const filtering = activeSource !== 'all' && workouts.length > 0;
            elements.workoutList.innerHTML = filtering ? `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i class="fas fa-filter"></i>
                    </div>
                    <h3>Nessun allenamento in questa categoria</h3>
                    <p>Non hai allenamenti con provenienza "${escapeHtml(SOURCE[activeSource].short)}".</p>
                    <button type="button" class="btn btn-primary" id="clearSourceFilter">
                        <i class="fas fa-list"></i> Mostra tutti
                    </button>
                </div>
            ` : `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i class="fas fa-dumbbell"></i>
                    </div>
                    <h3>Nessun allenamento trovato</h3>
                    <p>Inizia creando il tuo primo allenamento personalizzato</p>
                    <a href="/workout" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Crea il tuo primo allenamento
                    </a>
                </div>
            `;
            const clear = document.getElementById('clearSourceFilter');
            if (clear) clear.addEventListener('click', () => {
                activeSource = 'all';
                renderSourceFilters(workouts);
                displayWorkouts(workouts);
            });
            return;
        }

        // Raggruppa per mese-anno di creazione (created_at). I dati arrivano
        // già ordinati per created_at desc da loadWorkouts → i gruppi e le
        // card mantengono l'ordine dal più recente.
        const groups = groupWorkoutsByMonth(workoutsData);
        const currentKey = monthKeyOf(new Date());

        groups.forEach(group => {
            const isCurrent = group.key === currentKey;

            const section = document.createElement('section');
            section.className = 'month-group' + (isCurrent ? ' is-open' : '');
            section.dataset.month = group.key;

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'month-header';
            header.setAttribute('aria-expanded', isCurrent ? 'true' : 'false');
            header.innerHTML = `
                <span class="month-header-left">
                    <i class="fas fa-chevron-right month-chevron"></i>
                    <span class="month-title">${escapeHtml(group.label)}</span>
                </span>
                <span class="month-count">${group.items.length}</span>
            `;
            header.addEventListener('click', () => {
                const open = section.classList.toggle('is-open');
                header.setAttribute('aria-expanded', open ? 'true' : 'false');
            });

            const body = document.createElement('div');
            body.className = 'month-body';
            const grid = document.createElement('div');
            grid.className = 'card-grid';
            group.items.forEach((workout, index) => grid.appendChild(buildWorkoutCard(workout, index)));
            body.appendChild(grid);

            section.appendChild(header);
            section.appendChild(body);
            elements.workoutList.appendChild(section);
        });
    }

    // Costruisce la card di un singolo allenamento (estratta per riuso nei gruppi)
    function buildWorkoutCard(workout, index) {
        const iconClass = window.AppCore.getActivityIcon(workout.activity_id, workout.activity_type);
        const card = document.createElement('div');
        card.className = 'card workout-card';
        card.dataset.id = workout.id;
        card.style.animationDelay = `${index * 0.08}s`;
        card.innerHTML = `
            <div class="workout-header">
                <div class="workout-header-text">
                    <h3 class="workout-title">${escapeHtml(workout.name || 'Allenamento')}</h3>
                    ${sourceBadge(workout)}
                </div>
                <div class="workout-icon">
                    <i class="fas ${iconClass}"></i>
                </div>
            </div>

            <div class="workout-details">
                <div class="detail-row">
                    <span class="detail-label">Durata:</span>
                    <span class="detail-value">${formatDuration(workout.total_duration)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Difficoltà:</span>
                    <span class="detail-value">${escapeHtml(workout.difficulty || 'Non specificata')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Obiettivo:</span>
                    <span class="detail-value">${escapeHtml(workout.objective || 'Non specificato')}</span>
                </div>
            </div>

            <div class="workout-actions">
                <button class="btn btn-primary view-btn" onclick="viewWorkout('${workout.id}')">
                    <i class="fas fa-eye"></i>
                    <span>Visualizza</span>
                </button>
                ${isImported(workout) ? '' : `
                <button class="btn btn-secondary edit-btn" onclick="editWorkout('${workout.id}')">
                    <i class="fas fa-edit"></i>
                    <span>Modifica</span>
                </button>`}
                <button class="btn btn-danger delete-btn" onclick="confirmDeleteWorkout('${workout.id}')">
                    <i class="fas fa-trash"></i>
                    <span>Elimina</span>
                </button>
                ${isImported(workout) ? '' : `
                <button class="btn btn-success complete-btn" onclick="completeWorkout('${workout.id}')">
                    <i class="fas fa-check"></i>
                    <span>Completa</span>
                </button>`}
            </div>
        `;
        return card;
    }

    // ===== PROVENIENZA =====

    const SOURCE = {
        garmin: { label: 'Da Garmin',  icon: 'fa-file-import', short: 'Garmin'  },
        ai:     { label: "Dall'AI",    icon: 'fa-robot',         short: 'AI'      },
        manual: { label: 'Create da te', icon: 'fa-pen',         short: 'Manuali' }
    };

    /**
     * Un'attività importata da Garmin è un fatto compiuto: non ha senso
     * offrire "Completa" (è già stata fatta) né "Modifica" (modificheresti
     * la registrazione di ciò che è realmente accaduto). Restano
     * "Visualizza" ed "Elimina".
     *
     * Il fallback sull'obiettivo copre le righe salvate prima della
     * migrazione 004, se il riempimento non fosse ancora stato eseguito.
     */
    function isImported(workout) {
        if (workout.source) return workout.source === 'garmin';
        return workout.objective === 'Attività importata da Garmin';
    }

    // Etichetta di provenienza sulla card: rende evidente perché
    // un'attività Garmin non ha i pulsanti "Completa" e "Modifica".
    function sourceBadge(workout) {
        const key = sourceOf(workout);
        const s = SOURCE[key];
        if (!s) return '';
        return `<span class="source-badge source-badge--${key}">
                    <i class="fas ${s.icon}" aria-hidden="true"></i> ${s.label}
                </span>`;
    }

    function sourceOf(workout) {
        if (workout.source && SOURCE[workout.source]) return workout.source;
        if (workout.objective === 'Attività importata da Garmin') return 'garmin';
        if (workout.objective === "Piano generato dall'AI Trainer") return 'ai';
        return 'manual';
    }

    // ===== FILTRI PER PROVENIENZA =====

    let activeSource = 'all';

    /**
     * Costruisce i filtri con il conteggio reale per ciascuna provenienza.
     * Le voci senza allenamenti non vengono mostrate: un filtro che dà
     * sempre zero risultati è solo rumore.
     */
    function renderSourceFilters(list) {
        const box = document.getElementById('sourceFilters');
        if (!box) return;

        const counts = { garmin: 0, ai: 0, manual: 0 };
        (list || []).forEach(w => { counts[sourceOf(w)]++; });
        const total = (list || []).length;

        // Con una sola provenienza i filtri non servono a nulla
        const present = Object.keys(counts).filter(k => counts[k] > 0);
        if (present.length < 2) { box.innerHTML = ''; return; }

        // Se il filtro attivo è rimasto senza allenamenti (ultimo eliminato)
        // torniamo a "Tutte", altrimenti la lista resterebbe vuota senza motivo
        if (activeSource !== 'all' && !counts[activeSource]) activeSource = 'all';

        const chip = (key, label, icon, count) => `
            <button type="button" class="source-chip${activeSource === key ? ' is-active' : ''}"
                    data-source="${key}" aria-pressed="${activeSource === key}">
                ${icon ? `<i class="fas ${icon}" aria-hidden="true"></i>` : ''}
                <span>${label}</span>
                <span class="source-chip-count">${count}</span>
            </button>`;

        box.innerHTML =
            chip('all', 'Tutte', '', total) +
            present.map(k => chip(k, SOURCE[k].short, SOURCE[k].icon, counts[k])).join('');

        box.querySelectorAll('.source-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                activeSource = btn.dataset.source;
                renderSourceFilters(workouts);
                displayWorkouts(filterBySource(workouts));
            });
        });
    }

    function filterBySource(list) {
        if (activeSource === 'all') return list || [];
        return (list || []).filter(w => sourceOf(w) === activeSource);
    }

    // Raggruppa gli allenamenti per mese-anno di created_at.
    // Ritorna un array di { key:'YYYY-MM', label:'Giugno 2026', items:[...] }
    // ordinato dal mese più recente. Allenamenti senza created_at finiscono
    // in un gruppo "Senza data" in fondo.
    /**
     * Data a cui l'allenamento SI RIFERISCE, non quella in cui la riga è
     * stata scritta nel database.
     *
     * Per un'attività importata da Garmin le due cose divergono: created_at
     * è il momento dell'import, completed_at è quando hai davvero corso.
     * Usare created_at faceva finire una corsa del 30 luglio, importata in
     * agosto, nella cartella di agosto.
     */
    function activityDateOf(w) {
        // Priorità: quando è stata svolta → quando è in programma → creazione
        const raw = w.completed_at || w.scheduled_date || w.created_at;
        if (!raw) return null;

        // scheduled_date è una data senza orario ('2026-07-30'): interpretarla
        // così com'è la colloca a mezzanotte UTC e in alcuni fusi slitta al
        // giorno prima. Mezzogiorno la mette al sicuro.
        const str = String(raw);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T12:00:00') : new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    function groupWorkoutsByMonth(workouts) {
        const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                        'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
        const map = new Map();
        workouts.forEach(w => {
            let key, label;
            const d = activityDateOf(w);
            if (d) {
                key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                label = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
            } else {
                key = '0000-00';
                label = 'Senza data';
            }
            if (!map.has(key)) map.set(key, { key, label, items: [] });
            map.get(key).items.push(w);
        });

        // Dentro ogni mese le card vanno dalla più recente alla più vecchia
        // per DATA DELL'ATTIVITÀ: la query le ordina per created_at, che per
        // gli import è l'ordine in cui li hai caricati, non quello in cui li
        // hai svolti.
        map.forEach(group => {
            group.items.sort((a, b) => {
                const da = activityDateOf(a), db = activityDateOf(b);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        });

        // Ordina i gruppi per chiave desc (più recente in alto)
        return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
    }

    function monthKeyOf(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    }
    
    /**
     * Carica e mostra suggerimenti di progressione per ogni workout card
     */
    async function loadProgressionHints(workoutsData) {
        if (!workoutsData.length) return;
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { data: completed } = await supabaseClient
                .from('completed_workouts')
                .select('workout_id, actual_duration, completed_at')
                .eq('user_id', currentUser.id)
                .gte('completed_at', thirtyDaysAgo.toISOString())
                .order('completed_at', { ascending: false });

            if (!completed?.length) return;

            // Raggruppa per workout_id (FK verso workout_plans.id)
            const byPlan = {};
            completed.forEach(c => {
                if (!byPlan[c.workout_id]) byPlan[c.workout_id] = [];
                byPlan[c.workout_id].push(c.actual_duration || 0);
            });

            workoutsData.forEach(workout => {
                const sessions = byPlan[workout.id];
                if (!sessions || sessions.length < 2) return;

                const card = elements.workoutList.querySelector(`[data-id="${workout.id}"]`);
                if (!card) return;

                const hint = buildProgressionHint(sessions, workout.total_duration);
                if (!hint) return;

                const badge = document.createElement('div');
                badge.className = 'progression-hint';
                badge.innerHTML = `<i class="fas fa-arrow-trend-up"></i> ${hint}`;
                card.querySelector('.workout-details').appendChild(badge);
            });
        } catch (err) {
            console.warn('Progression hints error:', err);
        }
    }

    function buildProgressionHint(durations, plannedDuration) {
        const count = durations.length;
        const avgRecent = durations.slice(0, 3).reduce((s, d) => s + d, 0) / Math.min(3, count);
        const planned = plannedDuration || 45;

        if (count >= 3) {
            // Trend crescente nelle ultime 3 sessioni
            const last3 = durations.slice(0, 3);
            const improving = last3[2] < last3[1] && last3[1] < last3[0]; // desc order
            if (improving) return `Ottima progressione! Pronto per +5 minuti`;
        }

        if (count >= 2 && avgRecent >= planned * 1.1) {
            return `Superi il target ogni volta — alza la durata!`;
        }
        if (count >= 3) {
            return `Completato ${count}x — considera di aumentare l'intensità`;
        }
        return null;
    }

    /**
     * Visualizza le statistiche settimanali
     */
    function displayWeeklyStats(completedWorkouts) {
        if (!elements.weeklyStats) return;

        const totalWorkouts = completedWorkouts.length;
        const totalTime     = completedWorkouts.reduce((sum, w) => sum + (w.actual_duration || 0), 0);
        const weekCalories  = completedWorkouts.reduce((sum, w) => sum + (w.calories_burned || 0), 0);
        const totalDistance = completedWorkouts.reduce((sum, w) => sum + (w.distance || 0), 0);

        // Calorie bruciate OGGI (slice della settimana per data corrente, ora locale)
        const todayKey = new Date().toISOString().slice(0, 10);
        const todayCalories = completedWorkouts
            .filter(w => w.completed_at && w.completed_at.slice(0, 10) === todayKey)
            .reduce((sum, w) => sum + (w.calories_burned || 0), 0);

        elements.weeklyStats.innerHTML = `
            <div class="weekly-stats-grid">
                <div class="stat-card">
                    <div class="stat-icon workout-icon">
                        <i class="fas fa-dumbbell"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${totalWorkouts}</div>
                        <div class="stat-label">Allenamenti (settimana)</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon time-icon">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${formatDuration(totalTime)}</div>
                        <div class="stat-label">Tempo totale (settimana)</div>
                    </div>
                </div>

                <div class="stat-card stat-card--highlight" title="Calorie bruciate negli allenamenti completati oggi">
                    <div class="stat-icon calories-icon">
                        <i class="fas fa-bolt"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${todayCalories} <span class="stat-unit">kcal</span></div>
                        <div class="stat-label">Calorie bruciate OGGI</div>
                    </div>
                </div>

                <div class="stat-card" title="Somma calorie bruciate negli allenamenti completati in questa settimana">
                    <div class="stat-icon calories-icon">
                        <i class="fas fa-fire"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${weekCalories} <span class="stat-unit">kcal</span></div>
                        <div class="stat-label">Calorie settimana</div>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon distance-icon">
                        <i class="fas fa-route"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${totalDistance.toFixed(1)} <span class="stat-unit">km</span></div>
                        <div class="stat-label">Distanza (settimana)</div>
                    </div>
                </div>
            </div>

            ${totalWorkouts === 0 ? `
                <div class="weekly-info">
                    <i class="fas fa-info-circle"></i>
                    <span>Non hai ancora completato allenamenti questa settimana</span>
                </div>
            ` : ''}
            
            <div class="weekly-actions">
                <a href="/weekly_summary" class="btn btn-primary">
                    <i class="fas fa-calendar-alt"></i>
                    <span>Pianifica Settimana</span>
                </a>
                <a href="/stats" class="btn btn-outline">
                    <i class="fas fa-chart-line"></i>
                    <span>Vedi Statistiche</span>
                </a>
            </div>
        `;
    }
    
    // ===== GESTIONE ALLENAMENTI =====
    
    /**
     * Visualizza i dettagli di un allenamento in modal
     */
    window.viewWorkout = async function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Rimuovi modal esistenti per evitare conflitti
        removeExistingModal('workoutDetailsModal');
        
        // Determina l'icona dell'attività
        const iconClass = window.AppCore.getActivityIcon(workout.activity_id, workout.activity_type);

        // Crea il modal
        const modal = createWorkoutDetailsModal(workout, iconClass);
        
        // Aggiungi al DOM
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Setup event listeners per la chiusura
        setupModalCloseListeners(modal);

        // La mappa si disegna ORA che il modal è nel DOM ed è visibile:
        // su un contenitore di altezza zero Leaflet non calcola lo zoom.
        if (window.routeMapRenderAll) window.routeMapRenderAll(modal);

        console.log('Modal dettagli allenamento aperto');
    };
    
    /**
     * Crea il modal per i dettagli dell'allenamento
     */
    function createWorkoutDetailsModal(workout, iconClass) {
        const modal = document.createElement('div');
        modal.id = 'workoutDetailsModal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h2 style="display: flex; align-items: center; gap: 0.75rem;">
                        <i class="fas ${iconClass}" style="color: var(--primary-color);"></i>
                        ${escapeHtml(workout.name)}
                    </h2>
                    <button class="modal-close" id="closeDetailsModalBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="workout-details-content">
                    ${createWorkoutDetailsContent(workout)}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="closeDetailsModalBtnFooter">
                        <i class="fas fa-times"></i> Chiudi
                    </button>
                    ${isImported(workout) ? '' : `
                    <button class="btn btn-primary" onclick="editWorkout('${workout.id}')">
                        <i class="fas fa-edit"></i> Modifica
                    </button>
                    <button class="btn btn-success" onclick="completeWorkout('${workout.id}')">
                        <i class="fas fa-check"></i> Completa
                    </button>`}
                </div>
            </div>
        `;
        
        return modal;
    }
    
    /**
     * Crea il contenuto dei dettagli dell'allenamento
     */
    function detailItem(icon, label, value) {
        return `
            <div class="detail-item">
                <div class="detail-header">
                    <i class="fas ${icon}"></i>
                    <span>${label}</span>
                </div>
                <div class="detail-value">${value}</div>
            </div>
        `;
    }

    function createWorkoutDetailsContent(workout) {
        const imported = isImported(workout);
        const c = completionsByWorkout[workout.id] || {};
        const items = [];

        items.push(detailItem('fa-clock', 'Durata', formatDuration(workout.total_duration)));

        if (imported) {
            // Per un'attività importata i numeri veri (distanza, calorie, FC)
            // finivano dentro una stringa in main_phase:
            //   "Importato da Garmin: 5.3 km · 74 min · 392 kcal · FC 87 bpm"
            // Illeggibile come dato e inutilizzabile per qualsiasi altra cosa.
            // Qui vengono mostrati come metriche vere, prese da
            // completed_workouts e workout_plans.
            if (c.distance)        items.push(detailItem('fa-route', 'Distanza', escapeHtml(String(c.distance)) + ' km'));
            if (c.calories_burned) items.push(detailItem('fa-fire', 'Calorie', escapeHtml(String(c.calories_burned)) + ' kcal'));
            if (c.heart_rate_avg)  items.push(detailItem('fa-heart-pulse', 'FC media', escapeHtml(String(c.heart_rate_avg)) + ' bpm'));
            if (workout.max_heart_rate) items.push(detailItem('fa-arrow-up', 'FC massima', escapeHtml(String(workout.max_heart_rate)) + ' bpm'));
        } else {
            // Per le schede da svolgere contano difficoltà e obiettivo.
            // Su un'attività importata l'obiettivo è sempre "Attività
            // importata da Garmin", che ripete l'etichetta di provenienza.
            items.push(detailItem('fa-signal', 'Difficoltà', escapeHtml(workout.difficulty || 'Non specificata')));
            items.push(detailItem('fa-bullseye', 'Obiettivo', escapeHtml(workout.objective || 'Non specificato')));
        }

        const detailsGrid = `<div class="detail-grid">${items.join('')}${weatherDetailItems(workout)}</div>`;
        const phases = createWorkoutPhasesContent(workout, imported);

        return detailsGrid + createRouteMapContent(workout) + phases;
    }

    // Icona ed etichetta per ciascuna condizione meteo
    const WEATHER = {
        sereno:   { icon: 'fa-sun',           label: 'Sereno'    },
        nuvoloso: { icon: 'fa-cloud',         label: 'Nuvoloso'  },
        pioggia:  { icon: 'fa-cloud-rain',    label: 'Pioggia'   },
        vento:    { icon: 'fa-wind',          label: 'Vento'     },
        neve:     { icon: 'fa-snowflake',     label: 'Neve'      },
        afoso:    { icon: 'fa-temperature-high', label: 'Afoso'  },
        indoor:   { icon: 'fa-house',         label: 'Al chiuso' }
    };

    /**
     * Riquadri temperatura e condizioni, mostrati solo se valorizzati.
     *
     * Sulla temperatura importata da Garmin il titolo dice "registrata
     * dall'orologio": il sensore sta al polso e legge anche il calore
     * corporeo, quindi segna tipicamente qualche grado più dell'aria.
     * Chiamarla "temperatura ambiente" renderebbe fuorvianti i confronti
     * fra un'uscita e l'altra.
     */
    function weatherDetailItems(workout) {
        let html = '';

        if (workout.temperature !== null && workout.temperature !== undefined) {
            html += `
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-temperature-half"></i>
                        <span>Temperatura</span>
                    </div>
                    <div class="detail-value" title="Registrata dal sensore dell'orologio: tende a segnare qualche grado più dell'aria">
                        ${escapeHtml(String(workout.temperature))} °C
                    </div>
                </div>
            `;
        }

        const w = WEATHER[workout.weather];
        if (w) {
            html += `
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas ${w.icon}"></i>
                        <span>Condizioni</span>
                    </div>
                    <div class="detail-value">${w.label}</div>
                </div>
            `;
        }

        return html;
    }

    /**
     * Contenitore per la mappa del percorso, se l'attività ha una traccia GPS.
     * Viene riempito da route-map.js dopo che il modal è visibile.
     */
    function createRouteMapContent(workout) {
        let track = workout.gps_track;
        if (typeof track === 'string') {
            try { track = JSON.parse(track); } catch (e) { track = null; }
        }
        const hasTrack = Array.isArray(track) && track.length > 1;

        if (!hasTrack) {
            // Senza traccia prima non compariva NULLA, e restava il dubbio se
            // la mappa fosse rotta o l'attività non ne avesse. Per gli import
            // spieghiamo il motivo: le attività caricate prima che salvassimo
            // le tracce hanno perso le coordinate, e si recuperano solo
            // reimportando il file originale.
            if (!isImported(workout)) return '';
            return `
                <div class="detail-section">
                    <h4 class="detail-section-title">
                        <i class="fas fa-map-location-dot"></i> Percorso
                    </h4>
                    <p class="detail-nomap">
                        <i class="fas fa-circle-info" aria-hidden="true"></i>
                        Nessuna traccia GPS salvata per questa attività: è stata
                        importata prima che l'app iniziasse a conservarla, oppure
                        il file non conteneva coordinate (attività al chiuso).
                        Reimportando il file originale la mappa comparirà.
                    </p>
                </div>
            `;
        }

        return `
            <div class="detail-section">
                <h4 class="detail-section-title">
                    <i class="fas fa-map-location-dot"></i> Percorso
                </h4>
                <div class="map-wrap">
                    <div class="arc-map" data-track="${escapeHtml(JSON.stringify(track))}"></div>
                    ${weatherBadge(workout)}
                </div>
            </div>
        `;
    }

    /**
     * Pastiglia meteo sovrapposta alla mappa, nello stile di Garmin:
     * temperatura e icona delle condizioni in un angolo del percorso.
     * Compare solo se almeno uno dei due dati esiste.
     */
    function weatherBadge(workout) {
        const hasTemp = workout.temperature !== null && workout.temperature !== undefined;
        const w = WEATHER[workout.weather];
        if (!hasTemp && !w) return '';

        return `
            <div class="map-weather" title="${w ? escapeHtml(w.label) : 'Temperatura'}">
                ${hasTemp ? `<span class="map-weather-temp">${escapeHtml(String(workout.temperature))}°</span>` : ''}
                ${w ? `<i class="fas ${w.icon}" aria-hidden="true"></i>` : ''}
                <span class="sr-only">${w ? escapeHtml(w.label) : ''}</span>
            </div>
        `;
    }
    
    /**
     * Crea il contenuto delle fasi dell'allenamento
     */
    function createWorkoutPhasesContent(workout, imported) {
        const phases = [];

        // Per le attività importate main_phase contiene solo il riepilogo
        // testuale ("Importato da Garmin: 5.3 km · 74 min · ...") che ora è
        // mostrato come metriche vere sopra: ripeterlo sarebbe rumore.
        const skipMain = imported &&
            /^Importato da Garmin/i.test(String(workout.main_phase || '').trim());

        if (workout.warmup) {
            phases.push({
                title: 'Riscaldamento',
                icon: 'fa-play-circle',
                content: workout.warmup
            });
        }
        
        if (workout.main_phase && !skipMain) {
            phases.push({
                title: 'Fase Principale',
                icon: 'fa-dumbbell',
                content: workout.main_phase
            });
        }
        
        if (workout.cooldown) {
            phases.push({
                title: 'Defaticamento',
                icon: 'fa-snowflake',
                content: workout.cooldown
            });
        }
        
        if (workout.notes) {
            phases.push({
                title: 'Note',
                icon: 'fa-sticky-note',
                content: workout.notes
            });
        }
        
        if (phases.length === 0) {
            return `
                <div class="no-details">
                    <i class="fas fa-info-circle"></i>
                    <p>Nessun dettaglio aggiuntivo disponibile per questo allenamento.</p>
                </div>
            `;
        }
        
          const sanitize = (html) => typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : escapeHtml(html);

        return `
            <div class="workout-phases">
                ${phases.map(phase => `
                    <div class="phase-section">
                        <h4 class="phase-title">
                            <i class="fas ${phase.icon}"></i>
                            ${phase.title}
                        </h4>
                        <div class="phase-content">
                            ${sanitize(phase.content)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    /**
     * Setup listeners per chiudere il modal
     */
    function setupModalCloseListeners(modal) {
        // Funzione di chiusura centralizzata
        function closeModal() {
            modal.remove();
            document.body.style.overflow = '';
            console.log('Modal chiuso');
        }
        
        // Pulsante X header
        const closeBtn = modal.querySelector('#closeDetailsModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        
        // Pulsante Chiudi footer
        const closeBtnFooter = modal.querySelector('#closeDetailsModalBtnFooter');
        if (closeBtnFooter) {
            closeBtnFooter.addEventListener('click', closeModal);
        }
        
        // Click fuori dal modal
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Tasto ESC
        function handleEscKey(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        }
        
        document.addEventListener('keydown', handleEscKey);
    }
    
    /**
     * Modifica un allenamento
     */
    window.editWorkout = function(workoutId) {
        window.location.href = `/workout?id=${workoutId}`;
    };
    
    /**
     * Conferma eliminazione allenamento
     */
    window.confirmDeleteWorkout = async function(workoutId) {
        const ok = await window.showConfirm({
            title: 'Elimina allenamento',
            message: 'Sei sicuro di voler eliminare questo allenamento?',
            confirmText: 'Elimina',
            danger: true
        });
        if (ok) await deleteWorkout(workoutId);
    };
    
    /**
     * Elimina un allenamento
     */
    async function deleteWorkout(workoutId) {
        try {
            showLoading();
            
            const { error } = await supabaseClient
                .from('workout_plans')
                .delete()
                .eq('id', workoutId)
                .eq('user_id', currentUser.id);
                
            if (error) throw error;
            
            // Rimuovi dall'array locale e aggiorna UI
            workouts = workouts.filter(w => w.id !== workoutId);
            displayWorkouts(workouts);
            
            showToast('Allenamento eliminato con successo', 'success');
            
        } catch (error) {
            console.error('Errore eliminazione allenamento:', error);
            showToast('Errore nell\'eliminazione dell\'allenamento', 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * Inizia il completamento di un allenamento
     */
    window.completeWorkout = function(workoutId) {
        const workout = workouts.find(w => w.id === workoutId);
        if (!workout) {
            showToast('Allenamento non trovato', 'error');
            return;
        }
        
        // Prepopola il form
        document.getElementById('completeWorkoutId').value = workoutId;
        
        const now = new Date();
        const localDatetime = new Date(now - now.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16);
        document.getElementById('completedDate').value = localDatetime;
        document.getElementById('actualDuration').value = workout.total_duration || '';
        
        // Apri modal
        openModal('completeWorkoutModal');
    };
    
    /**
     * Gestisce il submit del form di completamento
     */
    async function handleCompleteWorkoutSubmit(e) {
        e.preventDefault();
        
        try {
            showLoading();
            
            const formData = getCompleteWorkoutFormData();
            
            if (!validateCompleteWorkoutForm(formData)) {
                throw new Error('Compila tutti i campi obbligatori');
            }
            
            const completedWorkoutData = {
                user_id: currentUser.id,
                workout_id: formData.workoutId,
                completed_at: new Date(formData.completedDate).toISOString(),
                actual_duration: formData.actualDuration,
                perceived_difficulty: formData.perceivedDifficulty,
                // ✅ CORRETTO — nome colonna reale nel DB
                heart_rate_avg: formData.heartRateAvg > 0 ? formData.heartRateAvg : null,
                distance: formData.distance > 0 ? formData.distance : null,
               calories_burned: formData.caloriesBurned > 0 ? formData.caloriesBurned : null,
               notes: formData.notes || null,
               rating: formData.rating
             };
            
            // 1. Inserimento record principale
            const { error } = await supabaseClient
                .from('completed_workouts')
                .insert([completedWorkoutData]);

            if (error) throw error;

            // 2. Aggiornamento denormalizzato (non critico — completed_workouts è la fonte di verità)
            const planUpdate = {
                completed: true,
                completed_at: completedWorkoutData.completed_at,
                average_heart_rate: formData.heartRateAvg > 0 ? formData.heartRateAvg : null
            };

            // temperature e weather richiedono migrations/003-weather.sql:
            // li aggiungiamo solo se valorizzati, così un profilo senza
            // migrazione non fa fallire il completamento dell'allenamento.
            let { error: updateError } = await supabaseClient
                .from('workout_plans')
                .update(Object.assign({}, planUpdate, {
                    temperature: formData.temperature,
                    weather: formData.weather
                }))
                .eq('id', formData.workoutId)
                .eq('user_id', currentUser.id);

            if (updateError && isMissingColumnError(updateError)) {
                console.warn('Completamento: colonne meteo non disponibili, eseguire ' +
                             'migrations/003-weather.sql. Salvo senza.', updateError);
                ({ error: updateError } = await supabaseClient
                    .from('workout_plans')
                    .update(planUpdate)
                    .eq('id', formData.workoutId)
                    .eq('user_id', currentUser.id));
            }

            if (updateError) {
                console.warn('Errore aggiornamento piano (non bloccante):', updateError.message);
            }

            // 3. UI aggiornata solo dopo che entrambe le operazioni DB sono complete
            closeModal('completeWorkoutModal');
            showToast('Allenamento completato con successo!', 'success');
            workouts = workouts.filter(w => w.id !== formData.workoutId);
            displayWorkouts(workouts);
            await loadWeeklyStats();

            const goStats = await window.showConfirm({
                title: 'Allenamento completato! 💪',
                message: 'Vuoi vedere le statistiche dei tuoi allenamenti?',
                confirmText: 'Vedi statistiche',
                cancelText: 'Resta qui'
            });
            if (goStats) window.location.href = '/stats';
            
        } catch (error) {
            console.error('Errore completamento allenamento:', error);
            showToast('Errore: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    }
    
    /**
     * Ottiene i dati dal form di completamento
     */
    function getCompleteWorkoutFormData() {
        return {
            workoutId: document.getElementById('completeWorkoutId').value,
            completedDate: document.getElementById('completedDate').value,
            actualDuration: parseInt(document.getElementById('actualDuration').value),
            perceivedDifficulty: document.getElementById('perceivedDifficulty').value,
            distance: parseFloat(document.getElementById('distance').value || 0),
            caloriesBurned: parseInt(document.getElementById('caloriesBurned').value || 0),
            heartRateAvg: parseInt(document.getElementById('heartRateAvg').value || 0),
            // 0 °C è un valore legittimo: non si può usare "|| 0" come
            // fallback, servirebbe a nascondere il dato invece che a
            // segnalarne l'assenza. Campo vuoto -> null.
            temperature: numOrNull('workoutTemperature'),
            weather: document.getElementById('workoutWeather')?.value || null,
            notes: document.getElementById('workoutNotes').value.trim(),
            rating: parseInt(document.querySelector('input[name="rating"]:checked')?.value || 3)
        };
    }

    function numOrNull(id) {
        const el = document.getElementById(id);
        if (!el || el.value.trim() === '') return null;
        const v = parseFloat(el.value);
        return Number.isNaN(v) ? null : v;
    }
    
    /**
     * Valida i dati del form di completamento
     */
    function validateCompleteWorkoutForm(data) {
        return data.workoutId && 
               data.completedDate && 
               data.actualDuration && 
               data.actualDuration > 0;
    }
    
    // ===== GESTIONE RESET DATI =====
    
    // L'eliminazione totale dei dati vive ora in /js/danger-zone.js, sulla
    // pagina Profilo: non deve stare fra le azioni quotidiane.

    // ===== EVENT LISTENERS =====
    
    /**
     * Setup di tutti gli event listeners
     */
    function setupEventListeners() {
        // Menu mobile
        setupMobileMenu();

        // I listener dell'eliminazione totale (apertura modal, conferma,
        // annulla) vivono ora in /js/danger-zone.js, sulla pagina Profilo.

        // Form completamento allenamento
        if (elements.completeWorkoutForm) {
            elements.completeWorkoutForm.addEventListener('submit', handleCompleteWorkoutSubmit);
        }
        
        // Configurazione dashboard
        if (elements.configureDashboardBtn) {
            elements.configureDashboardBtn.addEventListener('click', () => {
                openModal('dashboardConfigModal');
            });
        }
        
        // Logout
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', logout);
        }
    }
    
    /**
     * Setup menu mobile
     */
    function setupMobileMenu() {
        const mobileMenuToggle = document.getElementById('mobileMenuToggle');
        const navLinks = document.getElementById('navLinks');
        
        if (mobileMenuToggle && navLinks) {
            mobileMenuToggle.addEventListener('click', function() {
                navLinks.classList.toggle('active');
                
                const icon = this.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-bars');
                    icon.classList.toggle('fa-times');
                }
            });
            
            // Chiudi menu quando si clicca su un link
            navLinks.querySelectorAll('a, button').forEach(item => {
                item.addEventListener('click', () => {
                    navLinks.classList.remove('active');
                    const icon = mobileMenuToggle.querySelector('i');
                    if (icon) {
                        icon.classList.add('fa-bars');
                        icon.classList.remove('fa-times');
                    }
                });
            });
        }
    }
    
    // ===== FUNZIONI UTILITY =====
    
    /**
     * Logout utente
     */
    async function logout() {
        try {
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw error;
            window.location.href = '/';
        } catch (error) {
            console.error('Errore logout:', error);
            showToast('Errore durante il logout', 'error');
        }
    }
    
    // escapeHtml è definita globalmente in utils.js (window.escapeHtml)

    /**
     * Rimuove modal esistenti per evitare conflitti
     */
    function removeExistingModal(modalId) {
        const existingModal = document.getElementById(modalId);
        if (existingModal) {
            existingModal.remove();
        }
    }
    
    /**
     * Mostra loading spinner
     */
    function showLoading() {
        // Implementazione semplice - potresti sostituire con una libreria
        const loading = document.createElement('div');
        loading.id = 'loadingSpinner';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Caricamento...</span>
            </div>
        `;
        document.body.appendChild(loading);
        return loading;
    }
    
    /**
     * Nasconde loading spinner
     */
    function hideLoading() {
        const loading = document.getElementById('loadingSpinner');
        if (loading) {
            loading.remove();
        }
    }
    
    /**
     * Mostra toast notification
     */
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas ${iconMap[type] || iconMap.info}"></i>
            <span>${escapeHtml(message)}</span>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove dopo 5 secondi
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
        
        return toast;
    }
    
    /**
     * Apre un modal
     */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } else {
            console.error(`Modal con ID '${modalId}' non trovato`);
        }
    }
    
    /**
     * Chiude un modal
     */
    function closeModal(modalId) {
        let modal;
        
        if (typeof modalId === 'string') {
            modal = document.getElementById(modalId);
        } else if (modalId && modalId.nodeType === Node.ELEMENT_NODE) {
            modal = modalId;
        }
        
        if (modal) {
            // Se è un modal dinamico, rimuovilo completamente
            if (modal.id === 'workoutDetailsModal') {
                modal.remove();
            } else {
                // Altrimenti nascondilo solamente
                modal.style.display = 'none';
            }
            
            // Ripristina scroll del body
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Crea il client Supabase (fallback)
     */

    
    // ===== GESTIONE PREFERENZE DASHBOARD =====
    
    /**
     * Salva le preferenze della dashboard
     */
    window.saveDashboardPreferences = async function() {
        try {
            const widgets = ['weeklyStats', 'caloriesChart', 'durationChart', 'goalProgress', 'recentWorkouts'];
            const preferences = {
                visible_widgets: {}
            };
            
            widgets.forEach(widget => {
                const checkbox = document.getElementById(`show${widget.charAt(0).toUpperCase() + widget.slice(1)}`);
                if (checkbox) {
                    preferences.visible_widgets[widget] = checkbox.checked;
                }
            });
            
            // Salva le preferenze (opzionale: salvare in Supabase)
            localStorage.setItem('dashboardPreferences', JSON.stringify(preferences));
            
            closeModal('dashboardConfigModal');
            showToast('Preferenze salvate con successo', 'success');
            
        } catch (error) {
            console.error('Errore nel salvataggio delle preferenze:', error);
            showToast('Errore nel salvataggio delle preferenze', 'error');
        }
    };
    
    // ===== GESTIONE GLOBALE EVENTI =====
    
    // Listener globale per chiudere modal con ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Chiudi tutti i modal visibili
            const visibleModals = document.querySelectorAll('.modal[style*="flex"]');
            visibleModals.forEach(modal => {
                closeModal(modal);
            });
        }
    });
    
    // Listener globale per chiudere modal cliccando fuori
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });
    
    // ===== ESPONI FUNZIONI GLOBALI =====
    
    // Esponi le funzioni che devono essere accessibili dall'HTML
    window.openModal = openModal;
    window.closeModal = closeModal;
    
    // ===== AVVIA INIZIALIZZAZIONE =====
    
    // Avvia l'inizializzazione della dashboard
    init();
    
}); 
