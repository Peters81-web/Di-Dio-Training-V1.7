/**
 * exercise-log.js — Log di serie, ripetizioni e carico (palestra)
 *
 * Registra le serie svolte in una sessione di palestra e mostra il
 * sovraccarico progressivo: "panca piana 60 → 65 kg in 4 settimane".
 * Prima di questo modulo serie e ripetizioni esistevano solo come testo
 * nel prompt dell'AI, quindi non erano confrontabili nel tempo.
 *
 * Richiede migrations/006-exercise-sets.sql.
 *
 * SE LA MIGRAZIONE NON È STATA ESEGUITA il modulo si spegne da solo:
 * niente sezione nel dettaglio, niente errori a schermo, un solo avviso
 * in console. Il resto della dashboard non cambia. Le migrazioni si
 * eseguono a mano, quindi esiste sempre una finestra in cui il codice
 * nuovo gira su un database vecchio: in quella finestra l'app deve
 * degradare, non rompersi.
 *
 * Self-contained: inietta il proprio modal e il proprio CSS, non dipende
 * dai fogli di stile della pagina. Espone window.ExerciseLog.
 */
(function () {
  'use strict';

  var TABLE = 'exercise_sets';

  // ── Riconoscimento "tabella inesistente" ──────────────────────
  //
  // Le altre migrazioni aggiungevano COLONNE, e isMissingColumnError()
  // bastava. Qui manca l'intera TABELLA, che è un errore diverso:
  //   PostgREST → PGRST205  "Could not find the table 'public...'"
  //   Postgres  → 42P01     "relation ... does not exist"
  // isMissingColumnError() non lo riconoscerebbe, e l'assenza della
  // migrazione si presenterebbe all'utente come un errore vero.
  //
  // Come per le colonne: SOLO questo errore attiva lo spegnimento.
  // Permessi, rete e vincoli violati devono restare visibili, perché
  // mascherarli nasconde guasti veri (una policy RLS sbagliata
  // sembrerebbe "migrazione non eseguita" e non la si troverebbe più).
  function isMissingTableError(err) {
    if (!err) return false;
    if (err.code === 'PGRST205' || err.code === '42P01') return true;
    var m = String(err.message || '').toLowerCase();
    if (m.indexOf('could not find the table') !== -1) return true;
    return m.indexOf('relation') !== -1 && m.indexOf('does not exist') !== -1;
  }

  // Stato della tabella: null = non ancora saputo, true/false = accertato.
  // Memorizzato per non ripetere la stessa query fallita a ogni apertura
  // del dettaglio.
  var tableAvailable = null;

  function markAvailability(err) {
    if (err && isMissingTableError(err)) {
      if (tableAvailable !== false) {
        console.warn('Log palestra: tabella "' + TABLE + '" non presente, ' +
                     'eseguire migrations/006-exercise-sets.sql. ' +
                     'La sezione resta nascosta.');
      }
      tableAvailable = false;
      return false;
    }
    if (!err) tableAvailable = true;
    return true;
  }

  function sc() { return window.supabaseClient; }

  function esc(s) {
    return (typeof window.escapeHtml === 'function')
      ? window.escapeHtml(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
                    '"': '&quot;', "'": '&#39;' })[c];
        });
  }

  function toast(msg, kind, ms) {
    if (window.showToast) window.showToast(msg, kind || 'info', ms);
  }

  // Stessa normalizzazione della colonna generata exercise_key in
  // migrations/006. Serve solo a raggruppare lato client PRIMA che il
  // database risponda: la verità resta quella calcolata da Postgres.
  function keyOf(name) {
    return String(name || '').trim().toLowerCase();
  }

  // ── Lettura ───────────────────────────────────────────────────

  /**
   * Serie di una singola scheda, ordinate per esercizio e numero.
   * Ritorna [] anche in caso di errore: il log è una sezione accessoria
   * del dettaglio, non deve impedirne l'apertura.
   */
  function loadForWorkout(userId, workoutId) {
    if (tableAvailable === false) return Promise.resolve([]);

    return sc().from(TABLE)
      .select('id, exercise_name, exercise_key, set_number, reps, weight_kg, notes, performed_at')
      .eq('user_id', userId)
      .eq('workout_id', workoutId)
      .order('exercise_key', { ascending: true })
      .order('set_number', { ascending: true })
      .then(function (r) {
        if (r.error) {
          markAvailability(r.error);
          if (!isMissingTableError(r.error)) {
            console.warn('Log palestra: lettura non riuscita.', r.error);
          }
          return [];
        }
        markAvailability(null);
        return r.data || [];
      })
      .catch(function (e) {
        console.warn('Log palestra: lettura non riuscita.', e);
        return [];
      });
  }

  /**
   * Storico di un esercizio, tutte le sessioni, ordine cronologico.
   * Serve alla progressione.
   */
  function loadHistory(userId, exerciseKey) {
    if (tableAvailable === false) return Promise.resolve([]);

    return sc().from(TABLE)
      .select('workout_id, exercise_name, set_number, reps, weight_kg, performed_at')
      .eq('user_id', userId)
      .eq('exercise_key', exerciseKey)
      .order('performed_at', { ascending: true })
      .then(function (r) {
        if (r.error) { markAvailability(r.error); return []; }
        markAvailability(null);
        return r.data || [];
      })
      .catch(function () { return []; });
  }

  /** Nomi già usati, per il completamento automatico nell'editor. */
  function loadKnownExercises(userId) {
    if (tableAvailable === false) return Promise.resolve([]);

    return sc().from(TABLE)
      .select('exercise_name')
      .eq('user_id', userId)
      .order('performed_at', { ascending: false })
      .limit(200)
      .then(function (r) {
        if (r.error) { markAvailability(r.error); return []; }
        markAvailability(null);
        var seen = {}, out = [];
        (r.data || []).forEach(function (row) {
          var k = keyOf(row.exercise_name);
          if (k && !seen[k]) { seen[k] = 1; out.push(row.exercise_name.trim()); }
        });
        return out;
      })
      .catch(function () { return []; });
  }

  // ── Aggregazione ──────────────────────────────────────────────

  /** Raggruppa per esercizio conservando l'ordine di apparizione. */
  function groupByExercise(rows) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      var k = r.exercise_key || keyOf(r.exercise_name);
      if (!map[k]) { map[k] = { key: k, name: r.exercise_name, sets: [] }; order.push(k); }
      map[k].sets.push(r);
    });
    return order.map(function (k) { return map[k]; });
  }

  /**
   * Riassunto di una lista di serie.
   * Il volume (serie x ripetizioni x carico) è la misura più usata del
   * lavoro svolto: due sessioni con lo stesso carico massimo ma volume
   * diverso non sono lo stesso allenamento. Le serie senza carico o
   * senza ripetizioni non contribuiscono al volume — non vale zero, è
   * semplicemente un dato che non abbiamo.
   */
  function summarize(sets) {
    var maxW = null, volume = 0, volumeComplete = true, totalReps = 0;
    sets.forEach(function (s) {
      var w = (typeof s.weight_kg === 'number') ? s.weight_kg : parseFloat(s.weight_kg);
      var r = (typeof s.reps === 'number') ? s.reps : parseInt(s.reps, 10);
      if (!isNaN(w) && (maxW === null || w > maxW)) maxW = w;
      if (!isNaN(r)) totalReps += r;
      if (!isNaN(w) && !isNaN(r)) volume += w * r;
      else volumeComplete = false;
    });
    return {
      nSets: sets.length,
      maxWeight: maxW,
      totalReps: totalReps,
      volume: volume,
      volumeComplete: volumeComplete
    };
  }

  /**
   * Progressione di un esercizio: una voce per sessione, in ordine
   * cronologico, con carico massimo e volume.
   */
  function progressionFromHistory(rows) {
    var bySession = {}, order = [];
    rows.forEach(function (r) {
      var k = r.workout_id;
      if (!bySession[k]) {
        bySession[k] = { workoutId: k, performedAt: r.performed_at, sets: [] };
        order.push(k);
      }
      bySession[k].sets.push(r);
    });
    return order.map(function (k) {
      var s = bySession[k];
      var sum = summarize(s.sets);
      return {
        workoutId: s.workoutId,
        performedAt: s.performedAt,
        maxWeight: sum.maxWeight,
        volume: sum.volume,
        volumeComplete: sum.volumeComplete,
        nSets: sum.nSets
      };
    });
  }

  // ── Scrittura ─────────────────────────────────────────────────

  /**
   * Sostituisce le serie di UN esercizio in UNA scheda.
   *
   * Cancella e reinserisce invece di fare un upsert: exercise_key è una
   * colonna generata, e un upsert dovrebbe puntare a un vincolo che la
   * contiene, cosa che PostgREST non gestisce in modo affidabile.
   *
   * Se il reinserimento fallisce le righe precedenti vengono rimesse a
   * posto (rollback best-effort, come in tcx-import.js quando il record
   * di completamento fallisce dopo la creazione della scheda): senza,
   * un errore di rete a metà operazione cancellerebbe uno storico che
   * l'utente non può ricostruire.
   */
  function replaceExercise(userId, workoutId, exerciseName, rows, performedAt) {
    var key = keyOf(exerciseName);
    var client = sc();

    var payload = rows.map(function (r, i) {
      return {
        user_id:       userId,
        workout_id:    workoutId,
        exercise_name: exerciseName.trim(),
        set_number:    i + 1,
        reps:          r.reps,
        weight_kg:     r.weight,
        performed_at:  performedAt
      };
    });

    // Le righe attuali, per poterle rimettere se il reinserimento fallisce.
    return client.from(TABLE)
      .select('exercise_name, set_number, reps, weight_kg, notes, performed_at')
      .eq('user_id', userId).eq('workout_id', workoutId).eq('exercise_key', key)
      .then(function (prev) {
        var previous = (prev && !prev.error && prev.data) ? prev.data : [];

        return client.from(TABLE).delete()
          .eq('user_id', userId).eq('workout_id', workoutId).eq('exercise_key', key)
          .then(function (del) {
            if (del.error) throw del.error;
            if (!payload.length) return { ok: true };

            return client.from(TABLE).insert(payload).then(function (ins) {
              if (!ins.error) return { ok: true };

              // Reinserimento fallito: rimetto ciò che c'era prima.
              if (previous.length) {
                var restore = previous.map(function (p) {
                  return {
                    user_id: userId, workout_id: workoutId,
                    exercise_name: p.exercise_name, set_number: p.set_number,
                    reps: p.reps, weight_kg: p.weight_kg,
                    notes: p.notes, performed_at: p.performed_at
                  };
                });
                return client.from(TABLE).insert(restore).then(function () {
                  throw ins.error;
                }, function () { throw ins.error; });
              }
              throw ins.error;
            });
          });
      });
  }

  function deleteExercise(userId, workoutId, exerciseName) {
    return sc().from(TABLE).delete()
      .eq('user_id', userId)
      .eq('workout_id', workoutId)
      .eq('exercise_key', keyOf(exerciseName));
  }

  // ── Formattazione ─────────────────────────────────────────────

  function fmtWeight(w) {
    if (w === null || w === undefined || w === '') return null;
    var n = (typeof w === 'number') ? w : parseFloat(w);
    if (isNaN(n)) return null;
    if (n === 0) return 'corpo libero';
    return (Math.round(n * 10) / 10).toString().replace('.', ',') + ' kg';
  }

  function fmtNum(n) {
    return Math.round(n).toLocaleString('it-IT');
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  /** "60 → 65 kg" con lo scarto, oppure null se non c'è confronto. */
  function deltaLabel(progression) {
    var withWeight = progression.filter(function (p) { return p.maxWeight !== null; });
    if (withWeight.length < 2) return null;

    var first = withWeight[0], last = withWeight[withWeight.length - 1];
    var diff  = last.maxWeight - first.maxWeight;
    var days  = Math.round((new Date(last.performedAt) - new Date(first.performedAt)) / 86400000);

    var period;
    if (days >= 14)     period = 'in ' + Math.round(days / 7) + ' settimane';
    else if (days >= 1) period = 'in ' + days + (days === 1 ? ' giorno' : ' giorni');
    else                period = null;

    return {
      from: first.maxWeight,
      to: last.maxWeight,
      diff: diff,
      period: period,
      sessions: withWeight.length
    };
  }

  // ── Stile (self-contained) ────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('xlog-styles')) return;
    var s = document.createElement('style');
    s.id = 'xlog-styles';
    s.textContent = [
      '.xlog-section{margin-top:18px;border-top:1px solid #e5e7eb;padding-top:16px}',
      '.xlog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}',
      '.xlog-head h4{margin:0;font-size:.95rem;font-weight:700;color:#1a1a2e;display:flex;align-items:center;gap:8px}',
      '.xlog-head h4 i{color:#4361ee}',
      '.xlog-empty{color:#6b7280;font-size:.87rem;margin:0;padding:14px;background:#f9fafb;border-radius:10px;text-align:center}',
      '.xlog-ex{background:#f9fafb;border-radius:12px;padding:12px 14px;margin-bottom:10px}',
      '.xlog-ex-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.xlog-ex-name{font-weight:700;color:#1a1a2e;font-size:.92rem}',
      '.xlog-ex-sum{font-size:.78rem;color:#6b7280}',
      '.xlog-sets{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}',
      '.xlog-set{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:4px 9px;font-size:.8rem;color:#374151;white-space:nowrap}',
      '.xlog-set b{color:#1a1a2e;font-weight:700}',
      '.xlog-set--top{border-color:#c7d2fe;background:#eef2ff}',
      '.xlog-prog{margin-top:9px;font-size:.8rem;display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.xlog-prog i{font-size:.75rem}',
      '.xlog-prog--up{color:#15803d}',
      '.xlog-prog--flat{color:#6b7280}',
      '.xlog-prog--down{color:#b45309}',
      '.xlog-prog-note{color:#9ca3af;font-size:.74rem}',
      '.xlog-spark{display:flex;align-items:flex-end;gap:3px;height:26px;margin-top:8px}',
      '.xlog-spark-bar{width:9px;border-radius:2px 2px 0 0;background:#c7d2fe;min-height:3px}',
      '.xlog-spark-bar.is-last{background:#4361ee}',
      '.xlog-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '.xlog-btn{padding:8px 14px;border-radius:9px;font-size:.85rem;font-weight:600;cursor:pointer;border:1.5px solid transparent;font-family:inherit}',
      '.xlog-btn--sec{background:#fff;border-color:#e5e7eb;color:#4b5563}',
      '.xlog-btn--sec:hover{background:#f3f4f6}',
      '.xlog-btn--pri{background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff}',
      '.xlog-btn--pri:hover{opacity:.92}',
      '.xlog-btn--pri:disabled{opacity:.6;cursor:not-allowed}',
      '.xlog-btn--danger{background:#fff;border-color:#fecaca;color:#b91c1c}',
      '.xlog-btn--danger:hover{background:#fef2f2}',
      '.xlog-btn--mini{padding:5px 10px;font-size:.78rem}',
      /* editor */
      '.xlog-ov{position:fixed;inset:0;z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .2s}',
      '.xlog-ov.is-open{opacity:1}',
      '.xlog-dlg{background:#fff;border-radius:18px;max-width:480px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.35);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}',
      '.xlog-ov.is-open .xlog-dlg{transform:none}',
      '.xlog-dhead{display:flex;align-items:center;gap:12px;padding:18px 22px;background:linear-gradient(135deg,#1e3a5f,#4361ee);color:#fff;flex-shrink:0}',
      '.xlog-dhead i{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex-shrink:0}',
      '.xlog-dhead h3{margin:0;font-size:1.02rem;font-weight:700}',
      '.xlog-dhead small{opacity:.85;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}',
      '.xlog-dbody{padding:20px 22px;overflow-y:auto;flex:1}',
      '.xlog-field{margin-bottom:16px}',
      '.xlog-label{display:block;font-size:.78rem;font-weight:600;color:#4b5563;margin-bottom:6px}',
      '.xlog-input{width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:.92rem;font-family:inherit;color:#1a1a2e;background:#fff}',
      '.xlog-input:focus{outline:none;border-color:#4361ee;box-shadow:0 0 0 3px rgba(67,97,238,.12)}',
      '.xlog-rows{display:flex;flex-direction:column;gap:8px}',
      '.xlog-row{display:grid;grid-template-columns:38px 1fr 1fr 34px;gap:8px;align-items:center}',
      '.xlog-row-n{font-size:.8rem;color:#9ca3af;font-weight:700;text-align:center}',
      '.xlog-row .xlog-input{padding:8px 10px;font-size:.88rem}',
      '.xlog-row-del{background:none;border:none;color:#d1d5db;cursor:pointer;font-size:.95rem;padding:4px;border-radius:6px}',
      '.xlog-row-del:hover{color:#b91c1c;background:#fef2f2}',
      '.xlog-colhead{display:grid;grid-template-columns:38px 1fr 1fr 34px;gap:8px;margin-bottom:6px}',
      '.xlog-colhead span{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af;font-weight:600;text-align:center}',
      '.xlog-hint{font-size:.76rem;color:#9ca3af;margin-top:8px}',
      '.xlog-dfoot{display:flex;justify-content:space-between;gap:10px;padding:14px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;flex-shrink:0;flex-wrap:wrap}',
      '.xlog-dfoot-right{display:flex;gap:10px;margin-left:auto}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Sezione nel dettaglio allenamento ─────────────────────────

  function isGymWorkout(workout) {
    if (!workout) return false;
    return (workout.activity_type || '') === 'gym';
  }

  /**
   * Segnaposto sincrono: viene inserito nell'HTML del modal mentre
   * questo si costruisce, e riempito dopo. Il dettaglio non deve
   * aspettare il database per aprirsi — stessa logica per cui la mappa
   * viene disegnata dopo che il modal è nel DOM.
   */
  function placeholder(workout) {
    if (!isGymWorkout(workout)) return '';
    return '<div class="xlog-section" data-xlog-for="' + esc(workout.id) + '">' +
             '<div class="xlog-head"><h4>' +
               '<i class="fas fa-dumbbell" aria-hidden="true"></i> Serie svolte' +
             '</h4></div>' +
             '<p class="xlog-empty">Caricamento…</p>' +
           '</div>';
  }

  function sparkline(progression) {
    var pts = progression.filter(function (p) { return p.maxWeight !== null; });
    if (pts.length < 2) return '';
    var max = Math.max.apply(null, pts.map(function (p) { return p.maxWeight; }));
    if (!(max > 0)) return '';
    var bars = pts.slice(-12).map(function (p, i, arr) {
      var h = Math.max(3, Math.round((p.maxWeight / max) * 26));
      var cls = (i === arr.length - 1) ? ' is-last' : '';
      return '<div class="xlog-spark-bar' + cls + '" style="height:' + h + 'px" ' +
             'title="' + esc(fmtDate(p.performedAt)) + ': ' + esc(fmtWeight(p.maxWeight) || '') + '"></div>';
    }).join('');
    return '<div class="xlog-spark" aria-hidden="true">' + bars + '</div>';
  }

  function renderExercise(group, progression) {
    var sum = summarize(group.sets);
    var parts = [];
    parts.push(sum.nSets + ' serie');
    if (sum.totalReps > 0) parts.push(sum.totalReps + ' rip. totali');
    if (sum.volume > 0) {
      parts.push('volume ' + fmtNum(sum.volume) + ' kg' +
                 (sum.volumeComplete ? '' : ' (parziale)'));
    }

    var setChips = group.sets.map(function (s) {
      var w = fmtWeight(s.weight_kg);
      var isTop = (sum.maxWeight !== null && parseFloat(s.weight_kg) === sum.maxWeight);
      var body = (s.reps ? '<b>' + esc(s.reps) + '</b> rip.' : '<b>—</b>');
      if (w) body += ' · ' + esc(w);
      return '<span class="xlog-set' + (isTop && sum.maxWeight > 0 ? ' xlog-set--top' : '') + '">' +
               body + '</span>';
    }).join('');

    var progHtml = '';
    var d = deltaLabel(progression);
    if (d) {
      var cls  = d.diff > 0 ? 'up' : (d.diff < 0 ? 'down' : 'flat');
      var icon = d.diff > 0 ? 'fa-arrow-trend-up'
               : (d.diff < 0 ? 'fa-arrow-trend-down' : 'fa-equals');
      var txt;
      if (d.diff === 0) {
        txt = 'stabile a ' + esc(fmtWeight(d.to) || '') +
              (d.period ? ' ' + esc(d.period) : '');
      } else {
        txt = esc(fmtWeight(d.from) || '') + ' → ' + esc(fmtWeight(d.to) || '') +
              (d.period ? ' ' + esc(d.period) : '');
      }
      progHtml = '<div class="xlog-prog xlog-prog--' + cls + '">' +
                   '<i class="fas ' + icon + '" aria-hidden="true"></i>' +
                   '<span>' + txt + '</span>' +
                   '<span class="xlog-prog-note">su ' + d.sessions + ' sessioni</span>' +
                 '</div>' + sparkline(progression);
    } else if (progression.length === 1) {
      progHtml = '<div class="xlog-prog xlog-prog--flat">' +
                   '<span class="xlog-prog-note">Prima sessione registrata: ' +
                   'la progressione compare dalla seconda.</span></div>';
    }

    return '<div class="xlog-ex">' +
             '<div class="xlog-ex-top">' +
               '<span class="xlog-ex-name">' + esc(group.name) + '</span>' +
               '<span class="xlog-ex-sum">' + esc(parts.join(' · ')) + '</span>' +
             '</div>' +
             '<div class="xlog-sets">' + setChips + '</div>' +
             progHtml +
             '<div class="xlog-actions">' +
               '<button type="button" class="xlog-btn xlog-btn--sec xlog-btn--mini" ' +
                 'data-xlog-edit="' + esc(group.name) + '">' +
                 '<i class="fas fa-pen" aria-hidden="true"></i> Modifica' +
               '</button>' +
             '</div>' +
           '</div>';
  }

  /**
   * Riempie il segnaposto. Chiamata dopo che il modal è nel DOM.
   * Se la tabella non c'è, la sezione viene rimossa del tutto: meglio
   * niente che un riquadro vuoto che sembra un guasto.
   */
  function hydrate(root, workout, userId, onChanged) {
    ensureStyles();
    var host = root.querySelector('[data-xlog-for="' + workout.id + '"]');
    if (!host) return;

    // currentUser è locale alla IIFE di dashboard.js, non un global:
    // l'id arriva come parametro invece di essere pescato da window.
    userId = userId || workout.user_id || null;
    if (!userId) { host.remove(); return; }

    loadForWorkout(userId, workout.id).then(function (rows) {
      if (tableAvailable === false) { host.remove(); return; }

      var groups = groupByExercise(rows);

      // Storico di ogni esercizio, per la progressione. In parallelo:
      // sono poche query e servono tutte prima di disegnare.
      return Promise.all(groups.map(function (g) {
        return loadHistory(userId, g.key);
      })).then(function (histories) {
        renderSection(host, workout, groups, histories, userId, onChanged);
      });
    }).catch(function (e) {
      console.warn('Log palestra: rendering non riuscito.', e);
      if (host) host.remove();
    });
  }

  function renderSection(host, workout, groups, histories, userId, onChanged) {
    var body;
    if (!groups.length) {
      body = '<p class="xlog-empty">Nessuna serie registrata per questa sessione. ' +
             'Registrale per vedere il sovraccarico progressivo nel tempo.</p>';
    } else {
      body = groups.map(function (g, i) {
        return renderExercise(g, progressionFromHistory(histories[i] || []));
      }).join('');
    }

    host.innerHTML =
      '<div class="xlog-head">' +
        '<h4><i class="fas fa-dumbbell" aria-hidden="true"></i> Serie svolte</h4>' +
        '<button type="button" class="xlog-btn xlog-btn--pri xlog-btn--mini" data-xlog-add>' +
          '<i class="fas fa-plus" aria-hidden="true"></i> Aggiungi esercizio' +
        '</button>' +
      '</div>' + body;

    function refresh() {
      // host conserva l'attributo data-xlog-for (renderSection ne
      // riscrive solo il contenuto), quindi hydrate lo ritrova.
      hydrate(host.parentNode || document, workout, userId, onChanged);
      if (typeof onChanged === 'function') onChanged();
    }

    var addBtn = host.querySelector('[data-xlog-add]');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openEditor(workout, '', userId, refresh);
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-xlog-edit]'), function (b) {
      b.addEventListener('click', function () {
        openEditor(workout, b.getAttribute('data-xlog-edit'), userId, refresh);
      });
    });
  }

  // ── Editor ────────────────────────────────────────────────────

  /**
   * Data da attribuire alle serie: quella dell'allenamento, non quella
   * di oggi. Registrando ieri sera l'allenamento di lunedì, la
   * progressione deve collocarlo a lunedì — è lo stesso errore che
   * metteva le attività importate nel mese sbagliato.
   */
  function performedAtFor(workout) {
    if (workout.completed_at) return new Date(workout.completed_at).toISOString();
    if (workout.scheduled_date) {
      var d = new Date(workout.scheduled_date + 'T12:00:00');
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    if (workout.created_at) return new Date(workout.created_at).toISOString();
    return new Date().toISOString();
  }

  function rowHtml(n, reps, weight) {
    return '<div class="xlog-row" data-xlog-row>' +
             '<span class="xlog-row-n">' + n + '</span>' +
             '<input class="xlog-input" type="number" inputmode="numeric" min="1" max="1000" ' +
               'placeholder="rip." data-xlog-reps value="' + (reps == null ? '' : esc(reps)) + '">' +
             '<input class="xlog-input" type="number" inputmode="decimal" min="0" max="500" step="0.5" ' +
               'placeholder="kg" data-xlog-weight value="' + (weight == null ? '' : esc(weight)) + '">' +
             '<button type="button" class="xlog-row-del" data-xlog-delrow aria-label="Rimuovi serie">' +
               '<i class="fas fa-times" aria-hidden="true"></i>' +
             '</button>' +
           '</div>';
  }

  function openEditor(workout, exerciseName, userId, onDone) {
    ensureStyles();

    var isNew = !exerciseName;
    var ov = document.createElement('div');
    ov.className = 'xlog-ov';
    ov.innerHTML =
      '<div class="xlog-dlg" role="dialog" aria-modal="true" aria-label="Registra serie">' +
        '<div class="xlog-dhead">' +
          '<i class="fas fa-dumbbell" aria-hidden="true"></i>' +
          '<div><small>Log palestra</small>' +
            '<h3>' + (isNew ? 'Aggiungi esercizio' : 'Modifica esercizio') + '</h3></div>' +
        '</div>' +
        '<div class="xlog-dbody">' +
          '<div class="xlog-field">' +
            '<label class="xlog-label" for="xlogName">Esercizio</label>' +
            '<input class="xlog-input" id="xlogName" list="xlogKnown" maxlength="80" ' +
              'placeholder="es. Panca piana" value="' + esc(exerciseName || '') + '">' +
            '<datalist id="xlogKnown"></datalist>' +
          '</div>' +
          '<div class="xlog-field">' +
            '<label class="xlog-label">Serie</label>' +
            '<div class="xlog-colhead">' +
              '<span>#</span><span>Ripetizioni</span><span>Carico</span><span></span>' +
            '</div>' +
            '<div class="xlog-rows" id="xlogRows"></div>' +
            '<button type="button" class="xlog-btn xlog-btn--sec xlog-btn--mini" id="xlogAddRow" ' +
              'style="margin-top:10px">' +
              '<i class="fas fa-plus" aria-hidden="true"></i> Aggiungi serie' +
            '</button>' +
            '<p class="xlog-hint">Carico 0 = a corpo libero. Lascia vuoto ciò che non hai misurato: ' +
              'un campo vuoto resta vuoto, non diventa zero.</p>' +
          '</div>' +
        '</div>' +
        '<div class="xlog-dfoot">' +
          (isNew ? '' :
            '<button type="button" class="xlog-btn xlog-btn--danger" id="xlogDelete">' +
              '<i class="fas fa-trash" aria-hidden="true"></i> Elimina' +
            '</button>') +
          '<div class="xlog-dfoot-right">' +
            '<button type="button" class="xlog-btn xlog-btn--sec" id="xlogCancel">Annulla</button>' +
            '<button type="button" class="xlog-btn xlog-btn--pri" id="xlogSave">Salva</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('is-open'); });

    var rowsEl = ov.querySelector('#xlogRows');
    var nameEl = ov.querySelector('#xlogName');

    function renumber() {
      Array.prototype.forEach.call(rowsEl.querySelectorAll('[data-xlog-row]'), function (r, i) {
        r.querySelector('.xlog-row-n').textContent = String(i + 1);
      });
    }

    function addRow(reps, weight) {
      var wrap = document.createElement('div');
      wrap.innerHTML = rowHtml(rowsEl.children.length + 1, reps, weight);
      var row = wrap.firstChild;
      row.querySelector('[data-xlog-delrow]').addEventListener('click', function () {
        row.remove();
        renumber();
        if (!rowsEl.children.length) addRow(null, null);
      });
      rowsEl.appendChild(row);
    }

    ov.querySelector('#xlogAddRow').addEventListener('click', function () {
      addRow(null, null);
    });

    function close() {
      ov.classList.remove('is-open');
      setTimeout(function () { ov.remove(); }, 200);
    }
    ov.querySelector('#xlogCancel').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape' && document.body.contains(ov)) { close(); }
      if (!document.body.contains(ov)) document.removeEventListener('keydown', onKey);
    });

    // Nomi già usati, per il completamento automatico.
    loadKnownExercises(userId).then(function (names) {
      var dl = ov.querySelector('#xlogKnown');
      if (!dl) return;
      dl.innerHTML = names.map(function (n) {
        return '<option value="' + esc(n) + '"></option>';
      }).join('');
    });

    // Serie esistenti dell'esercizio in modifica.
    if (isNew) {
      addRow(null, null);
      setTimeout(function () { nameEl.focus(); }, 220);
    } else {
      loadForWorkout(userId, workout.id).then(function (rows) {
        var mine = rows.filter(function (r) {
          return (r.exercise_key || keyOf(r.exercise_name)) === keyOf(exerciseName);
        });
        if (!mine.length) addRow(null, null);
        else mine.forEach(function (r) { addRow(r.reps, r.weight_kg); });
      });
    }

    var delBtn = ov.querySelector('#xlogDelete');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        var ask = window.showConfirm
          ? window.showConfirm({
              title: 'Eliminare l\'esercizio?',
              message: 'Tutte le serie di "' + exerciseName + '" in questa sessione ' +
                       'verranno eliminate. Le altre sessioni non sono toccate.',
              confirmText: 'Elimina', cancelText: 'Annulla'
            })
          : Promise.resolve(window.confirm('Eliminare "' + exerciseName + '"?'));

        ask.then(function (ok) {
          if (!ok) return;
          deleteExercise(userId, workout.id, exerciseName).then(function (r) {
            if (r && r.error) {
              toast('Eliminazione non riuscita: ' + r.error.message, 'error', 6000);
              return;
            }
            toast('Esercizio eliminato', 'success');
            close();
            if (typeof onDone === 'function') onDone();
          });
        });
      });
    }

    ov.querySelector('#xlogSave').addEventListener('click', function () {
      var btn  = this;
      var name = (nameEl.value || '').trim();

      if (!name) {
        toast('Indica il nome dell\'esercizio.', 'warning');
        nameEl.focus();
        return;
      }
      if (name.length > 80) {
        toast('Il nome dell\'esercizio non può superare 80 caratteri.', 'warning');
        return;
      }

      // Raccolta e validazione. I limiti sono gli stessi dei vincoli in
      // migrations/006: intercettarli qui evita all'utente un errore
      // grezzo del database, ma il database resta l'ultima parola.
      var rows = [];
      var invalid = null;

      Array.prototype.forEach.call(rowsEl.querySelectorAll('[data-xlog-row]'), function (r) {
        var repsRaw = r.querySelector('[data-xlog-reps]').value.trim();
        var wRaw    = r.querySelector('[data-xlog-weight]').value.trim();

        // Riga completamente vuota: la si salta, non è un errore.
        if (repsRaw === '' && wRaw === '') return;

        var reps = repsRaw === '' ? null : parseInt(repsRaw, 10);
        var w    = wRaw === ''    ? null : parseFloat(wRaw.replace(',', '.'));

        if (reps !== null && (isNaN(reps) || reps < 1 || reps > 1000)) {
          invalid = 'Le ripetizioni devono stare fra 1 e 1000.';
          return;
        }
        if (w !== null && (isNaN(w) || w < 0 || w > 500)) {
          invalid = 'Il carico deve stare fra 0 e 500 kg.';
          return;
        }
        rows.push({ reps: reps, weight: w === null ? null : Math.round(w * 10) / 10 });
      });

      if (invalid) { toast(invalid, 'warning', 5000); return; }
      if (rows.length > 50) {
        toast('Massimo 50 serie per esercizio.', 'warning');
        return;
      }
      if (!rows.length) {
        toast('Inserisci almeno una serie con ripetizioni o carico.', 'warning');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Salvataggio…';

      replaceExercise(userId, workout.id, name, rows, performedAtFor(workout))
        .then(function () {
          toast('Serie salvate', 'success');
          close();
          if (typeof onDone === 'function') onDone();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Salva';
          if (isMissingTableError(err)) {
            markAvailability(err);
            toast('Il log della palestra richiede una migrazione del database ' +
                  'non ancora eseguita (migrations/006).', 'warning', 7000);
            close();
            return;
          }
          console.error('Log palestra: salvataggio non riuscito.', err);
          toast('Salvataggio non riuscito: ' + (err && err.message ? err.message : 'errore sconosciuto'),
                'error', 7000);
        });
    });
  }

  // ── API pubblica ──────────────────────────────────────────────
  window.ExerciseLog = {
    isGymWorkout: isGymWorkout,
    placeholder: placeholder,
    hydrate: hydrate,
    openEditor: openEditor,
    // esportate per i test in Node
    _internals: {
      isMissingTableError: isMissingTableError,
      keyOf: keyOf,
      groupByExercise: groupByExercise,
      summarize: summarize,
      progressionFromHistory: progressionFromHistory,
      deltaLabel: deltaLabel,
      fmtWeight: fmtWeight,
      performedAtFor: performedAtFor
    }
  };

})();
