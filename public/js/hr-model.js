/**
 * hr-model.js — Modello unico delle zone di frequenza cardiaca
 *
 * Fonte SINGOLA della formula, usata sia dalle zone cardio su /stats sia
 * dalla stima di recupero sulla dashboard. Averne due copie significava
 * poterle far divergere: la stessa sessione sarebbe finita in Z3 in una
 * pagina e in Z4 nell'altra, senza che nulla lo segnalasse.
 *
 * Espone window.HrModel.
 */
(function () {
    'use strict';

    var ZONES = [
        { n: 1, lo: 0.50, hi: 0.60, name: 'Recupero',  desc: 'Rigenerante, respirazione facile', color: '#94a3b8' },
        { n: 2, lo: 0.60, hi: 0.70, name: 'Fondo',     desc: 'Aerobico, si può conversare',      color: '#3b82f6' },
        { n: 3, lo: 0.70, hi: 0.80, name: 'Medio',     desc: 'Impegnativo ma sostenibile',       color: '#22c55e' },
        { n: 4, lo: 0.80, hi: 0.90, name: 'Soglia',    desc: 'Duro, parlare diventa difficile',  color: '#f59e0b' },
        { n: 5, lo: 0.90, hi: 1.01, name: 'Massimale', desc: 'Massimo sforzo, breve durata',     color: '#ef4444' }
    ];

    // Il ripiego deve scattare SOLO su "colonna inesistente": con un
    // catch su qualsiasi errore, un guasto di rete o di permessi
    // degraderebbe silenziosamente alla stima dall'età, e nessuno se ne
    // accorgerebbe perché le zone continuerebbero a comparire.
    function isMissingColumnError(err) {
        if (!err) return false;
        if (err.code === 'PGRST204' || err.code === '42703') return true;
        var m = String(err.message || '').toLowerCase();
        return m.indexOf('could not find') !== -1 && m.indexOf('column') !== -1;
    }

    function ageFromBirthdate(birthdate) {
        if (!birthdate) return null;
        var bd = new Date(String(birthdate).slice(0, 10));
        if (isNaN(bd.getTime())) return null;
        var today = new Date();
        var a = today.getFullYear() - bd.getFullYear();
        var m = today.getMonth() - bd.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) a--;
        return (a > 0 && a < 120) ? a : null;
    }

    // Tanaka (2001): più accurata della classica 220-età, che sovrastima nei
    // giovani e sottostima negli over 40.
    function estimateMaxHr(age) {
        return Math.round(208 - 0.7 * age);
    }

    /**
     * Confine di zona in bpm.
     * Con la FC a riposo si usa Karvonen (percentuale della RISERVA
     * cardiaca), lo stesso metodo di Garmin. Senza, si ripiega sulla
     * percentuale della massima, che colloca le zone più in basso.
     */
    function hrAt(pct, maxHr, restHr) {
        if (restHr && maxHr > restHr) return Math.round(restHr + pct * (maxHr - restHr));
        return Math.round(pct * maxHr);
    }

    function usingKarvonen(maxHr, restHr) {
        return !!(restHr && maxHr > restHr);
    }

    function bounds(maxHr, restHr) {
        return ZONES.map(function (z) {
            return { n: z.n, name: z.name, color: z.color, desc: z.desc,
                     lo: hrAt(z.lo, maxHr, restHr), hi: hrAt(z.hi, maxHr, restHr) };
        });
    }

    /**
     * Zona (1-5) in cui cade una frequenza cardiaca.
     * Sotto la Z1 viene assorbito in Z1: è comunque lavoro rigenerante.
     * Ritorna null se mancano i parametri.
     */
    function zoneOf(bpm, maxHr, restHr) {
        if (!(bpm > 0) || !(maxHr > 0)) return null;
        var b = bounds(maxHr, restHr);
        for (var i = 0; i < b.length; i++) {
            if (bpm < b[i].hi) return b[i].n;
        }
        return b.length; // sopra l'ultimo confine
    }

    /**
     * Tempo trascorso in ciascuna zona, da una serie di campioni.
     *
     * serie = [[secondiDallInizio, bpm], ...], come salvata in
     * workout_plans.hr_series dall'import.
     *
     * PERCHÉ NON BASTA LA MEDIA
     * Su una corsa reale di 52 minuti la media era 140 bpm, che cade in
     * Z2, ma il tracciato diceva 45% in Z3 e solo 37% in Z2. Riassumere
     * con la media non è impreciso: dà la zona SBAGLIATA, e l'AI e il
     * recupero ci costruiscono sopra.
     *
     * Ogni campione vale l'intervallo che lo separa dal successivo. Gli
     * intervalli assurdi (negativi, o oltre il minuto: pause, perdita di
     * segnale) valgono 1 secondo invece di essere sommati per intero,
     * altrimenti una pausa di venti minuti finirebbe attribuita alla
     * zona in cui ci si trovava quando è iniziata.
     *
     * Ritorna { secs: [null,z1..z5], total, pct: [null,z1..z5] } oppure
     * null se la serie non è utilizzabile.
     */
    function timeInZones(series, maxHr, restHr) {
        if (!Array.isArray(series) || series.length < 2 || !(maxHr > 0)) return null;

        var secs = [null, 0, 0, 0, 0, 0];
        var total = 0;

        for (var i = 0; i < series.length - 1; i++) {
            var a = series[i], b = series[i + 1];
            if (!a || !b) continue;
            var bpm = Number(a[1]);
            if (!(bpm > 0)) continue;

            var d = Number(b[0]) - Number(a[0]);
            if (!(d > 0) || d > 60) d = 1;

            var z = zoneOf(bpm, maxHr, restHr);
            if (!z) continue;
            secs[z] += d;
            total += d;
        }
        if (!total) return null;

        var pct = [null];
        for (var n = 1; n <= 5; n++) pct.push(Math.round((secs[n] / total) * 100));
        return { secs: secs, total: total, pct: pct };
    }

    /**
     * Carico di allenamento secondo il TRIMP di Banister, pesato
     * sull'esponenziale della riserva cardiaca usata.
     *
     * È una formula PUBBLICATA, non l'indice di Garmin: Training Load,
     * Body Battery e Training Status sono metriche proprietarie che
     * Garmin non espone da nessuna parte (né file, né Health Connect).
     * Questo numero va quindi presentato come stima nostra, come già si
     * fa per calorie e recupero, e non confrontato con quello
     * dell'orologio: misurano la stessa cosa con metodi diversi.
     *
     * Il coefficiente 1.92 è quello maschile della formulazione
     * originale; 0.64 è il fattore di scala che la accompagna.
     */
    function trimp(series, maxHr, restHr) {
        if (!Array.isArray(series) || series.length < 2 || !(maxHr > 0)) return null;
        var rest = (restHr > 0 && maxHr > restHr) ? restHr : 0;
        var span = maxHr - rest;
        if (!(span > 0)) return null;

        var v = 0;
        for (var i = 0; i < series.length - 1; i++) {
            var a = series[i], b = series[i + 1];
            if (!a || !b) continue;
            var bpm = Number(a[1]);
            if (!(bpm > 0)) continue;

            var d = Number(b[0]) - Number(a[0]);
            if (!(d > 0) || d > 60) d = 1;

            var r = (bpm - rest) / span;
            if (r < 0) r = 0;
            if (r > 1) r = 1;
            v += (d / 60) * r * 0.64 * Math.exp(1.92 * r);
        }
        return Math.round(v);
    }

    /**
     * Legge dal profilo i parametri della FC.
     * max_heart_rate e resting_heart_rate arrivano da migrations/002: se
     * mancano si ripiega sulla sola data di nascita, così le zone
     * continuano a funzionare (con il metodo meno preciso).
     */
    function loadProfile(sc, userId) {
        function apply(row) {
            row = row || {};
            var age = row.birthdate ? ageFromBirthdate(row.birthdate) : null;
            var maxHr = null, measured = false;

            if (row.max_heart_rate > 0)      { maxHr = row.max_heart_rate; measured = true; }
            else if (age)                    { maxHr = estimateMaxHr(age); }

            return {
                age: age,
                maxHr: maxHr,
                restHr: row.resting_heart_rate > 0 ? row.resting_heart_rate : null,
                maxIsMeasured: measured
            };
        }

        return sc.from('profiles')
            .select('birthdate, max_heart_rate, resting_heart_rate')
            .eq('id', userId).single()
            .then(function (r) {
                if (!r.error) return apply(r.data);
                if (!isMissingColumnError(r.error)) {
                    console.warn('HR: lettura del profilo non riuscita.', r.error);
                    return apply(null);
                }
                console.warn('HR: colonne FC non disponibili, eseguire ' +
                             'migrations/002-hr-settings.sql. Ripiego sull\'età.', r.error);
                return sc.from('profiles').select('birthdate').eq('id', userId).single()
                    .then(function (r2) { return apply(r2.error ? null : r2.data); });
            })
            .catch(function () { return apply(null); });
    }

    /**
     * Il riquadro "Tempo in zona" con le barre e il carico TRIMP.
     *
     * PERCHÉ STA QUI E NON IN dashboard.js
     * Ci è nato, ma da quando le schede completate lasciano la dashboard e
     * vivono nell'Archivio, quel riquadro serve in due pagine. Copiarlo
     * avrebbe significato due formule di Karvonen e due modi di calcolare
     * il TRIMP che col tempo divergono — lo stesso motivo per cui questo
     * file esiste.
     *
     * Restituisce stringa vuota, non un riquadro vuoto, quando manca il
     * necessario: senza profilo cardiaco o senza tracciato non c'è niente
     * di onesto da mostrare.
     *
     * @param {Array} series   [[secondi, bpm], ...] da workout_plans.hr_series
     * @param {Object} profile { maxHr, restHr } da loadProfile
     * @param {Function} esc   la funzione di escape della pagina chiamante
     */
    function zoneBreakdownHtml(series, profile, esc) {
        if (!profile || !profile.maxHr) return '';
        // jsonb di solito arriva già come array, ma non si dà per scontato
        // il tipo: se fosse una stringa la si interpreta lo stesso.
        var data = series;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return ''; }
        }
        if (!Array.isArray(data) || data.length < 2) return '';

        var tz = timeInZones(data, profile.maxHr, profile.restHr);
        if (!tz) return '';
        var load = trimp(data, profile.maxHr, profile.restHr);
        var e = typeof esc === 'function' ? esc : function (s) { return String(s); };

        function fmt(s) {
            var m = Math.floor(s / 60), r = Math.round(s % 60);
            return m ? m + 'm' + (r ? ' ' + r + 's' : '') : r + 's';
        }

        var rows = bounds(profile.maxHr, profile.restHr).map(function (z) {
            var sec = tz.secs[z.n];
            if (!sec) return '';
            return '<div class="hrz-row">' +
                '<span class="hrz-tag" style="background:' + z.color + '">Z' + z.n + '</span>' +
                '<span class="hrz-name">' + e(z.name) + '</span>' +
                '<span class="hrz-bar"><span class="hrz-fill" style="width:' + tz.pct[z.n] +
                    '%;background:' + z.color + '"></span></span>' +
                '<span class="hrz-time">' + e(fmt(sec)) + '</span>' +
                '<span class="hrz-pct">' + tz.pct[z.n] + '%</span>' +
            '</div>';
        }).join('');

        if (!rows) return '';

        return '<div class="hrz-block">' +
            '<div class="hrz-head">' +
                '<h4><i class="fas fa-heart-pulse" aria-hidden="true"></i> Tempo in zona</h4>' +
                (load !== null
                    ? '<span class="hrz-load" title="Carico di allenamento (TRIMP), stimato da noi: ' +
                      'non è il valore di Garmin, che non lo espone">carico ' + load + '</span>'
                    : '') +
            '</div>' + rows +
            '<p class="hrz-note">Dal tracciato cardiaco della sessione, ' + data.length +
            ' campioni. Il carico è una nostra stima con il metodo TRIMP: Garmin non ' +
            'espone il proprio, quindi i due numeri non sono confrontabili.</p>' +
        '</div>';
    }

    window.HrModel = {
        ZONES: ZONES,
        zoneBreakdownHtml: zoneBreakdownHtml,
        ageFromBirthdate: ageFromBirthdate,
        estimateMaxHr: estimateMaxHr,
        hrAt: hrAt,
        usingKarvonen: usingKarvonen,
        bounds: bounds,
        zoneOf: zoneOf,
        isMissingColumnError: isMissingColumnError,
        timeInZones: timeInZones,
        trimp: trimp,
        loadProfile: loadProfile
    };

})();
