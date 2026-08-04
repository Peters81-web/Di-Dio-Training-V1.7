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
                console.warn('HR: colonne FC non disponibili, eseguire ' +
                             'migrations/002-hr-settings.sql. Ripiego sull\'età.', r.error);
                return sc.from('profiles').select('birthdate').eq('id', userId).single()
                    .then(function (r2) { return apply(r2.error ? null : r2.data); });
            })
            .catch(function () { return apply(null); });
    }

    window.HrModel = {
        ZONES: ZONES,
        ageFromBirthdate: ageFromBirthdate,
        estimateMaxHr: estimateMaxHr,
        hrAt: hrAt,
        usingKarvonen: usingKarvonen,
        bounds: bounds,
        zoneOf: zoneOf,
        loadProfile: loadProfile
    };

})();
