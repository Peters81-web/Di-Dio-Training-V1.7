/**
 * fase3-features.js
 * Recupero muscolare + Offline mode (Service Worker + PWA)
 */

(function () {
'use strict';

// ─── COSTANTI RECUPERO ────────────────────────────────────────────────────────

const MUSCLES = [
  { id: 'petto',    label: 'Petto',    recoveryHours: 48 },
  { id: 'schiena',  label: 'Schiena',  recoveryHours: 48 },
  { id: 'gambe',    label: 'Gambe',    recoveryHours: 72 },
  { id: 'spalle',   label: 'Spalle',   recoveryHours: 48 },
  { id: 'braccia',  label: 'Braccia',  recoveryHours: 36 },
  { id: 'core',     label: 'Core',     recoveryHours: 24 },
];

// Mappa attività → muscoli coinvolti
const ACTIVITY_MUSCLES = {
  running:  ['gambe', 'core'],
  gym:      ['petto', 'schiena', 'spalle', 'braccia', 'gambe', 'core'],
  yoga:     ['core', 'schiena'],
  cycling:  ['gambe', 'core'],
  mobility: ['core', 'schiena'],
  walking:  ['gambe'],
};

// Keyword nei nomi allenamento → muscoli
const KEYWORD_MUSCLES = {
  petto:   ['petto', 'chest', 'panca', 'bench', 'push'],
  schiena: ['schiena', 'back', 'pull', 'remator', 'stacch', 'dorsali', 'deadlift'],
  gambe:   ['gambe', 'leg', 'squat', 'lunge', 'affond', 'quad', 'glutei', 'polpacci'],
  spalle:  ['spalle', 'shoulder', 'military', 'deltoid', 'lateral'],
  braccia: ['braccia', 'bicep', 'tricep', 'curl', 'arm'],
  core:    ['core', 'addomin', 'plank', 'abs', 'lombare', 'crunch'],
};

function musclesFromWorkout(workout) {
  const actType = workout.activity_type || workout.workout_plans?.activity_type || 'gym';
  const text = [
    workout.workout_plans?.name,
    workout.workout_plans?.objective,
  ].filter(Boolean).join(' ').toLowerCase();

  // If not gym, use activity map directly
  if (actType !== 'gym') {
    return ACTIVITY_MUSCLES[actType] || ['core'];
  }

  // For gym, try to infer from workout name
  const found = new Set();
  for (const [muscle, keywords] of Object.entries(KEYWORD_MUSCLES)) {
    if (keywords.some(kw => text.includes(kw))) found.add(muscle);
  }

  // If no keywords matched, assume full body gym session
  if (found.size === 0) return ACTIVITY_MUSCLES.gym;
  return [...found];
}

// ─── RECOVERY TRACKER ────────────────────────────────────────────────────────

async function initRecovery() {
  const supabase = window.supabaseClient;
  const container = document.getElementById('recoverySection');
  if (!supabase || !container) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: completed } = await supabase
      .from('completed_workouts')
      .select('completed_at, actual_duration, heart_rate_avg, workout_plans(name, objective, activity_type)')
      .eq('user_id', session.user.id)
      .gte('completed_at', sevenDaysAgo.toISOString())
      .order('completed_at', { ascending: false })
      .limit(20);

    // Parametri FC del profilo: servono a pesare il recupero sull'intensità
    // reale. Se mancano, il calcolo resta quello a tempo fisso.
    let hr = null;
    if (window.HrModel) {
      hr = await window.HrModel.loadProfile(supabase, session.user.id);
    }

    const status = calcRecoveryStatus(completed || [], hr);
    renderRecovery(container, status, hr);

    // Striscia dei dati di recupero (variabilità cardiaca, sonno, FC a
    // riposo): si aggiunge DOPO renderRecovery, che riscrive tutto
    // l'innerHTML del contenitore e cancellerebbe qualsiasi cosa
    // inserita prima. Se migrations/007 non è stata eseguita si toglie
    // da sola e la sezione resta esattamente com'era.
    if (window.DailyMetrics) {
      window.DailyMetrics.render(container, session.user.id);
    }
  } catch (err) {
    console.warn('Recovery init error:', err);
    container.style.display = 'none';
  }
}

