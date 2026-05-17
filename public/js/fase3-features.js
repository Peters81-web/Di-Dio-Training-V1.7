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
      .select('completed_at, workout_plans(name, objective, activity_type)')
      .eq('user_id', session.user.id)
      .gte('completed_at', sevenDaysAgo.toISOString())
      .order('completed_at', { ascending: false })
      .limit(20);

    const status = calcRecoveryStatus(completed || []);
    renderRecovery(container, status);
  } catch (err) {
    console.warn('Recovery init error:', err);
    container.style.display = 'none';
  }
}

function calcRecoveryStatus(completedWorkouts) {
  const now = Date.now();

  // Find last workout time for each muscle
  const lastWorked = {}; // muscle → timestamp

  completedWorkouts.forEach(w => {
    const ts = new Date(w.completed_at).getTime();
    const muscles = musclesFromWorkout(w);
    muscles.forEach(m => {
      if (!lastWorked[m] || ts > lastWorked[m]) lastWorked[m] = ts;
    });
  });

  return MUSCLES.map(muscle => {
    const last = lastWorked[muscle.id];
    if (!last) {
      return { ...muscle, pct: 100, state: 'rested', hoursAgo: null };
    }

    const hoursAgo = (now - last) / (1000 * 60 * 60);
    const pct = Math.min(100, Math.round((hoursAgo / muscle.recoveryHours) * 100));

    let state;
    if (pct >= 85)      state = 'recovered';
    else if (pct >= 40) state = 'partial';
    else                state = 'fatigued';

    return { ...muscle, pct, state, hoursAgo: Math.round(hoursAgo) };
  });
}

function stateLabel(state, hoursAgo) {
  if (state === 'rested') return 'Riposato';
  if (state === 'recovered') return 'Pronto';
  if (state === 'partial') return `~${Math.round((100 - arguments[1]) / 4)}h`;
  return 'Stanco';
}

function renderRecovery(container, status) {
  const stateText = { recovered: 'Pronto', partial: 'In recupero', fatigued: 'Stanco', rested: 'Riposato' };

  const rows = status.map(m => `
    <div class="muscle-row ${m.state}">
      <div class="muscle-row-dot"></div>
      <span class="muscle-row-name">${m.label}</span>
      <div class="muscle-row-bar-wrap">
        <div class="muscle-row-bar" style="width:${m.pct}%"></div>
      </div>
      <span class="muscle-row-pct">${m.state === 'rested' ? '—' : m.pct + '%'}</span>
      <span class="muscle-row-state">${stateText[m.state] || ''}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="recovery-list">${rows}</div>
    <div class="recovery-legend">
      <div class="recovery-legend-item"><div class="recovery-dot recovered"></div><span>Pronto (85%+)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot partial"></div><span>In recupero (40–84%)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot fatigued"></div><span>Stanco (&lt;40%)</span></div>
      <div class="recovery-legend-item"><div class="recovery-dot rested"></div><span>Non allenato (7gg)</span></div>
    </div>`;
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
