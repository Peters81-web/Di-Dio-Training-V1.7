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
        resetDataBtn: document.getElementById('resetDataBtn'),
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

        card.innerHTML = `
            <div class="cb-grid">
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
                        <div class="cb-row-label"><i class="fas fa-fire"></i> Spesa totale stimata oggi</div>
                        <div class="cb-row-value">${r.totalExpenditure} <span>kcal</span></div>
                    </div>
                </div>
                <div class="cb-balance ${inDeficit ? 'cb-balance--deficit' : 'cb-balance--surplus'}">
                    <div class="cb-balance-icon">
                        ${inDeficit ? '<i class="fas fa-arrow-trend-down"></i>' : '<i class="fas fa-arrow-trend-up"></i>'}
                    </div>
                    <div class="cb-balance-label">
                        ${inDeficit ? 'Deficit potenziale oggi' : 'Pareggio / surplus'}
                    </div>
                    <div class="cb-balance-value">
                        ${inDeficit ? '−' : ''}${deficitAbs} <span>kcal</span>
                    </div>
                    <div class="cb-balance-note">
                        ${inDeficit
                            ? 'Se mantieni la dieta abituale, sei in deficit di queste calorie grazie agli allenamenti di oggi.'
                            : 'Oggi non hai ancora generato deficit con gli allenamenti. Aggiungi una sessione per crearne uno.'
                        }
                    </div>
                </div>
            </div>
            ${reliabilityMsg}
            <div class="cb-disclaimer">
                <i class="fas fa-info-circle"></i>
                <span>
                    <strong>Stima indicativa</strong> basata su formula Mifflin-St Jeor (BMR) e moltiplicatore attività ${r.activityFactor}.
                    Variazione individuale ±10-15%. Per un piano nutrizionale personalizzato consulta un dietista certificato.
                    Non include cosa mangi (intake calorico) — il "deficit potenziale" assume che tu mangi al tuo TDEE base abituale.
                </span>
            </div>
        `;
    }
    
    /**
     * Carica gli allenamenti dell'utente
     */
    async function loadWorkouts() {
        try {
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .select('id, name, activity_id, activity_type, total_duration, difficulty, objective, warmup, main_phase, cooldown, notes, created_at, status, skip_reason, completed, completed_at')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            
            workouts = data || [];
            displayWorkouts(workouts);
            loadProgressionHints(workouts);
            
        } catch (error) {
            console.error('Errore caricamento allenamenti:', error);
            showToast('Errore nel caricamento degli allenamenti', 'error');
            workouts = [];
            displayWorkouts([]);
        }
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
            elements.workoutList.innerHTML = `
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
    // Metadati per ogni stato scheda (badge + colore card)
    const STATUS_META = {
        da_fare:    { label: 'Da fare',    cls: 'st-dafare',    icon: 'fa-clock' },
        completato: { label: 'Completato', cls: 'st-completato', icon: 'fa-check-circle' },
        riposo:     { label: 'Riposo',     cls: 'st-riposo',    icon: 'fa-bed' },
        saltato:    { label: 'Saltato',    cls: 'st-saltato',   icon: 'fa-forward' }
    };

    function buildWorkoutCard(workout, index) {
        ensureStatusStyles();
        const iconClass = window.AppCore.getActivityIcon(workout.activity_id, workout.activity_type);
        const status = STATUS_META[workout.status] ? workout.status : 'da_fare';
        const meta = STATUS_META[status];
        const card = document.createElement('div');
        card.className = 'card workout-card status-' + status;
        card.dataset.id = workout.id;
        card.style.animationDelay = `${index * 0.08}s`;

        // Badge stato (+ motivo se saltato)
        const reason = (status === 'saltato' && workout.skip_reason)
            ? `<span class="skip-reason" title="${escapeHtml(workout.skip_reason)}">· ${escapeHtml(workout.skip_reason)}</span>` : '';
        const badge = `<span class="status-badge ${meta.cls}"><i class="fas ${meta.icon}"></i> ${meta.label}${reason}</span>`;

        // Azioni contestuali in base allo stato
        const id = workout.id;
        const bView = `<button class="btn btn-primary view-btn" onclick="viewWorkout('${id}')"><i class="fas fa-eye"></i><span>Visualizza</span></button>`;
        const bEdit = `<button class="btn btn-secondary edit-btn" onclick="editWorkout('${id}')"><i class="fas fa-edit"></i><span>Modifica</span></button>`;
        const bDelete = `<button class="btn btn-danger delete-btn" onclick="confirmDeleteWorkout('${id}')"><i class="fas fa-trash"></i><span>Elimina</span></button>`;
        const bComplete = `<button class="btn btn-success complete-btn" onclick="completeWorkout('${id}')"><i class="fas fa-check"></i><span>Completa</span></button>`;
        const bReset = `<button class="btn btn-ghost reset-btn" onclick="resetWorkoutStatus('${id}')"><i class="fas fa-rotate-left"></i><span>Riporta a "Da fare"</span></button>`;
        // Riga rapida riposo/salta (solo per schede da fare)
        const quickRow = `
            <div class="status-quick">
                <button class="sq-btn sq-rest" onclick="markWorkoutRest('${id}')"><i class="fas fa-bed"></i> Riposo</button>
                <button class="sq-btn sq-skip" onclick="markWorkoutSkipped('${id}')"><i class="fas fa-forward"></i> Salta</button>
            </div>`;

        let actions = '';
        if (status === 'da_fare') {
            actions = quickRow + `<div class="workout-actions">${bView}${bEdit}${bDelete}${bComplete}</div>`;
        } else if (status === 'completato') {
            actions = `<div class="workout-actions">${bView}${bEdit}${bDelete}${bReset}</div>`;
        } else if (status === 'riposo') {
            actions = `<div class="workout-actions">${bView}${bEdit}${bDelete}${bReset}</div>`;
        } else { // saltato
            actions = `<div class="workout-actions">${bView}${bEdit}${bComplete}${bReset}</div>`;
        }

        card.innerHTML = `
            <div class="workout-header">
                <h3 class="workout-title">${escapeHtml(workout.name || 'Allenamento')}</h3>
                <div class="workout-icon">
                    <i class="fas ${iconClass}"></i>
                </div>
            </div>

            ${badge}

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

            ${actions}
        `;
        return card;
    }

    // CSS badge/stati iniettato una volta sola
    function ensureStatusStyles() {
        if (document.getElementById('workout-status-styles')) return;
        const s = document.createElement('style');
        s.id = 'workout-status-styles';
        s.textContent = `
.status-badge{display:inline-flex;align-items:center;gap:6px;font-size:.74rem;font-weight:700;padding:4px 10px;border-radius:999px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.03em}
.status-badge .skip-reason{font-weight:500;text-transform:none;letter-spacing:0;opacity:.85;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status-badge.st-dafare{background:#eef2f7;color:#64748b}
.status-badge.st-completato{background:#dcfce7;color:#15803d}
.status-badge.st-riposo{background:#dbeafe;color:#1d4ed8}
.status-badge.st-saltato{background:#fee2e2;color:#b91c1c}
.workout-card{border-left:4px solid transparent}
.workout-card.status-completato{border-left-color:#22c55e}
.workout-card.status-riposo{border-left-color:#3b82f6}
.workout-card.status-saltato{border-left-color:#ef4444}
.workout-card.status-dafare{border-left-color:#cbd5e1}
.status-quick{display:flex;gap:8px;margin-bottom:8px}
.sq-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 10px;border-radius:9px;font-size:.82rem;font-weight:600;cursor:pointer;border:1.5px solid #e5e7eb;background:#fff;color:#475569;font-family:inherit;transition:background .15s,border-color .15s}
.sq-btn:active{transform:scale(.97)}
.sq-rest:hover{background:#eff6ff;border-color:#3b82f6;color:#1d4ed8}
.sq-skip:hover{background:#fef2f2;border-color:#ef4444;color:#b91c1c}
.btn.btn-ghost{background:#f3f4f6;color:#64748b}
.btn.btn-ghost:hover{background:#e5e7eb}`;
        document.head.appendChild(s);
    }

    // Raggruppa gli allenamenti per mese-anno di created_at.
    // Ritorna un array di { key:'YYYY-MM', label:'Giugno 2026', items:[...] }
    // ordinato dal mese più recente. Allenamenti senza created_at finiscono
    // in un gruppo "Senza data" in fondo.
    function groupWorkoutsByMonth(workouts) {
        const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                        'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
        const map = new Map();
        workouts.forEach(w => {
            let key, label;
            const d = w.created_at ? new Date(w.created_at) : null;
            if (d && !isNaN(d.getTime())) {
                key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                label = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
            } else {
                key = '0000-00';
                label = 'Senza data';
            }
            if (!map.has(key)) map.set(key, { key, label, items: [] });
            map.get(key).items.push(w);
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
                    <button class="btn btn-primary" onclick="editWorkout('${workout.id}')">
                        <i class="fas fa-edit"></i> Modifica
                    </button>
                    <button class="btn btn-success" onclick="completeWorkout('${workout.id}')">
                        <i class="fas fa-check"></i> Completa
                    </button>
                </div>
            </div>
        `;
        
        return modal;
    }
    
    /**
     * Crea il contenuto dei dettagli dell'allenamento
     */
    function createWorkoutDetailsContent(workout) {
        const detailsGrid = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-clock"></i>
                        <span>Durata</span>
                    </div>
                    <div class="detail-value">${formatDuration(workout.total_duration)}</div>
                </div>
                
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-signal"></i>
                        <span>Difficoltà</span>
                    </div>
                    <div class="detail-value">${escapeHtml(workout.difficulty || 'Non specificata')}</div>
                </div>
                
                <div class="detail-item">
                    <div class="detail-header">
                        <i class="fas fa-bullseye"></i>
                        <span>Obiettivo</span>
                    </div>
                    <div class="detail-value">${escapeHtml(workout.objective || 'Non specificato')}</div>
                </div>
            </div>
        `;
        
        const phases = createWorkoutPhasesContent(workout);
        
        return detailsGrid + phases;
    }
    
    /**
     * Crea il contenuto delle fasi dell'allenamento
     */
    function createWorkoutPhasesContent(workout) {
        const phases = [];
        
        if (workout.warmup) {
            phases.push({
                title: 'Riscaldamento',
                icon: 'fa-play-circle',
                content: workout.warmup
            });
        }
        
        if (workout.main_phase) {
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
    
    // ── Cambio stato scheda: riposo / saltato / reset ────────────
    // Aggiorna lo stato in DB e ri-renderizza la card senza ricaricare tutto.
    async function updateWorkoutStatus(workoutId, patch, successMsg) {
        try {
            showLoading();
            const { error } = await supabaseClient
                .from('workout_plans')
                .update(patch)
                .eq('id', workoutId)
                .eq('user_id', currentUser.id);
            if (error) throw error;
            const w = workouts.find(x => x.id === workoutId);
            if (w) Object.assign(w, patch);
            displayWorkouts(workouts);
            if (successMsg) showToast(successMsg, 'success');
        } catch (err) {
            console.error('Errore aggiornamento stato:', err);
            showToast('Errore nel cambio di stato', 'error');
        } finally {
            hideLoading();
        }
    }

    window.markWorkoutRest = async function(workoutId) {
        const ok = await window.showConfirm({
            title: 'Giorno di riposo',
            message: 'Segnare questa scheda come giorno di riposo? Non servono dati e conterà come recupero pianificato.',
            confirmText: 'Sì, è riposo', cancelText: 'Annulla'
        });
        if (!ok) return;
        updateWorkoutStatus(workoutId, { status: 'riposo', completed: false, completed_at: null, skip_reason: null }, 'Segnato come riposo 😴');
    };

    window.markWorkoutSkipped = async function(workoutId) {
        const reason = await promptSkipReason();
        if (reason === null) return; // annullato
        updateWorkoutStatus(workoutId, { status: 'saltato', completed: false, completed_at: null, skip_reason: reason || null }, 'Allenamento segnato come saltato');
    };

    window.resetWorkoutStatus = function(workoutId) {
        updateWorkoutStatus(workoutId, { status: 'da_fare', completed: false, completed_at: null, skip_reason: null }, 'Riportato a "Da fare"');
    };

    // Popup elegante per il motivo (opzionale) del salto. Ritorna la stringa
    // (anche vuota) se confermato, null se annullato.
    function promptSkipReason() {
        return new Promise(function (resolve) {
            const ov = document.createElement('div');
            ov.className = 'app-confirm-overlay';
            if (window.showConfirm) { /* riusa gli stili di utils.js */ }
            ov.innerHTML =
                '<div class="app-confirm" role="dialog" aria-modal="true" style="max-width:400px">' +
                    '<div class="app-confirm-icon"><i class="fas fa-forward"></i></div>' +
                    '<h3 class="app-confirm-title">Allenamento saltato</h3>' +
                    '<p class="app-confirm-msg">Vuoi indicare un motivo? (facoltativo)</p>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:-6px 0 14px">' +
                        ['Malato','Impegni','Stanco','Infortunio','Maltempo'].map(function (r) {
                            return '<button type="button" class="sr-chip" data-r="' + r + '" style="padding:6px 12px;border-radius:999px;border:1.5px solid #e5e7eb;background:#fff;color:#475569;font-size:.82rem;font-weight:600;cursor:pointer">' + r + '</button>';
                        }).join('') +
                    '</div>' +
                    '<input type="text" class="sr-input" maxlength="80" placeholder="Oppure scrivi un motivo..." style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:.9rem;font-family:inherit;margin-bottom:16px">' +
                    '<div class="app-confirm-actions">' +
                        '<button class="app-confirm-btn app-confirm-cancel">Annulla</button>' +
                        '<button class="app-confirm-btn app-confirm-ok">Conferma</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(ov);
            requestAnimationFrame(function () { ov.classList.add('is-open'); });
            const input = ov.querySelector('.sr-input');
            ov.querySelectorAll('.sr-chip').forEach(function (c) {
                c.addEventListener('click', function () { input.value = c.dataset.r; });
            });
            function done(val) {
                ov.classList.remove('is-open');
                setTimeout(function () { if (ov.parentNode) ov.remove(); }, 200);
                resolve(val);
            }
            ov.querySelector('.app-confirm-cancel').addEventListener('click', function () { done(null); });
            ov.querySelector('.app-confirm-ok').addEventListener('click', function () { done(input.value.trim()); });
            ov.addEventListener('click', function (e) { if (e.target === ov) done(null); });
            setTimeout(function () { input.focus(); }, 60);
        });
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
            const { error: updateError } = await supabaseClient
                .from('workout_plans')
                .update({
                    completed: true,
                    status: 'completato',
                    skip_reason: null,
                    completed_at: completedWorkoutData.completed_at,
                    average_heart_rate: formData.heartRateAvg > 0 ? formData.heartRateAvg : null
                })
                .eq('id', formData.workoutId)
                .eq('user_id', currentUser.id);

            if (updateError) {
                console.warn('Errore aggiornamento piano (non bloccante):', updateError.message);
            }

            // 3. UI aggiornata solo dopo che entrambe le operazioni DB sono complete
            closeModal('completeWorkoutModal');
            showToast('Allenamento completato con successo!', 'success');
            const wc = workouts.find(w => w.id === formData.workoutId);
            if (wc) { wc.status = 'completato'; wc.completed = true; wc.completed_at = completedWorkoutData.completed_at; wc.skip_reason = null; }
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
            notes: document.getElementById('workoutNotes').value.trim(),
            rating: parseInt(document.querySelector('input[name="rating"]:checked')?.value || 3)
        };
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
    
    /**
     * Reset completo dei dati utente
     */
    async function resetUserData() {
        const input = document.getElementById('confirmDeleteInput');
        if (!input || input.value !== 'ELIMINA') return;

        try {
            showLoading();

            // Elimina tutti i dati dell'utente
            // NOTA: Supabase NON lancia eccezioni su query error (ritorna {error}),
            // quindi Promise.all maschererebbe i fallimenti parziali. Usiamo
            // allSettled + ispezione esplicita di result.error per ogni tabella.
            const targets = [
                { table: 'workout_plans',      label: 'piani allenamento' },
                { table: 'completed_workouts', label: 'allenamenti completati' },
                { table: 'weekly_summaries',   label: 'riepiloghi settimanali' },
                { table: 'body_measurements',  label: 'misure corporee' },
                { table: 'user_preferences',   label: 'preferenze utente' }
            ];

            const results = await Promise.allSettled(
                targets.map(t =>
                    supabaseClient.from(t.table).delete().eq('user_id', currentUser.id)
                )
            );

            // Raccoglie tabelle che hanno fallito (rete OR errore Supabase)
            const failures = [];
            results.forEach((r, i) => {
                const label = targets[i].label;
                if (r.status === 'rejected') {
                    failures.push(`${label} (rete: ${r.reason?.message || 'errore sconosciuto'})`);
                } else if (r.value?.error) {
                    failures.push(`${label} (${r.value.error.message})`);
                }
            });

            // Reset variabili locali (lo facciamo comunque: se rimangono dati
            // l'utente li rivedrà al prossimo reload)
            workouts = [];
            displayWorkouts([]);
            displayWeeklyStats([]);

            if (failures.length === 0) {
                showToast('Tutti i dati sono stati eliminati con successo', 'success');
            } else if (failures.length < targets.length) {
                console.warn('Reset parziale, fallimenti:', failures);
                showToast(`Reset parziale — fallita eliminazione di: ${failures.join('; ')}`, 'warning', 8000);
            } else {
                console.error('Reset completamente fallito:', failures);
                showToast(`Errore: impossibile eliminare i dati (${failures[0]})`, 'error', 8000);
            }

        } catch (error) {
            console.error('Errore inatteso durante l\'eliminazione dei dati:', error);
            showToast('Errore inatteso durante l\'eliminazione dei dati', 'error');
        } finally {
            hideLoading();
            closeModal('confirmModal');
        }
    }
    
    // ===== EVENT LISTENERS =====
    
    /**
     * Setup di tutti gli event listeners
     */
    function setupEventListeners() {
        // Menu mobile
        setupMobileMenu();
        
        // Pulsante reset dati — resetta input e disabilita bottone ad ogni apertura
        if (elements.resetDataBtn) {
            elements.resetDataBtn.addEventListener('click', () => {
                const input = document.getElementById('confirmDeleteInput');
                const btn = document.getElementById('confirmDeleteBtn');
                if (input) input.value = '';
                if (btn) btn.disabled = true;
                openModal('confirmModal');
            });
        }
        
        // Conferma reset
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        const confirmDeleteInput = document.getElementById('confirmDeleteInput');

        if (confirmDeleteInput && confirmDeleteBtn) {
            confirmDeleteInput.addEventListener('input', () => {
                confirmDeleteBtn.disabled = confirmDeleteInput.value !== 'ELIMINA';
            });
        }

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', resetUserData);
        }

        // Annulla reset
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                closeModal('confirmModal');
            });
        }
        
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
