/**
 * weather.js — Meteo storico di un allenamento
 *
 * I file TCX/GPX non contengono le condizioni meteo, e la temperatura solo
 * a volte (il GPX Garmin ha <gpxtpx:atemp>, il TCX quasi mai). Qui il dato
 * viene recuperato da un servizio meteo a partire da posizione e orario,
 * come fa Garmin Connect dopo il caricamento.
 *
 * La chiamata passa dal NOSTRO server (/api/weather), non direttamente dal
 * browser: così la CSP resta stretta e l'indirizzo IP dell'utente non
 * arriva al servizio meteo — escono solo le coordinate dell'attività.
 *
 * Espone window.VortexWeather.
 */
(function () {
    'use strict';

    // Codici meteo WMO → i sette valori ammessi dalla colonna weather
    // (vincolo in migrations/003-weather.sql). La mappatura è per forza
    // lossy: WMO distingue pioviggine, pioggia gelata e temporale, che qui
    // diventano tutti "pioggia". Meglio questo che una migrazione in più
    // per una sfumatura che nell'interfaccia non useremmo comunque.
    var WMO = {
        0:  ['sereno',   'Sereno'],
        1:  ['sereno',   'Prevalentemente sereno'],
        2:  ['nuvoloso', 'Parzialmente nuvoloso'],
        3:  ['nuvoloso', 'Coperto'],
        45: ['nuvoloso', 'Nebbia'],
        48: ['nuvoloso', 'Nebbia con brina'],
        51: ['pioggia',  'Pioviggine leggera'],
        53: ['pioggia',  'Pioviggine'],
        55: ['pioggia',  'Pioviggine intensa'],
        56: ['pioggia',  'Pioviggine gelata'],
        57: ['pioggia',  'Pioviggine gelata intensa'],
        61: ['pioggia',  'Pioggia leggera'],
        63: ['pioggia',  'Pioggia'],
        65: ['pioggia',  'Pioggia intensa'],
        66: ['pioggia',  'Pioggia gelata'],
        67: ['pioggia',  'Pioggia gelata intensa'],
        71: ['neve',     'Nevicata leggera'],
        73: ['neve',     'Nevicata'],
        75: ['neve',     'Nevicata intensa'],
        77: ['neve',     'Granuli di neve'],
        80: ['pioggia',  'Rovesci leggeri'],
        81: ['pioggia',  'Rovesci'],
        82: ['pioggia',  'Rovesci violenti'],
        85: ['neve',     'Rovesci di neve'],
        86: ['neve',     'Rovesci di neve intensi'],
        95: ['pioggia',  'Temporale'],
        96: ['pioggia',  'Temporale con grandine'],
        99: ['pioggia',  'Temporale con grandine forte']
    };

    var ICONS = {
        sereno:   'fa-sun',
        nuvoloso: 'fa-cloud',
        pioggia:  'fa-cloud-rain',
        vento:    'fa-wind',
        neve:     'fa-snowflake',
        afoso:    'fa-temperature-high',
        indoor:   'fa-house'
    };

    function describe(code) {
        var entry = WMO[code];
        if (!entry) return null;
        return { weather: entry[0], label: entry[1], icon: ICONS[entry[0]] };
    }

    function iconFor(weather) {
        return ICONS[weather] || 'fa-cloud';
    }

    /**
     * Recupera il meteo per un punto e un istante.
     * Risolve con null (mai un errore) quando il dato non è disponibile:
     * il meteo è un extra, non deve far fallire l'import.
     */
    function fetch_(lat, lon, isoTime) {
        var sc = window.supabaseClient;
        if (!sc) return Promise.resolve(null);

        return sc.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (!session) return null;

            var url = '/api/weather?lat=' + encodeURIComponent(lat) +
                      '&lon=' + encodeURIComponent(lon) +
                      '&time=' + encodeURIComponent(isoTime);

            // Timeout lato client: il server ne ha uno suo, ma se la rete
            // è ferma l'utente non deve restare in attesa indefinita.
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, 8000);

            return fetch(url, {
                headers: { 'Authorization': 'Bearer ' + session.access_token },
                signal: controller.signal
            }).then(function (r) {
                clearTimeout(timer);
                if (!r.ok) return null;      // 404 = nessun dato per quel punto/ora
                return r.json();
            }).then(function (data) {
                if (!data) return null;
                var d = describe(data.weatherCode);
                return {
                    temperature: (typeof data.temperature === 'number') ? data.temperature : null,
                    humidity:    (typeof data.humidity === 'number')    ? data.humidity    : null,
                    weather: d ? d.weather : null,
                    label:   d ? d.label   : null,
                    icon:    d ? d.icon    : null
                };
            }).catch(function () {
                clearTimeout(timer);
                return null;
            });
        }).catch(function () { return null; });
    }

    window.VortexWeather = {
        fetch: fetch_,
        describe: describe,
        iconFor: iconFor
    };

})();
