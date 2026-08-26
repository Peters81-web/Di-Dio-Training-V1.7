/**
 * AI Trainer - DiDio Training App
 */
document.addEventListener('DOMContentLoaded', async function () {
  const supabaseClient = window.supabaseClient || createSupabaseClient();

  // ── Difesa XSS ───────────────────────────────────────────────────────────
  // Il testo del piano arriva dall'AI, quindi è influenzabile dal prompt
  // dell'utente, e finisce sia in innerHTML sia salvato nel database (dove
  // viene ri-renderizzato da dashboard e archivio).
  //
  // sanitizeHtml: per l'HTML prodotto da marked, dove i tag servono davvero.
  // esc:          per i singoli campi, dove nessun tag è mai legittimo.
  function sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(html);
    // Se DOMPurify non ha caricato, meglio testo inerte che HTML non filtrato.
    return window.escapeHtml ? window.escapeHtml(html) : '';
  }

  // Riconosce l'errore "colonna inesistente" di PostgREST, per distinguerlo
  // da errori veri (rete, permessi, vincoli) che NON vanno mascherati da un
  // ritentativo silenzioso.
  function isMissingColumnError(err) {
    if (!err) return false;
    if (err.code === 'PGRST204' || err.code === '42703') return true;
    const m = String(err.message || '').toLowerCase();
    return m.includes('could not find') && m.includes('column');
  }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return window.escapeHtml ? window.escapeHtml(String(value)) : '';
  }
  let currentUser = null;
  let generatedWorkouts = [];
  let currentGeneratedActivityType = 'running';

  const elements = {
    planType: document.getElementById('planType'),
    fitnessLevel: document.getElementById('fitnessLevel'),
    aiPrompt: document.getElementById('aiPrompt'),
    generatePlanBtn: document.getElementById('generatePlanBtn'),
    aiResponseContainer: document.getElementById('aiResponseContainer'),
    aiResponse: document.getElementById('aiResponse'),
    saveWorkoutsBtn: document.getElementById('saveWorkoutsBtn'),
    regenerateBtn: document.getElementById('regenerateBtn'),
    newPlanBtn: document.getElementById('newPlanBtn'),
    workoutPreviewContainer: document.getElementById('workoutPreviewContainer'),
    workoutPreviewList: document.getElementById('workoutPreviewList'),
    confirmSaveBtn: document.getElementById('confirmSaveBtn'),
    cancelSaveBtn: document.getElementById('cancelSaveBtn'),
    aiLoadingOverlay: document.getElementById('aiLoadingOverlay'),
    logoutBtn: document.getElementById('logoutBtn'),
    activityType: document.getElementById('activityType')
  };

  let workoutContext = null;

  // PERCHÉ QUESTE DUE VARIABILI ESISTONO
  //
  // Lo storico è ciò che rende il piano personale, ma il suo caricamento
  // era invisibile in entrambe le direzioni: se falliva nessuno lo diceva,
  // e il pulsante "Genera" era cliccabile prima che finisse. In tutti e due
  // i casi il piano partiva con workoutContext ancora null, il server non
  // riceveva nulla da mettere nel prompt, e il modello — che il prompt
  // istruisce a dichiararlo — scriveva "piano costruito senza dati storici
  // perché non sono stati forniti". Dal di fuori sembrava che l'AI non
  // leggesse il database.
  //
  // contextReady: la promessa dell'ultimo caricamento, da attendere PRIMA
  //               di generare.
  // contextError: l'errore dell'ultima lettura, o null. Serve a distinguere
  //               "non hai allenamenti" da "non sono riuscito a leggerli",
  //               che per chi guarda la pagina sono la stessa schermata
  //               vuota ma per chi deve capire il guasto no.
  let contextReady = null;
  let contextError = null;

  async function init() {
    try {
      const session = await checkAuth();
      if (session) {
        currentUser = session.user;
        setupEventListeners();
        contextReady = loadWorkoutContext();
        await contextReady;
      }
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  /**
   * Estrae il nome della colonna mancante dal messaggio d'errore.
   * PostgREST:  Could not find the 'humidity' column of 'workout_plans' ...
   * Postgres :  column workout_plans.humidity does not exist
   */
  function missingColumnName(err) {
    const msg = String((err && err.message) || '');
    let m = msg.match(/could not find the '([^']+)' column/i);
    if (m) return m[1];
    m = msg.match(/column\s+(?:[\w.]*\.)?"?([\w]+)"?\s+does not exist/i);
    return m ? m[1] : null;
  }

  /**
   * Select con ripiego GRADUALE: toglie una alla volta solo le colonne che
   * il database dichiara di non conoscere, cercandole in entrambi i livelli
   * (completed_workouts e il nested workout_plans).
   *
   * Prima qui c'era un ripiego tutto-o-niente con una lista "completa" e una
   * "minima". Ma temperature viene dalla 003 e humidity dalla 005: con la
   * 003 eseguita e la 005 no, si ricadeva sulla lista minima perdendo ANCHE
   * la temperatura, che invece c'era. È lo stesso difetto che aveva fatto
   * sparire la mappa dal dettaglio (PR #48).
   */
  async function selectContext(baseCols, planCols, sinceIso) {
    let base = baseCols.slice();
    let plan = planCols.slice();
    const dropped = [];

    for (let attempt = 0; attempt < 8; attempt++) {
      const cols = base.join(', ') +
                   (plan.length ? `, workout_plans(${plan.join(',')})` : ', workout_plans(name)');

      const { data, error } = await supabaseClient
        .from('completed_workouts')
        .select(cols)
        .eq('user_id', currentUser.id)
        .gte('completed_at', sinceIso)
        .order('completed_at', { ascending: false })
        .limit(30);

      if (!error) {
        if (dropped.length) {
          console.warn('AI Trainer: colonne non ancora presenti nel database, ' +
                       'eseguire le migrazioni in migrations/. Ignorate: ' +
                       dropped.join(', '));
        }
        return { data: data || [], dropped, error: null };
      }
      if (!isMissingColumnError(error)) {
        console.warn('AI Trainer: contesto non disponibile.', error);
        return { data: [], dropped, error };
      }

      const bad = missingColumnName(error);
      // Nome non estraibile: meglio rinunciare al contesto che togliere
      // colonne alla cieca fino a svuotare la query.
      if (!bad) return { data: [], dropped, error };

      const inBase = base.indexOf(bad);
      const inPlan = plan.indexOf(bad);
      if (inBase === -1 && inPlan === -1) return { data: [], dropped, error };

      if (inBase !== -1) base.splice(inBase, 1);
      if (inPlan !== -1) plan.splice(inPlan, 1);
      dropped.push(bad);
    }
    // Otto tentativi esauriti: restituire un elenco vuoto SENZA errore
    // direbbe "nessun allenamento", che è un'altra cosa.
    return { data: [], dropped,
             error: new Error('troppe colonne mancanti (' + dropped.join(', ') + ')') };
  }

  /**
   * Progressione dei carichi in palestra, da exercise_sets (migrazione 006).
   * La TABELLA può non esistere: è un errore diverso dalla colonna mancante
   * (PGRST205/42P01 invece di PGRST204/42703), quindi serve un controllo
   * proprio. Senza la 006 il contesto prosegue senza la sezione carichi.
   */
  function isMissingTableError(err) {
    if (!err) return false;
    if (err.code === 'PGRST205' || err.code === '42P01') return true;
    const m = String(err.message || '').toLowerCase();
    if (m.indexOf('could not find the table') !== -1) return true;
    return m.indexOf('relation') !== -1 && m.indexOf('does not exist') !== -1;
  }

  async function loadGymProgress(sinceIso) {
    try {
      const { data, error } = await supabaseClient
        .from('exercise_sets')
        .select('exercise_name, exercise_key, reps, weight_kg, performed_at')
        .eq('user_id', currentUser.id)
        .gte('performed_at', sinceIso)
        .order('performed_at', { ascending: true });

      if (error) {
        if (isMissingTableError(error)) {
          console.warn('AI Trainer: tabella exercise_sets non presente, ' +
                       'eseguire migrations/006. Contesto senza carichi.');
        } else {
          console.warn('AI Trainer: carichi non disponibili.', error);
        }
        return [];
      }
      return window.AiContext ? window.AiContext.aggregateGymProgress(data || []) : [];
    } catch (err) {
      console.warn('AI Trainer: carichi non disponibili.', err);
      return [];
    }
  }

  /**
   * Aggiunge al contesto i dati che l'utente ha incollato a mano (VO2max,
   * sonno, FC a riposo, carichi di una scheda cartacea: qualsiasi cosa il
   * database non abbia).
   *
   * Se il contesto automatico non c'è ancora — primo utilizzo, nessun
   * allenamento negli ultimi 30 giorni — le note da sole valgono comunque
   * un contesto: senza questo, chi non ha storico non potrebbe far leggere
   * niente all'AI.
   */
  function withUserNotes(ctx) {
    const el = document.getElementById('aiUserData');
    const notes = el ? String(el.value || '').trim() : '';
    if (!notes) return ctx;
    return Object.assign({}, ctx || {}, { userNotes: notes });
  }

  async function loadWorkoutContext() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sinceIso = thirtyDaysAgo.toISOString();

      // heart_rate_avg, distance, perceived_difficulty e rating erano già nel
      // database e non venivano mai chiesti: l'AI pianificava senza sapere a
      // quale frequenza cardiaca e a quale ritmo l'utente si allena, né quali
      // sessioni ha trovato dure.
      // 'notes' porta il dettaglio che nessun altro campo ha: i ritmi per
      // singolo tratto, il fondo, la FC per blocco. distance e
      // heart_rate_avg sono medie dell'intera sessione e appiattiscono
      // proprio quella differenza.
      const BASE_COLS = ['completed_at', 'actual_duration', 'distance',
                         'calories_burned', 'heart_rate_avg',
                         'perceived_difficulty', 'rating', 'notes'];
      // hr_series (008) porta il tracciato cardiaco: da lì si ricava il
      // tempo REALE in zona, invece della zona dedotta dalla media — che
      // su una corsa vera diceva "zona 2" mentre il 45% era in zona 3.
      const PLAN_COLS = ['name', 'activity_type', 'temperature', 'humidity',
                         'hr_series',
                         'max_heart_rate'];

      // Le tre letture sono indipendenti: in parallelo per non sommare le
      // latenze, dato che la pagina attende il contesto per mostrare la card.
      const [ctxRes, hrProfile, gymProgress] = await Promise.all([
        selectContext(BASE_COLS, PLAN_COLS, sinceIso),
        window.HrModel
          ? window.HrModel.loadProfile(supabaseClient, currentUser.id)
          : Promise.resolve(null),
        loadGymProgress(sinceIso)
      ]);

      contextError = ctxRes.error || null;

      const completed = ctxRes.data;
      if (!completed.length) {
        workoutContext = null;
        renderNoContextCard(contextError);
        return;
      }

      const totalCompleted = completed.length;
      const avgDuration = Math.round(
        completed.reduce((s, w) => s + (w.actual_duration || 45), 0) / totalCompleted
      );

      // Frequenza settimanale (ultimi 30 giorni = ~4.3 settimane)
      const avgPerWeek = (totalCompleted / 4.3).toFixed(1);

      // Attività più frequente
      const actCounts = {};
      completed.forEach(w => {
        const act = w.activity_type || w.workout_plans?.activity_type || 'gym';
        actCounts[act] = (actCounts[act] || 0) + 1;
      });
      const topActivity = Object.entries(actCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

      // Streak (giorni consecutivi)
      const days = new Set(completed.map(w => w.completed_at.slice(0, 10)));
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (days.has(key)) { streak++; } else if (i > 0) { break; }
      }

      // Ultimi nomi allenamenti
      const lastWorkouts = completed.slice(0, 5)
        .map(w => w.workout_plans?.name)
        .filter(Boolean);

      // Condizioni ambientali tipiche degli allenamenti recenti.
      // Servono all'AI per calibrare ritmi e idratazione: un piano pensato
      // per 12 gradi e aria secca non regge a 28 gradi con l'80% di umidità,
      // dove a parità di ritmo la frequenza cardiaca sale e il sudore
      // evapora poco.
      const temps = completed.map(w => w.workout_plans?.temperature)
                             .filter(v => typeof v === 'number');
      const hums  = completed.map(w => w.workout_plans?.humidity)
                             .filter(v => typeof v === 'number');
      const avg = arr => arr.length
        ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
        : null;

      const avgTemperature = avg(temps);
      const avgHumidity    = avg(hums);

      // I dati che rendono il piano davvero personale: a che frequenza
      // cardiaca e a che ritmo si allena, quali sessioni ha trovato dure,
      // con che carichi lavora in palestra.
      const activityStats = window.AiContext
        ? window.AiContext.aggregateByActivity(completed, hrProfile) : [];
      const hardSessions  = window.AiContext
        ? window.AiContext.findHardSessions(completed) : [];
      const sessionNotes  = window.AiContext
        ? window.AiContext.collectSessionNotes(completed) : [];

      workoutContext = { totalCompleted, avgDuration, avgPerWeek, topActivity, streak,
                         lastWorkouts, avgTemperature, avgHumidity, sessionNotes,
                         maxHr:         hrProfile ? hrProfile.maxHr  : null,
                         restHr:        hrProfile ? hrProfile.restHr : null,
                         maxIsMeasured: hrProfile ? !!hrProfile.maxIsMeasured : false,
                         activityStats, hardSessions, gymProgress };
      renderContextCard(workoutContext);
    } catch (err) {
      console.warn('Context load error:', err);
      contextError = err;
      workoutContext = null;
      renderNoContextCard(err);
    }
  }

  /**
   * La card quando lo storico NON c'è.
   *
   * Prima in questo caso non compariva niente: la card restava
   * display:none e la pagina sembrava semplicemente più corta. Ma "non
   * hai allenamenti" e "non sono riuscito a leggerli" portano a due
   * azioni diverse — nel primo caso si va ad allenarsi, nel secondo c'è
   * un guasto da guardare — e nasconderli entrambi dietro la stessa
   * assenza è il motivo per cui è servita mezza giornata per capire
   * perché l'AI diceva di non avere dati.
   */
  function renderNoContextCard(err) {
    const card  = document.getElementById('contextCard');
    const stats = document.getElementById('contextStats');
    const badge = document.getElementById('contextBadge');
    const box   = document.getElementById('contextDetail');
    const sugg  = document.getElementById('contextSuggestions');
    if (!card || !stats) return;

    if (badge) badge.textContent = '';
    // I suggerimenti rapidi si costruiscono sui numeri dello storico:
    // senza, sarebbero frasi con dei buchi.
    if (sugg) sugg.style.display = 'none';

    if (err) {
      const msg = String((err && err.message) || err || 'errore sconosciuto');
      stats.innerHTML =
        '<div class="ctx-empty is-error">' +
          '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>' +
          '<strong>Storico non letto.</strong> ' +
          'Il piano verrà generato SENZA i tuoi dati. ' +
          'Ricarica la pagina; se il problema resta, il dettaglio è: ' +
          '<code>' + esc(msg) + '</code>' +
        '</div>';
    } else {
      stats.innerHTML =
        '<div class="ctx-empty">' +
          '<i class="fas fa-circle-info" aria-hidden="true"></i>' +
          '<strong>Nessun allenamento completato negli ultimi 30 giorni.</strong> ' +
          'Il piano sarà tarato solo su obiettivo e livello. ' +
          'Completa qualche sessione (o incolla i tuoi dati qui sopra) ' +
          'e il prossimo piano userà anche quelli.' +
        '</div>';
    }

    if (box) box.innerHTML = '';
    card.style.display = 'block';
  }


  const ACT_LABELS = {
    running: 'Corsa', gym: 'Palestra', yoga: 'Yoga',
    cycling: 'Ciclismo', mobility: 'Mobilità', walking: 'Camminata'
  };

  function renderContextCard(ctx) {
    const card = document.getElementById('contextCard');
    const stats = document.getElementById('contextStats');
    const badge = document.getElementById('contextBadge');
    const quickPrompts = document.getElementById('quickPrompts');
    if (!card) return;

    // La card può essere già stata disegnata nello stato "storico assente"
    // da un caricamento precedente: quello nascondeva i suggerimenti.
    const sugg = document.getElementById('contextSuggestions');
    if (sugg) sugg.style.display = '';

    badge.textContent = ctx.streak > 0 ? `🔥 ${ctx.streak} giorni di fila` : '';

    stats.innerHTML = `
      <div class="ctx-stat"><i class="fas fa-check-circle"></i><span>${ctx.totalCompleted}</span><small>completati (30gg)</small></div>
      <div class="ctx-stat"><i class="fas fa-calendar-alt"></i><span>${ctx.avgPerWeek}</span><small>sessioni/sett.</small></div>
      <div class="ctx-stat"><i class="fas fa-clock"></i><span>${ctx.avgDuration}m</span><small>durata media</small></div>
      <div class="ctx-stat"><i class="fas fa-running"></i><span>${ACT_LABELS[ctx.topActivity] || ctx.topActivity || '--'}</span><small>attività top</small></div>
    `;

    renderContextDetail(ctx);

    // Suggerimenti contestuali
    const suggestions = buildSuggestions(ctx);
    quickPrompts.innerHTML = suggestions.map(s =>
      `<button class="quick-prompt-btn" data-prompt="${s.prompt}" data-activity="${s.activity}">${s.label}</button>`
    ).join('');

    quickPrompts.querySelectorAll('.quick-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const promptEl = document.getElementById('aiPrompt');
        if (promptEl) promptEl.value = btn.dataset.prompt;
        const actEl = document.getElementById('activityType');
        if (actEl && btn.dataset.activity) actEl.value = btn.dataset.activity;
      });
    });

    card.style.display = 'block';
  }

  /**
   * Elenco esplicito di ciò che viene inviato all'AI.
   *
   * PERCHÉ ESISTE: la card mostrava quattro numeri generici, e non c'era modo
   * di sapere se frequenza cardiaca, ritmo e carichi arrivassero al prompt.
   * Chiederlo all'AI non funziona — questa pagina genera piani, non risponde
   * a domande — quindi l'unica verifica possibile era leggere il codice.
   *
   * Mostra anche ciò che MANCA e come ottenerlo: due delle sezioni del prompt
   * dipendono da dati che l'utente deve iniziare a registrare (la difficoltà
   * percepita si imposta completando un allenamento a mano, i carichi con il
   * log palestra). Senza dirlo, restano vuote senza spiegazione.
   */
  function renderContextDetail(ctx) {
    const box = document.getElementById('contextDetail');
    if (!box) return;

    const rows = [];
    const fmtPace = s => (window.AiContext ? window.AiContext.formatPace(s) : null);

    // La prima riga è la più importante e prima non c'era: dice se lo
    // storico arriva davvero al prompt. Tutte le righe sotto descrivono
    // COSA c'è dentro, ma nessuna diceva SE c'è — e quando mancava, la
    // card semplicemente non compariva.
    rows.push({
      ok: true,
      label: 'Storico',
      value: `${ctx.totalCompleted} session${ctx.totalCompleted === 1 ? 'e' : 'i'} ` +
             'degli ultimi 30 giorni'
    });

    (ctx.activityStats || []).forEach(s => {
      const bits = [];
      if (s.avgHr !== null && s.avgHr !== undefined) {
        bits.push(`FC ${s.avgHr} bpm${s.zone ? ` · Z${s.zone}` : ''}`);
      }
      const p = fmtPace(s.avgPaceSec);
      if (p) bits.push(`${p} min/km`);
      if (s.avgKm) bits.push(`${String(s.avgKm).replace('.', ',')} km`);
      if (!bits.length) bits.push(`${s.n} sessioni`);
      rows.push({
        ok: true,
        label: ACT_LABELS[s.type] || s.type,
        value: bits.join(' · ')
      });
    });

    if (ctx.maxHr) {
      rows.push({
        ok: true,
        label: 'Zone cardio',
        value: ctx.restHr
          ? `Karvonen · max ${ctx.maxHr}${ctx.maxIsMeasured ? '' : ' (stimata)'} · riposo ${ctx.restHr}`
          : `% della massima ${ctx.maxHr}${ctx.maxIsMeasured ? '' : ' (stimata)'}`
      });
    } else {
      rows.push({
        ok: false,
        label: 'Zone cardio',
        value: 'imposta FC massima e a riposo nel Profilo'
      });
    }

    if ((ctx.gymProgress || []).length) {
      rows.push({
        ok: true,
        label: 'Carichi palestra',
        value: ctx.gymProgress.map(g =>
          `${g.exercise} ${String(g.toKg).replace('.', ',')} kg`).join(' · ')
      });
    } else {
      rows.push({
        ok: false,
        label: 'Carichi palestra',
        value: 'registra le serie dal dettaglio di un allenamento in palestra'
      });
    }

    if ((ctx.hardSessions || []).length) {
      rows.push({
        ok: true,
        label: 'Sessioni dure',
        value: ctx.hardSessions.map(s => `${s.name} ${s.difficulty}/5`).join(' · ')
      });
    } else {
      rows.push({
        ok: false,
        label: 'Difficoltà percepita',
        value: 'indica quanto è stato faticoso quando completi un allenamento'
      });
    }

    // Le note delle sessioni. Vanno mostrate qui più di ogni altra riga:
    // sono l'unico dato che dipende interamente da un'abitudine
    // dell'utente, e senza un riscontro visibile non c'è motivo di
    // continuare a scriverle.
    if ((ctx.sessionNotes || []).length) {
      const n = ctx.sessionNotes.length;
      rows.push({
        ok: true,
        label: 'Appunti di fine sessione',
        value: `${n} ${n === 1 ? 'sessione' : 'sessioni'} · ` +
               ctx.sessionNotes.map(s => s.date).filter(Boolean).join(', ')
      });
    } else {
      rows.push({
        ok: false,
        label: 'Appunti di fine sessione',
        value: 'scrivi nel campo note quando completi: ritmi, fondo, sensazioni'
      });
    }

    box.innerHTML =
      '<p class="ctx-hint"><i class="fas fa-paper-plane" aria-hidden="true"></i> ' +
      'Cosa riceve l\'AI</p>' +
      rows.map(r =>
        `<div class="ctx-row ${r.ok ? 'is-on' : 'is-off'}">` +
          `<i class="fas ${r.ok ? 'fa-check' : 'fa-minus'}" aria-hidden="true"></i>` +
          `<span class="ctx-row-l">${esc(r.label)}</span>` +
          `<span class="ctx-row-v">${esc(r.value)}</span>` +
        '</div>'
      ).join('');
  }

  function buildSuggestions(ctx) {
    const suggestions = [];
    const avg = parseFloat(ctx.avgPerWeek);

    if (ctx.streak === 0) {
      suggestions.push({
        label: '🚀 Riparti dopo una pausa',
        prompt: `Ho fatto una pausa e voglio riprendere gradualmente. Negli ultimi 30 giorni ho fatto ${ctx.totalCompleted} allenamenti. Crea un piano soft per rientrare senza infortuni.`,
        activity: ctx.topActivity || 'gym'
      });
    } else if (ctx.streak >= 7) {
      suggestions.push({
        label: '🔥 Sono in forma, alza il livello',
        prompt: `Sono in striscia da ${ctx.streak} giorni e mi sento in forma. Voglio un piano più sfidante. Durata media attuale: ${ctx.avgDuration} min. Aumenta intensità e volume.`,
        activity: ctx.topActivity || 'gym'
      });
    }

    if (avg < 2) {
      suggestions.push({
        label: '📈 Aumenta la frequenza',
        prompt: `Mi alleno circa ${ctx.avgPerWeek} volte a settimana e voglio aumentare la frequenza gradualmente. Crea un piano da 3-4 sessioni settimanali compatibile con i miei impegni.`,
        activity: ctx.topActivity || 'gym'
      });
    } else if (avg >= 4) {
      suggestions.push({
        label: '💪 Ottimizza il recupero',
        prompt: `Mi alleno ${ctx.avgPerWeek} volte a settimana. Voglio un piano che bilanci carico e recupero, includendo sessioni di mobilità e stretching attivo.`,
        activity: 'mobility'
      });
    }

    suggestions.push({
      label: '🎯 Migliora in ' + (ACT_LABELS[ctx.topActivity] || 'palestra'),
      prompt: `Voglio migliorare le mie performance in ${ACT_LABELS[ctx.topActivity] || 'palestra'}. Durata media sessioni: ${ctx.avgDuration} min. Crea un piano progressivo di 4 settimane.`,
      activity: ctx.topActivity || 'gym'
    });

    return suggestions.slice(0, 3);
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
      return null;
    }
  }

  function getSelectedActivityType() {
    return elements.activityType ? elements.activityType.value : 'running';
  }

  function inferActivityTypeFromText(workout) {
    const text = [
      workout?.activity_type,
      workout?.name,
      workout?.objective,
      workout?.main_phase,
      workout?.notes,
      workout?.rawText
    ].filter(Boolean).join(' ').toLowerCase();

    if (/(corsa|running|ripetute|resistenza|velocit|jogging|fartlek)/.test(text)) return 'running';
    if (/(palestra|gym|forza|manubri|bilanciere|squat|stacchi|push|pull)/.test(text)) return 'gym';
    if (/(yoga|saluto al sole)/.test(text)) return 'yoga';
    if (/(cicl|bike|cycling|bici|spin)/.test(text)) return 'cycling';
    if (/(mobilit|stretching|flessibilit|mobility)/.test(text)) return 'mobility';
    if (/(cammin|walking|passeggiata|passo)/.test(text)) return 'walking';

    return currentGeneratedActivityType || 'gym';
  }

  function setupEventListeners() {
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/';
      });
    }

    if (elements.generatePlanBtn) {
      elements.generatePlanBtn.addEventListener('click', generatePlan);
    }

    if (elements.regenerateBtn) {
      elements.regenerateBtn.addEventListener('click', generatePlan);
    }

    if (elements.newPlanBtn) {
      elements.newPlanBtn.addEventListener('click', () => {
        elements.aiResponseContainer.style.display = 'none';
        elements.workoutPreviewContainer.style.display = 'none';
        elements.aiPrompt.value = '';
        generatedWorkouts = [];
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    if (elements.saveWorkoutsBtn) {
      elements.saveWorkoutsBtn.addEventListener('click', showPreview);
    }

    if (elements.confirmSaveBtn) {
      elements.confirmSaveBtn.addEventListener('click', saveWorkouts);
    }

    if (elements.cancelSaveBtn) {
      elements.cancelSaveBtn.addEventListener('click', () => {
        elements.workoutPreviewContainer.style.display = 'none';
      });
    }
  }

  // Il conto alla rovescia in corso, se c'è. Uno solo alla volta: due
  // rifiuti ravvicinati lascerebbero due timer a contendersi il pulsante.
  let rateLimitTimer = null;

  /**
   * Il limite di quota di Groq, detto in modo utilizzabile.
   *
   * PERCHÉ NON BASTA MOSTRARE L'ERRORE
   * Groq risponde con un testo come "Rate limit reached for model
   * openai/gpt-oss-120b in organization org_01kq... service tier
   * on_demand on tokens per minute (TPM): Limit 8000, Used 5289,
   * Requested 5229. Please try again in 18.884999999s." — inglese, con
   * l'id dell'organizzazione e un link al billing. L'app lo inoltrava
   * di peso, e quello che l'utente doveva fare (aspettare venti secondi)
   * era l'unica cosa che non si capiva.
   *
   * Qui l'attesa diventa l'elemento principale: il pulsante si spegne,
   * conta alla rovescia e si riaccende da solo. Non si riprova in
   * automatico — una rigenerazione consuma quota e va decisa dall'utente,
   * non innescata da un timer che nessuno sta guardando.
   */
  function showRateLimit(data) {
    const msg = (data && data.error) ||
                'Limite di Groq raggiunto. Riprova fra qualche istante.';
    let sec = Number(data && data.retryAfter);
    if (!Number.isFinite(sec) || sec < 1) sec = 0;

    if (elements.aiResponse) {
      elements.aiResponse.innerHTML =
        '<div class="rate-limit-note">' +
          '<i class="fas fa-hourglass-half" aria-hidden="true"></i>' +
          '<div>' +
            '<strong>' + esc(msg) + '</strong>' +
            '<p>Non è un guasto dell\'app: è la quota del piano gratuito di ' +
            'Groq, contata al minuto sull\'intero account. Una generazione ne ' +
            'prenota una fetta grossa, quindi due di fila nello stesso minuto ' +
            'non ci stanno.</p>' +
          '</div>' +
        '</div>';
      elements.aiResponseContainer.style.display = 'block';
    }
    window.showToast(msg, 'warning', 8000);

    const btn = elements.generatePlanBtn;
    if (!btn || !sec) return;

    clearInterval(rateLimitTimer);
    const etichetta = btn.innerHTML;
    btn.disabled = true;

    const tick = () => {
      if (sec <= 0) {
        clearInterval(rateLimitTimer);
        rateLimitTimer = null;
        btn.disabled = false;
        btn.innerHTML = etichetta;
        return;
      }
      btn.innerHTML = '<i class="fas fa-hourglass-half" aria-hidden="true"></i> ' +
                      'Riprova fra ' + sec + 's';
      sec--;
    };
    tick();
    rateLimitTimer = setInterval(tick, 1000);
  }

  async function generatePlan() {
    const prompt = elements.aiPrompt ? elements.aiPrompt.value.trim() : '';
    const planType = elements.planType ? elements.planType.value : 'weekly';
    const fitnessLevel = elements.fitnessLevel ? elements.fitnessLevel.value : 'intermediate';
    const activityType = getSelectedActivityType();

    currentGeneratedActivityType = activityType;

    if (!prompt) {
      window.showToast('Per favore descrivi il tuo obiettivo di allenamento.', 'warning');
      return;
    }

    if (window.showAiLoading) window.showAiLoading();
    generatedWorkouts = [];

    try {
      // ASPETTA LO STORICO PRIMA DI GENERARE.
      //
      // setupEventListeners() rende cliccabile "Genera" prima che
      // loadWorkoutContext() abbia finito: su rete lenta, un clic svelto
      // spediva il piano con workoutContext ancora null e il modello
      // rispondeva di non avere dati. Un secondo tentativo funzionava, il
      // che rendeva il difetto difficile da riconoscere.
      //
      // Se il caricamento era fallito si RIPROVA qui: è passato del tempo
      // dall'apertura della pagina, e la rete può essere tornata.
      if (contextReady) {
        try { await contextReady; } catch (e) { /* già segnalato nella card */ }
      }
      if (!workoutContext && contextError) {
        contextReady = loadWorkoutContext();
        try { await contextReady; } catch (e) { /* idem */ }
      }
      // Un piano generato senza storico è legittimo (chi comincia non ne
      // ha), ma se lo storico c'è e non si è riusciti a leggerlo l'utente
      // deve saperlo PRIMA di credere che il piano sia tarato su di lui.
      if (!workoutContext && contextError) {
        window.showToast(
          'Storico non disponibile: il piano sarà generato senza i tuoi dati.',
          'warning');
      }

      // Il server ora richiede un token valido: senza, l'endpoint AI sarebbe
      // aperto a chiunque e la quota Groq bruciabile dall'esterno.
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        throw new Error('Sessione scaduta. Effettua di nuovo il login.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        // I dati incollati a mano si leggono ORA e non al caricamento della
        // pagina: l'utente li scrive dopo, e un contesto congelato all'avvio
        // li ignorerebbe silenziosamente.
        body: JSON.stringify({ prompt, planType, fitnessLevel, activityType,
                               workoutContext: withUserNotes(workoutContext) }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // La quota non è un guasto: si aspetta e si riprova. Trattarla
        // come un errore qualunque mandava a cercare un problema che non
        // c'è, per giunta leggendo l'inglese di Groq.
        if (response.status === 429) {
          showRateLimit(errorData);
          return;
        }
        throw new Error(errorData.error || 'HTTP ' + response.status);
      }

      const data = await response.json();

      if (elements.aiResponse && data.text) {
        elements.aiResponse.innerHTML = sanitizeHtml(marked.parse(data.text));
        elements.aiResponseContainer.style.display = 'block';
        generatedWorkouts = parseAIResponse(data.text);
        console.log('Allenamenti parsati:', generatedWorkouts.length, generatedWorkouts);

        // SE NON SI È CAPITO NIENTE, DIRLO ORA.
        //
        // Prima il fallimento era silenzioso: il piano compariva a
        // schermo, sembrava tutto a posto, e solo premendo "Salva" —
        // magari minuti dopo — arrivava "Nessun allenamento da salvare",
        // senza spiegare perché. L'utente non aveva modo di collegare le
        // due cose.
        //
        // Il piano NON viene nascosto: resta leggibile e si può copiare a
        // mano. Si dichiara solo che non è salvabile, e perché.
        if (!generatedWorkouts.length) {
          const avviso = document.createElement('div');
          avviso.className = 'error-message';
          avviso.innerHTML =
            '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i> ' +
            "Il piano è qui sotto, ma non sono riuscito a riconoscerne la " +
            'struttura in schede: il modello non ha usato le sezioni ' +
            'Riscaldamento / Fase Principale. <strong>Il pulsante Salva non ' +
            'funzionerà.</strong> Prova a rigenerare, oppure copia il testo a mano.';
          elements.aiResponse.prepend(avviso);
          window.showToast('Piano generato ma non salvabile: struttura non riconosciuta.',
                           'warning', 8000);
        }
      }
    } catch (error) {
      console.error('Error generating plan:', error);
      const msg = error.name === 'AbortError'
        ? 'La generazione ha impiegato troppo tempo. Riprova con un obiettivo più breve.'
        : 'Errore: ' + error.message;
      if (elements.aiResponse) {
        elements.aiResponse.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> ${esc(msg)}</div>`;
        elements.aiResponseContainer.style.display = 'block';
      }
    } finally {
      if (window.hideAiLoading) window.hideAiLoading();
    }
  }

  // Vive in plan-days.js insieme alla numerazione: sono due facce dello
  // stesso testo ("### Giorno 1: **Corsa**"), e da lì sono verificabili
  // dai controlli senza aprire un browser. Il ripiego serve solo se il
  // modulo non fosse stato caricato: meglio un titolo con gli asterischi
  // che un piano che non si salva.
  const cleanTitle = (window.PlanDays && window.PlanDays.cleanTitle) ||
    function (raw) { return String(raw || '').trim(); };

  function parseAIResponse(text) {
    const workouts = [];

    // Oggi, come 'YYYY-MM-DD'. Serve sia per dedurre l'anno quando il
    // titolo dice solo "24 Agosto", sia come punto di partenza per il
    // ripiego progressivo.
    const now = new Date();
    const todayIso = new Date(Date.UTC(
      now.getFullYear(), now.getMonth(), now.getDate(), 12)).toISOString().split('T')[0];

    // LA LETTURA DELLA STRUTTURA STA IN plan-days.js.
    //
    // Qui c'era uno split che pretendeva "### " per il titolo e "#### "
    // per le sottosezioni. Qualunque altra forma dava ZERO schede in
    // silenzio: il piano si vedeva a schermo — marked renderizza tutto —
    // ma "Salva" rispondeva "Nessun allenamento da salvare". Delle sei
    // forme che un modello scrive comunemente ne veniva letta UNA.
    const blocks = window.PlanDays
      ? window.PlanDays.parsePlanBlocks(text)
      : [];

    console.log('Blocchi giorno trovati:', blocks.length);

    const titles = blocks.map(function (b) { return b.title; });

    // LA DATA LA DECIDE L'UTENTE, NON L'OROLOGIO.
    //
    // Prima qui c'era un contatore che partiva da oggi e avanzava di un
    // giorno per blocco, ignorando del tutto la data scritta nel titolo.
    // Chiedendo all'AI un piano "a partire dal 24 agosto" il 23, il
    // modello ubbidiva e intitolava la prima sessione "24 Agosto", ma
    // l'app la programmava per il 23: tutto il piano sfasato di un
    // giorno, e il titolo che contraddiceva il calendario.
    //
    // Le date si calcolano su TUTTI i blocchi, riposi compresi: un
    // riposo occupa un giorno di calendario, e saltarlo qui farebbe
    // scalare in avanti ogni sessione successiva.
    const dates = window.PlanDays
      ? window.PlanDays.schedulePlanDates(titles, todayIso)
      : titles.map(function () { return todayIso; });

    blocks.forEach(function (day, idx) {
      const firstLine = titles[idx];
      const isRest = day.isRest;

      const warmup = day.warmup;
      const mainPhase = day.mainPhase;
      const cooldown = day.cooldown;
      const notes = day.notes;

      if (!isRest && (warmup || mainPhase)) {
        workouts.push({
          name: cleanTitle(firstLine) || firstLine,
          scheduled_date: dates[idx],
          warmup: warmup,
          main_phase: mainPhase,
          cooldown: cooldown,
          notes: notes,
          total_duration: 45,
          objective: "Piano generato dall'AI Trainer",
          source: 'ai',
          activity_type: currentGeneratedActivityType || inferActivityTypeFromText({
            name: firstLine,
            warmup,
            main_phase: mainPhase,
            cooldown,
            notes,
            rawText: day.title + '\n' + mainPhase
          })
        });
      }
    });

    return workouts;
  }

  function showPreview() {
    if (generatedWorkouts.length === 0) {
      window.showToast('Nessun allenamento da salvare. Genera prima un piano.', 'warning');
      return;
    }

    // Lo stesso numero che comparirà sulle schede in dashboard, calcolato
    // dalla stessa funzione. Prima l'anteprima contava le posizioni
    // (1, 2, 3, 4, 5): su un piano con riposo al quarto giorno avrebbe
    // detto "4" dove la scheda salvata dice "Giorno 5", creando proprio la
    // confusione che questa etichetta serve a togliere.
    const dayNumbers = window.PlanDays
      ? window.PlanDays.planDayNumbers(generatedWorkouts)
      : generatedWorkouts.map(function () { return null; });

    if (elements.workoutPreviewList) {
      elements.workoutPreviewList.innerHTML = generatedWorkouts.map(function (w, i) {
        // Senza numero del piano si ricade sulla posizione: meglio un
        // numero approssimativo che un cerchio vuoto.
        const day = dayNumbers[i];
        const num = day || (i + 1);
        const hint = day ? `Giorno ${day} del piano` : `Sessione ${i + 1}`;
        return `
          <div class="preview-item">
            <div class="preview-item-header">
              <span class="preview-item-number" title="${esc(hint)}">${num}</span>
              <h4>${esc(w.name)}</h4>
            </div>
            <div class="preview-item-details">
              <p><strong>Tipo:</strong> ${esc(w.activity_type || 'gym')}</p>
              <p><strong>Data:</strong> ${esc(new Date(w.scheduled_date + 'T12:00:00').toLocaleDateString('it-IT'))}</p>
              ${w.warmup ? `<p><strong>Riscaldamento:</strong> ${esc(w.warmup)}</p>` : ''}
              ${w.main_phase ? `<p><strong>Fase Principale:</strong> ${esc(w.main_phase)}</p>` : ''}
              ${w.cooldown ? `<p><strong>Defaticamento:</strong> ${esc(w.cooldown)}</p>` : ''}
              ${w.notes ? `<p><strong>Note:</strong> ${esc(w.notes)}</p>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    if (elements.workoutPreviewContainer) {
      elements.workoutPreviewContainer.style.display = 'block';
      elements.workoutPreviewContainer.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function saveWorkouts() {
    if (!currentUser || generatedWorkouts.length === 0) {
      window.showToast('Nessun allenamento da salvare.', 'warning');
      return;
    }

    const activityType = getSelectedActivityType();

    const workoutsWithUserId = generatedWorkouts.map(function (workout) {
      return Object.assign({}, workout, {
        user_id: currentUser.id,
        activity_id: null,
        activity_type: workout.activity_type || activityType
      });
    });

    try {
      // source arriva da migrations/004: se non è stata eseguita, l'INSERT
      // fallirebbe in blocco e il piano generato andrebbe perso. Al primo
      // errore riproviamo senza quel campo — la provenienza resta comunque
      // riconoscibile dall'obiettivo "Piano generato dall'AI Trainer".
      let result = await supabaseClient.from('workout_plans').insert(workoutsWithUserId);

      if (result.error && isMissingColumnError(result.error)) {
        console.warn('AI Trainer: colonna source non disponibile, eseguire ' +
                     'migrations/004-workout-source.sql. Salvo senza.', result.error);
        const stripped = workoutsWithUserId.map(function (w) {
          const copy = Object.assign({}, w);
          delete copy.source;
          return copy;
        });
        result = await supabaseClient.from('workout_plans').insert(stripped);
      }

      if (result.error) throw result.error;

      window.showToast('Allenamenti salvati con successo!', 'success');
      generatedWorkouts = [];

      if (elements.workoutPreviewContainer) elements.workoutPreviewContainer.style.display = 'none';
      if (elements.aiResponseContainer) elements.aiResponseContainer.style.display = 'none';
      if (elements.aiPrompt) elements.aiPrompt.value = '';
    } catch (error) {
      console.error('Error saving workouts:', error);
      window.showToast('Errore durante il salvataggio: ' + error.message, 'error');
    }
  }

  await init();
});