// Quanto una sessione pesa sul recupero, in base alla zona della sua FC
// MEDIA. Un fondo lento e un intervallato non possono bloccare le gambe per
// lo stesso numero di ore: era il limite principale del calcolo a tempo fisso.
//
// I coefficienti sono una scelta ragionevole, non una misura: moltiplicano le
// ore di recupero previste per ciascun muscolo.
const ZONE_LOAD = {
  1: 0.5,   // Recupero  — quasi nessun costo
  2: 0.7,   // Fondo     — aerobico leggero
  3: 1.0,   // Medio     — riferimento
  4: 1.4,   // Soglia    — impegnativo
  5: 1.8    // Massimale — molto costoso
};

// Sessione di riferimento: 45 minuti. La crescita è sotto-lineare (radice
// quadrata) perché il recupero non raddoppia raddoppiando la durata, e resta
// comunque limitata fra 0,6x e 1,6x per non produrre valori assurdi.
const REFERENCE_MINUTES = 45;

function durationFactor(minutes) {
  if (!(minutes > 0)) return 1;
  const f = Math.sqrt(minutes / REFERENCE_MINUTES);
  return Math.min(1.6, Math.max(0.6, f));
}

function sessionLoad(workout, hr) {
  const bpm = workout.heart_rate_avg;
  const zone = (hr && hr.maxHr && window.HrModel)
    ? window.HrModel.zoneOf(bpm, hr.maxHr, hr.restHr)
    : null;

  // Senza FC non possiamo pesare l'intensità: coefficiente neutro, e lo
  // dichiariamo nell'interfaccia invece di far finta di saperlo.
  const zoneFactor = zone ? ZONE_LOAD[zone] : 1;
  const factor = zoneFactor * durationFactor(workout.actual_duration);

  return {
    factor: Math.min(2, Math.max(0.4, factor)),
    zone: zone,
    hasHr: !!(bpm > 0)
  };
}

function calcRecoveryStatus(completedWorkouts, hr) {
  const now = Date.now();

  // muscolo → { ts, hours } dell'ultima sollecitazione, con le ore di
  // recupero già pesate sull'intensità di QUELLA sessione.
  const lastWorked = {};
  let withHr = 0, total = 0;

  completedWorkouts.forEach(w => {
    const ts = new Date(w.completed_at).getTime();
    const load = sessionLoad(w, hr);
    total++;
    if (load.hasHr && load.zone) withHr++;

    musclesFromWorkout(w).forEach(m => {
      if (!lastWorked[m] || ts > lastWorked[m].ts) {
        lastWorked[m] = { ts: ts, factor: load.factor, zone: load.zone };
      }
    });
  });

  const rows = MUSCLES.map(muscle => {
    const last = lastWorked[muscle.id];
    if (!last) {
      return Object.assign({}, muscle, { pct: 100, state: 'rested', hoursAgo: null, zone: null });
    }

    const needed  = muscle.recoveryHours * last.factor;
    const hoursAgo = (now - last.ts) / (1000 * 60 * 60);
    const pct = Math.min(100, Math.round((hoursAgo / needed) * 100));

    let state;
    if (pct >= 85)      state = 'recovered';
    else if (pct >= 40) state = 'partial';
    else                state = 'fatigued';

    return Object.assign({}, muscle, {
      pct: pct,
      state: state,
      hoursAgo: Math.round(hoursAgo),
      hoursNeeded: Math.round(needed),
      zone: last.zone
    });
  });

  // Serve all'interfaccia per dire su quanti allenamenti l'intensità è
  // stata considerata davvero.
  rows.coverage = { withHr: withHr, total: total };
  return rows;
}


