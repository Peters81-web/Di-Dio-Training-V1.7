/**
 * fase1-features.js
 * Streak, Weekly Calendar, Workout Timer
 */

(function() {
'use strict';

// ─── STREAK ───────────────────────────────────────────────────────────────────

async function initStreak() {
    const supabase = window.supabaseClient;
    if (!supabase) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: completed } = await supabase
            .from('completed_workouts')
            .select('completed_at')
            .eq('user_id', session.user.id)
            .gte('completed_at', thirtyDaysAgo.toISOString())
            .order('completed_at', { ascending: false });

        const streak = calcStreak(completed || []);
        renderStreak(streak);
        renderWeeklyCalendar(completed || []);
    } catch (err) {
        console.warn('Streak init error:', err);
    }
}

function calcStreak(completedWorkouts) {
    if (!completedWorkouts.length) return 0;

    const days = new Set(
        completedWorkouts.map(w => w.completed_at.slice(0, 10))
    );

    let streak = 0;
    const today = new Date();

    for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);

        if (days.has(key)) {
            streak++;
        } else if (i > 0) {
            // Gap found — stop (allow today to be empty: check tomorrow only if today has one)
            break;
        }
    }

    return streak;
}

function streakBadge(streak) {
    if (streak >= 30) return '🏆';
    if (streak >= 21) return '💎';
    if (streak >= 14) return '🔥';
    if (streak >= 7)  return '⭐';
    if (streak >= 3)  return '💪';
    return '';
}

function renderStreak(streak) {
    const banner = document.getElementById('streakBanner');
    const count  = document.getElementById('streakCount');
    const title  = document.getElementById('streakTitle');
    const sub    = document.getElementById('streakSub');
    const badge  = document.getElementById('streakBadge');

    if (!banner) return;

    count.textContent = streak;

    if (streak === 0) {
        title.textContent = 'Inizia oggi!';
        sub.textContent   = 'Completa un allenamento per avviare la tua streak';
    } else if (streak === 1) {
        title.textContent = 'Primo giorno — ottimo inizio!';
        sub.textContent   = 'Continua domani per costruire la tua streak';
    } else {
        title.textContent = `${streak} giorni consecutivi!`;
        sub.textContent   = streak >= 7
            ? 'Sei inarrestabile — continua così!'
            : 'Stai costruendo una grande abitudine!';
    }

    badge.textContent = streakBadge(streak);
    banner.style.display = 'flex';
}

// ─── WEEKLY CALENDAR ──────────────────────────────────────────────────────────

function renderWeeklyCalendar(completedWorkouts) {
    const container = document.getElementById('weekly-calendar');
    if (!container) return;

    const completedDays = new Set(
        completedWorkouts.map(w => w.completed_at.slice(0, 10))
    );

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);

    // Build Monday-starting week
    const startOfWeek = new Date(today);
    const dow = today.getDay(); // 0=Sun
    const diff = dow === 0 ? -6 : 1 - dow;
    startOfWeek.setDate(today.getDate() + diff);

    let daysHtml = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const name = dayNames[d.getDay()];
        const num  = d.getDate();

        let cls = 'wc-day';
        let icon = '';

        if (key === todayKey) cls += ' today';
        if (completedDays.has(key)) {
            cls += ' completed';
            icon = '<i class="fas fa-check"></i>';
        } else if (d > today) {
            // future day — plain
        } else if (key !== todayKey) {
            cls += ' rest';
        }

        daysHtml += `
            <div class="${cls}">
                <span class="wc-day-name">${name}</span>
                <span class="wc-day-num">${num}</span>
                <span class="wc-day-icon">${icon}</span>
            </div>`;
    }

    container.innerHTML = `
        ${daysHtml}
        <div class="wc-legend" style="grid-column:1/-1;margin-top:.25rem;">
            <div class="wc-legend-item">
                <div class="wc-dot completed"></div><span>Completato</span>
            </div>
            <div class="wc-legend-item">
                <div class="wc-dot today"></div><span>Oggi</span>
            </div>
        </div>`;
}

// ─── WORKOUT TIMER ────────────────────────────────────────────────────────────

const PHASES = {
    warmup:   { label: 'Riscaldamento', target: 10 },
    main:     { label: 'Principale',    target: 40 },
    cooldown: { label: 'Defaticamento', target: 10 },
};

let timerState = {
    phase:     'warmup',
    running:   false,
    elapsed:   0,          // seconds in current phase
    totalSecs: 0,          // total elapsed seconds across all phases
    interval:  null,
};

function initTimer() {
    const fab      = document.getElementById('timerFab');
    const panel    = document.getElementById('timerPanel');
    const closeBtn = document.getElementById('timerClose');
    const startBtn = document.getElementById('timerStartStop');
    const resetBtn = document.getElementById('timerReset');

    if (!fab) return;

    fab.addEventListener('click', () => {
        const visible = panel.style.display !== 'none';
        panel.style.display = visible ? 'none' : 'block';
        if (!visible) panel.style.animation = 'timerSlideUp .25s ease-out';
    });

    closeBtn?.addEventListener('click', () => {
        panel.style.display = 'none';
    });

    document.querySelectorAll('.timer-phase[data-phase]').forEach(btn => {
        btn.addEventListener('click', () => {
            pauseTimer();
            switchPhase(btn.dataset.phase);
        });
    });

    startBtn?.addEventListener('click', () => {
        if (timerState.running) pauseTimer(); else startTimer();
    });

    resetBtn?.addEventListener('click', resetTimer);
}

function startTimer() {
    timerState.running = true;
    document.getElementById('timerStartStop').innerHTML =
        '<i class="fas fa-pause"></i> Pausa';

    timerState.interval = setInterval(() => {
        timerState.elapsed++;
        timerState.totalSecs++;
        updateTimerUI();
    }, 1000);
}

function pauseTimer() {
    timerState.running = false;
    clearInterval(timerState.interval);
    timerState.interval = null;

    const btn = document.getElementById('timerStartStop');
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i> Start';
}

function resetTimer() {
    pauseTimer();
    timerState.elapsed = 0;
    timerState.totalSecs = 0;
    updateTimerUI();
}

function switchPhase(phase) {
    timerState.phase   = phase;
    timerState.elapsed = 0;

    document.querySelectorAll('.timer-phase[data-phase]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.phase === phase);
    });

    const label = document.getElementById('timerPhaseLabel');
    if (label) label.textContent = PHASES[phase]?.label || phase;

    updateTimerUI();
}

function updateTimerUI() {
    const display  = document.getElementById('timerDisplay');
    const fill     = document.getElementById('timerProgressFill');
    const elapsed  = document.getElementById('timerElapsed');

    if (display) {
        const m = Math.floor(timerState.elapsed / 60);
        const s = timerState.elapsed % 60;
        display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    if (fill) {
        const target = (PHASES[timerState.phase]?.target || 10) * 60;
        const pct    = Math.min(100, (timerState.elapsed / target) * 100);
        fill.style.width = pct + '%';
    }

    if (elapsed) {
        const totalMin = Math.floor(timerState.totalSecs / 60);
        elapsed.textContent = totalMin < 1
            ? `${timerState.totalSecs}s`
            : `${totalMin}m`;
    }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTimer();

    // Streak & calendar need supabase — defer until after supabase-config loads
    if (window.supabaseClient) {
        initStreak();
    } else {
        // supabase-config.js may load async; retry briefly
        const t = setInterval(() => {
            if (window.supabaseClient) {
                clearInterval(t);
                initStreak();
            }
        }, 200);
        setTimeout(() => clearInterval(t), 5000);
    }
});

})();
