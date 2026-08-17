/**
 * ai-context.js — Aggregazioni dei dati di allenamento per il prompt dell'AI
 *
 * Fonte SINGOLA delle aggregazioni che finiscono nel prompt: frequenza
 * cardiaca e ritmo per tipo di attività, sessioni percepite come dure,
 * progressione dei carichi in palestra.
 *
 * Sta in un file a sé, come hr-model.js, per due motivi:
 *   - sono funzioni PURE, quindi verificabili in Node senza un browser
 *     (vedi scripts/test-ai-context.js). Chiuse dentro il callback di
 *     DOMContentLoaded di ai-trainer.js non lo sarebbero;
 *   - il calcolo delle zone resta delegato a HrModel, che è l'unica fonte
 *     della formula di Karvonen: qui non se ne tiene una seconda copia.
 *
 * Espone window.AiContext.
 */
(function () {
    'use strict';

    // PostgREST restituisce i numeric come stringhe ("60.0"): senza questa
    // conversione le medie sarebbero concatenazioni di testo e i confronti
    // metterebbero "9" sopra "60".
    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        var n = (typeof v === 'number') ? v : parseFloat(v);
        return isNaN(n) ? null : n;
    }

    function mean(arr) {
        if (!arr.length) return null;
        var s = 0;
        for (var i = 0; i < arr.length; i++) s += arr[i];
        return s / arr.length;
    }

    /**
     * Statistiche per tipo di attività: quante sessioni, FC media, ritmo
     * medio, distanza media, e zona cardio in cui cade la FC media.
     *
     * ATTENZIONE ALL'INTERPRETAZIONE, dichiarata anche nel prompt:
     *   - heart_rate_avg è la MEDIA della sessione, non il tracciato
     *     continuo: un intervallato Z2/Z5 produce una media che sembra uno
     *     Z3 costante. È la stessa avvertenza già presente nelle zone
     *     cardio su /stats.
     *   - il ritmo è medio sull'INTERA sessione, riscaldamento e
     *     defaticamento compresi, quindi più lento del ritmo di lavoro.
     *
     * hrProfile arriva da HrModel.loadProfile: { maxHr, restHr, ... } o null.
     */
    function aggregateByActivity(completed, hrProfile) {
        var byType = {};

        completed.forEach(function (w) {
            var plan = w.workout_plans || {};
            var type = w.activity_type || plan.activity_type || 'gym';
            if (!byType[type]) {
                byType[type] = { type: type, n: 0, hrs: [], paces: [], kms: [], durations: [] };
            }
            var b = byType[type];
            b.n++;

            var hr = num(w.heart_rate_avg);
            if (hr !== null && hr > 0) b.hrs.push(hr);

            var km  = num(w.distance);
            var min = num(w.actual_duration);
            if (km !== null && km > 0) b.kms.push(km);
            // Ritmo solo dove significa qualcosa: in palestra "min/km" non
            // vuol dire niente. La soglia di 300 metri scarta i residui di
            // GPS delle sessioni indoor.
            if (km !== null && km > 0.3 && min !== null && min > 0) {
                b.paces.push((min * 60) / km);
            }
            if (min !== null && min > 0) b.durations.push(min);
        });

        var out = Object.keys(byType).map(function (k) {
            var b = byType[k];
            var avgHr = mean(b.hrs);
            var zone = null;
            if (avgHr !== null && hrProfile && hrProfile.maxHr && window.HrModel) {
                zone = window.HrModel.zoneOf(Math.round(avgHr), hrProfile.maxHr, hrProfile.restHr);
            }
            return {
                type:       b.type,
                n:          b.n,
                avgHr:      avgHr === null ? null : Math.round(avgHr),
                zone:       zone,
                avgPaceSec: b.paces.length     ? Math.round(mean(b.paces)) : null,
                avgKm:      b.kms.length       ? Math.round(mean(b.kms) * 10) / 10 : null,
                avgMin:     b.durations.length ? Math.round(mean(b.durations)) : null
            };
        });

        out.sort(function (a, b) { return b.n - a.n; });
        return out;
    }

    /**
     * Sessioni percepite come impegnative: difficoltà dichiarata alta,
     * oppure difficoltà media con gradimento basso (faticata e non
     * piaciuta).
     *
     * È l'unico dato SOGGETTIVO disponibile, e per un allenatore vale
     * quanto i numeri: dice se il carico proposto era sostenibile davvero,
     * cosa che la frequenza cardiaca da sola non racconta.
     */
    function findHardSessions(completed) {
        var out = completed.map(function (w) {
            var plan = w.workout_plans || {};
            return {
                name:       plan.name || null,
                difficulty: num(w.perceived_difficulty),
                rating:     num(w.rating),
                hr:         num(w.heart_rate_avg),
                date:       w.completed_at ? String(w.completed_at).slice(0, 10) : null
            };
        }).filter(function (s) {
            if (!s.name || s.difficulty === null) return false;
            if (s.difficulty >= 4) return true;
            return s.difficulty >= 3 && s.rating !== null && s.rating <= 2;
        });

        out.sort(function (a, b) {
            var d = b.difficulty - a.difficulty;
            if (d !== 0) return d;
            return (a.rating === null ? 5 : a.rating) - (b.rating === null ? 5 : b.rating);
        });
        return out.slice(0, 3);
    }

    /**
     * Progressione dei carichi: per ogni esercizio il massimale della prima
     * e dell'ultima sessione del periodo, così l'AI può proporre il passo
     * successivo invece di ripartire da zero ogni volta.
     *
     * Raggruppa per GIORNO e non per riga: più serie dello stesso esercizio
     * nello stesso allenamento sono una sola sessione, e ciò che conta è il
     * massimale di quella sessione.
     */
    function aggregateGymProgress(rows) {
        var byEx = {};

        rows.forEach(function (r) {
            var key = r.exercise_key ||
                      String(r.exercise_name || '').trim().toLowerCase();
            var w = num(r.weight_kg);
            if (!key || w === null) return;

            var day = r.performed_at ? String(r.performed_at).slice(0, 10) : '';
            if (!byEx[key]) byEx[key] = { name: r.exercise_name, sessions: {} };

            var e = byEx[key];
            if (!e.sessions[day] || w > e.sessions[day].maxW) {
                e.sessions[day] = { maxW: w, reps: num(r.reps) };
            }
        });

        var out = Object.keys(byEx).map(function (k) {
            var e    = byEx[k];
            var days = Object.keys(e.sessions).sort();
            var first = e.sessions[days[0]];
            var last  = e.sessions[days[days.length - 1]];
            return {
                exercise: e.name,
                fromKg:   first.maxW,
                toKg:     last.maxW,
                lastReps: last.reps,
                sessions: days.length
            };
        });

        out.sort(function (a, b) { return b.sessions - a.sessions; });
        return out.slice(0, 6);
    }

    /** "5:42" da 342 secondi. Null se il ritmo non è disponibile. */
    function formatPace(sec) {
        if (sec === null || sec === undefined || !(sec > 0)) return null;
        var m = Math.floor(sec / 60);
        var s = Math.round(sec % 60);
        if (s === 60) { m++; s = 0; }
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    window.AiContext = {
        aggregateByActivity: aggregateByActivity,
        findHardSessions: findHardSessions,
        aggregateGymProgress: aggregateGymProgress,
        formatPace: formatPace,
        _num: num
    };

})();