function renderRecovery(container, status, hr) {
  const stateText = { recovered: 'Pronto', partial: 'In recupero', fatigued: 'Stanco', rested: 'Riposato' };

  const rows = status.map(m => {
    // Il titolo spiega COSA ha determinato quel valore: senza, la
    // percentuale sembra uscire dal nulla.
    const detail = m.state === 'rested'
      ? 'Nessun allenamento negli ultimi 7 giorni'
      : `Ultimo lavoro ${m.hoursAgo}h fa · recupero stimato ${m.hoursNeeded}h` +
        (m.zone ? ` · sessione in Z${m.zone}` : ' · intensità non disponibile');

    return `
    <div class="muscle-row ${m.state}" title="${detail}">
      <div class="muscle-row-dot"></div>
      <span class="muscle-row-name">${m.label}</span>
      <div class="muscle-row-bar-wrap">
        <div class="muscle-row-bar" style="width:${m.pct}%"></div>
      </div>
      <span class="muscle-row-pct">${m.state === 'rested' ? '—' : m.pct + '%'}</span>
      <span class="muscle-row-state">${stateText[m.state] || ''}</span>
    </div>`;
  }).join('');

  const cov = status.coverage || { withHr: 0, total: 0 };
  const intensityNote = cov.total === 0
    ? ''
    : (cov.withHr === cov.total
        ? 'Intensità considerata su tutti gli allenamenti del periodo.'
        : cov.withHr === 0
          ? 'Nessun allenamento del periodo ha la frequenza cardiaca: il calcolo usa solo tipo di attività e durata.'
          : `Intensità considerata su ${cov.withHr} allenamenti su ${cov.total}: per gli altri manca la frequenza cardiaca.`);

  const method = (hr && hr.maxHr)
    ? (hr.restHr
        ? `Zone calcolate sulla riserva cardiaca (FC max ${hr.maxHr}, riposo ${hr.restHr}).`
        : `Zone calcolate sulla percentuale della FC massima (${hr.maxHr}${hr.maxIsMeasured ? '' : ', stimata dall\'età'}). Aggiungi la FC a riposo nel <a href="/profile">profilo</a> per un calcolo più aderente.`)
    : 'FC massima non disponibile: aggiungi data di nascita o FC massima nel <a href="/profile">profilo</a> per pesare l\'intensità.';

  container.innerHTML = `
    <div class="recovery-estimate-banner">
      <i class="fas fa-circle-info" aria-hidden="true"></i>
      <div>
        <strong>È una stima, non una misura.</strong>
        Calcolata da tipo di attività, durata e intensità (dalla FC media).
        Il tuo orologio usa dati che qui non abbiamo: il tracciato cardiaco
        secondo per secondo, la variabilità cardiaca e il sonno. Usala come
        indicazione di massima, non al posto di come ti senti.
      </div>
    </div>

    <div class="recovery-list">${rows}</div>

    <div class="recovery-legend">
      <div class="recovery-legend-item"><div class="recovery-dot recovered"></div><span>Pronto (85%+)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot partial"></div><span>In recupero (40–84%)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot fatigued"></div><span>Stanco (&lt;40%)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot rested"></div><span>Non allenato (7gg)</span></div>
    </div>

    <details class="recovery-details">
      <summary><i class="fas fa-chevron-right" aria-hidden="true"></i> Come viene calcolato</summary>
      <div class="recovery-details-body">
        <p>Per ogni gruppo muscolare si parte da un tempo di recupero di
        riferimento (gambe 72h, petto/schiena/spalle 48h, braccia 36h, core 24h),
        poi lo si moltiplica per l'intensità e la durata dell'ultima sessione
        che lo ha coinvolto.</p>
        <table class="recovery-table">
          <tr><th>Zona della FC media</th><th>Effetto sul recupero</th></tr>
          <tr><td>Z1 — Recupero</td><td>×0,5</td></tr>
          <tr><td>Z2 — Fondo</td><td>×0,7</td></tr>
          <tr><td>Z3 — Medio</td><td>×1,0</td></tr>
          <tr><td>Z4 — Soglia</td><td>×1,4</td></tr>
          <tr><td>Z5 — Massimale</td><td>×1,8</td></tr>
        </table>
        <p>La durata pesa rispetto a una sessione di 45 minuti, con crescita
        sotto-lineare: due ore non richiedono il doppio del recupero di un'ora.</p>
        <p class="recovery-caveat"><strong>Cosa NON entra nel calcolo:</strong>
        il tracciato cardiaco continuo (abbiamo solo la media della sessione,
        quindi un intervallato Z2/Z5 risulta un Z3 costante), la variabilità
        cardiaca, la frequenza a riposo del mattino, il sonno e lo stress. Sono
        proprio i dati su cui si basa il recupero del tuo orologio.</p>
        <p class="recovery-caveat">${intensityNote} ${method}</p>
      </div>
    </details>`;
}

// ─── OFFLINE BANNER ───────────────────────────────────────────────────────────

function initOfflineBanner() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.id = 'offlineBanner';
  banner.innerHTML = '<i class="fas fa-wifi-slash"></i> <span id="offlineMsg">Sei offline — alcune funzioni non disponibili</span>';
  document.body.prepend(banner);

  function update() {
    if (navigator.onLine) {
      banner.classList.remove('visible');
    } else {
      banner.classList.add('visible');
    }
  }

  window.addEventListener('online',  () => {
    banner.classList.add('online');
    document.getElementById('offlineMsg').textContent = 'Connessione ripristinata!';
    banner.classList.add('visible');
    setTimeout(() => { banner.classList.remove('visible'); banner.classList.remove('online'); }, 2500);
  });
  window.addEventListener('offline', update);
  update();
}

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    })
    .catch(err => console.warn('SW registration failed:', err));
}

function showUpdateToast() {
  if (typeof window.showToast === 'function') {
    window.showToast('Aggiornamento disponibile — ricarica la pagina per applicarlo', 'info', 6000);
  }
}

// ─── PWA INSTALL PROMPT ───────────────────────────────────────────────────────

let deferredInstallPrompt = null;

function initPwaInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // Only show if not already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (sessionStorage.getItem('pwa-install-dismissed')) return;

    setTimeout(showInstallBar, 3000);
  });
}

function showInstallBar() {
  if (!deferredInstallPrompt) return;

  const bar = document.createElement('div');
  bar.className = 'pwa-install-bar';
  bar.id = 'pwaInstallBar';
  bar.innerHTML = `
    <div class="pwa-install-icon">📲</div>
    <div class="pwa-install-text">
      <strong>Installa Di Dio Training</strong>
      <small>Accesso rapido, funziona offline</small>
    </div>
    <div class="pwa-install-actions">
      <button class="btn btn-primary btn-sm" id="pwaInstallBtn" style="font-size:.8rem;padding:.4rem .9rem;">Installa</button>
      <button class="btn btn-secondary btn-sm" id="pwaDismissBtn" style="font-size:.8rem;padding:.4rem .6rem;">✕</button>
    </div>`;

  document.body.appendChild(bar);

  document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    bar.remove();
    if (outcome === 'accepted' && typeof window.showToast === 'function') {
      window.showToast('App installata con successo!', 'success');
    }
  });

  document.getElementById('pwaDismissBtn').addEventListener('click', () => {
    sessionStorage.setItem('pwa-install-dismissed', '1');
    bar.remove();
  });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initOfflineBanner();
  initPwaInstall();

  // Recovery needs supabase — retry if not yet available
  if (window.supabaseClient) {
    initRecovery();
  } else {
    const t = setInterval(() => {
      if (window.supabaseClient) { clearInterval(t); initRecovery(); }
    }, 200);
    setTimeout(() => clearInterval(t), 5000);
  }
});

})();
