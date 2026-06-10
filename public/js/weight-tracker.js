/**
 * weight-tracker.js
 * Tracciamento misurazioni corporee — usa tabella body_measurements.
 * Colonne usate: id, user_id, date (TIMESTAMPTZ), weight (NUMERIC),
 *                height (NUMERIC), body_fat (NUMERIC), muscle_mass (NUMERIC),
 *                notes (TEXT).
 *
 * Comportamento "merge-per-data":
 *   - L'utente può inserire una o più metriche in qualsiasi combinazione.
 *   - Se esiste già una riga per (user_id, date), i campi NON valorizzati
 *     dall'utente vengono PRESERVATI (Postgres ON CONFLICT DO UPDATE
 *     aggiorna solo le colonne specificate nell'INSERT).
 *   - Per cancellare un valore, l'utente elimina l'intera riga (icona
 *     cestino in cronologia).
 *
 * Il grafico e il riepilogo si basano sul peso; le altre metriche sono
 * mostrate in cronologia. Saranno usate dalla feature "Bilancio Calorico"
 * (BMR/TDEE) in un secondo step.
 */
(function () {
    'use strict';

    var chartInstance = null;
    var allEntries    = [];   // tutte le misurazioni ordinate per data asc
    var currentDays   = 7;    // filtro attivo

    // ── Avvio ────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        // Imposta la data di oggi nel campo data
        var dateInput = document.getElementById('wtDate');
        if (dateInput) dateInput.value = todayISO();

        // Filtri periodo
        document.querySelectorAll('.wt-period-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.wt-period-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                currentDays = parseInt(btn.dataset.days, 10);
                renderChart(filterByDays(weightOnly(allEntries), currentDays));
            });
        });

        // Pulsante aggiungi
        var addBtn = document.getElementById('wtAddBtn');
        if (addBtn) addBtn.addEventListener('click', addEntry);

        // Aspetta che Supabase sia pronto e carica i dati
        waitForSupabase(function (client, user) {
            loadEntries(client, user.id);
        });
    });

    // ── Attende che supabaseClient e l'utente siano disponibili ──
    function waitForSupabase(cb) {
        var attempts = 0;
        var interval = setInterval(function () {
            attempts++;
            var client = window.supabaseClient;
            if (client) {
                client.auth.getSession().then(function (res) {
                    var session = res.data && res.data.session;
                    if (session && session.user) {
                        clearInterval(interval);
                        cb(client, session.user);
                    }
                });
            }
            if (attempts > 40) clearInterval(interval); // timeout 8s
        }, 200);
    }

    // ── Carica TUTTE le misurazioni da Supabase ──────────────────
    function loadEntries(client, userId) {
        client
            .from('body_measurements')
            .select('id, date, weight, height, body_fat, muscle_mass, notes')
            .eq('user_id', userId)
            .order('date', { ascending: true })
            .then(function (res) {
                if (res.error) {
                    console.error('WeightTracker: errore caricamento', res.error);
                    return;
                }
                allEntries = res.data || [];
                renderAll();
            });
    }

    // ── Restituisce solo entries con peso valorizzato (per chart/summary)
    function weightOnly(entries) {
        return entries.filter(function (e) { return e.weight && e.weight > 0; });
    }

    // ── Aggiunge / aggiorna una misurazione (merge-per-data) ─────
    function addEntry() {
        var dateInput   = document.getElementById('wtDate');
        var weightInput = document.getElementById('wtWeight');
        var heightInput = document.getElementById('wtHeight');
        var bodyFatInput   = document.getElementById('wtBodyFat');
        var muscleInput    = document.getElementById('wtMuscleMass');
        var noteInput   = document.getElementById('wtNote');

        var date = dateInput ? dateInput.value.trim() : '';
        if (!date) {
            showMsg('Inserisci una data.', 'error');
            return;
        }

        // Costruisce dinamicamente l'oggetto: include solo i campi
        // valorizzati dall'utente. Le colonne non presenti nell'INSERT
        // vengono preservate dall'UPDATE on conflict.
        var payload = { user_id: null /* lo settiamo sotto */, date: date };
        var parsed = parseInputs(weightInput, heightInput, bodyFatInput, muscleInput, noteInput);
        if (parsed.error) {
            showMsg(parsed.error, 'error');
            return;
        }
        Object.assign(payload, parsed.values);

        // Almeno un campo deve essere stato fornito
        var filledKeys = Object.keys(parsed.values);
        if (filledKeys.length === 0) {
            showMsg('Inserisci almeno una misurazione.', 'error');
            return;
        }

        var client = window.supabaseClient;
        if (!client) return;

        client.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (!session) return;

            payload.user_id = session.user.id;

            var addBtn = document.getElementById('wtAddBtn');
            if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Salvo...'; }

            // Upsert: la UNIQUE su (user_id, date) garantisce che
            // ON CONFLICT DO UPDATE aggiorni solo le colonne nell'INSERT,
            // preservando i campi esistenti non specificati.
            client
                .from('body_measurements')
                .upsert(payload, { onConflict: 'user_id,date', ignoreDuplicates: false })
                .select('id, date, weight, height, body_fat, muscle_mass, notes')
                .then(function (res2) {
                    if (addBtn) {
                        addBtn.disabled = false;
                        addBtn.innerHTML = '<i class="fas fa-save"></i> Salva misurazione';
                    }
                    if (res2.error) {
                        showMsg('Errore: ' + res2.error.message, 'error');
                        return;
                    }
                    var saved = res2.data && res2.data[0];
                    if (!saved) {
                        showMsg('Salvataggio non riuscito.', 'error');
                        return;
                    }

                    // Merge nell'array locale: sostituisce per data (toISODate
                    // gestisce sia formato pure YYYY-MM-DD sia timestamptz)
                    allEntries = allEntries.filter(function (e) {
                        return toISODate(e.date) !== date;
                    });
                    allEntries.push(saved);
                    allEntries.sort(function (a, b) { return a.date.localeCompare(b.date); });
                    renderAll();

                    // Reset form (mantieni la data, sgancia gli altri campi)
                    [weightInput, heightInput, bodyFatInput, muscleInput, noteInput].forEach(function (el) {
                        if (el) el.value = '';
                    });
                    if (dateInput) dateInput.value = todayISO();
                    showMsg('Misurazione salvata!', 'success');
                });
        });
    }

    // ── Parsing + validazione input ──────────────────────────────
    // Restituisce { values: { campi inseriti } } oppure { error: 'msg' }.
    function parseInputs(weight, height, bodyFat, muscle, note) {
        var values = {};

        if (weight && weight.value !== '') {
            var w = parseFloat(weight.value);
            if (isNaN(w) || w < 20 || w > 300) return { error: 'Peso non valido (20-300 kg).' };
            values.weight = w;
        }
        if (height && height.value !== '') {
            var h = parseInt(height.value, 10);
            if (isNaN(h) || h < 100 || h > 250) return { error: 'Altezza non valida (100-250 cm).' };
            values.height = h;
        }
        if (bodyFat && bodyFat.value !== '') {
            var bf = parseFloat(bodyFat.value);
            if (isNaN(bf) || bf < 3 || bf > 60) return { error: '% grasso non valida (3-60).' };
            values.body_fat = bf;
        }
        if (muscle && muscle.value !== '') {
            var mm = parseFloat(muscle.value);
            if (isNaN(mm) || mm < 10 || mm > 120) return { error: 'Massa muscolare non valida (10-120 kg).' };
            values.muscle_mass = mm;
        }
        if (note && note.value.trim() !== '') {
            values.notes = note.value.trim();
        }

        return { values: values };
    }

    // ── Elimina una misurazione ──────────────────────────────────
    async function deleteEntry(id) {
        const ok = await window.showConfirm({
            title: 'Elimina misurazione',
            message: 'Eliminare questa misurazione?',
            confirmText: 'Elimina',
            danger: true
        });
        if (!ok) return;
        var client = window.supabaseClient;
        if (!client) return;

        client
            .from('body_measurements')
            .delete()
            .eq('id', id)
            .then(function (res) {
                if (res.error) {
                    showMsg('Errore eliminazione.', 'error');
                    return;
                }
                allEntries = allEntries.filter(function (e) { return e.id !== id; });
                renderAll();
                showMsg('Misurazione eliminata.', 'success');
            });
    }
    window.wtDeleteEntry = deleteEntry; // esposta per onclick inline

    // ── Render completo ──────────────────────────────────────────
    function renderAll() {
        var weighted = weightOnly(allEntries);
        renderSummary(weighted);
        renderChart(filterByDays(weighted, currentDays));
        renderHistory(allEntries);
    }

    // ── Riepilogo (3 card in cima) ───────────────────────────────
    function renderSummary(entries) {
        var currentEl = document.getElementById('wtCurrentWeight');
        var trendEl   = document.getElementById('wtTrend');
        var trendIcon = document.getElementById('wtTrendIcon');
        var goalEl    = document.getElementById('wtGoal');

        if (!currentEl) return;

        if (entries.length === 0) {
            currentEl.textContent = '--';
            if (trendEl)   trendEl.textContent = '--';
            if (goalEl)    goalEl.textContent  = '--';
            return;
        }

        // Peso attuale (ultima entry)
        var latest = entries[entries.length - 1];
        currentEl.textContent = latest.weight.toFixed(1) + ' kg';

        // Trend 7 giorni
        var sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        var ref = null;
        for (var i = entries.length - 2; i >= 0; i--) {
            if (new Date(entries[i].date) <= sevenDaysAgo) {
                ref = entries[i];
                break;
            }
        }
        if (!ref && entries.length > 1) ref = entries[0];

        if (trendEl && trendIcon) {
            if (ref) {
                var diff = latest.weight - ref.weight;
                var sign = diff > 0 ? '+' : '';
                trendEl.textContent = sign + diff.toFixed(1) + ' kg';
                if (diff < -0.1) {
                    trendIcon.className = 'wt-stat-icon green';
                    trendIcon.innerHTML = '<i class="fas fa-arrow-down"></i>';
                } else if (diff > 0.1) {
                    trendIcon.className = 'wt-stat-icon red';
                    trendIcon.innerHTML = '<i class="fas fa-arrow-up"></i>';
                } else {
                    trendIcon.className = 'wt-stat-icon blue';
                    trendIcon.innerHTML = '<i class="fas fa-minus"></i>';
                }
            } else {
                trendEl.textContent = '--';
                trendIcon.className = 'wt-stat-icon blue';
                trendIcon.innerHTML = '<i class="fas fa-minus"></i>';
            }
        }

        // Peso obiettivo dal profilo (se disponibile nell'elemento esistente)
        if (goalEl) {
            var targetEl = document.getElementById('dataTargetWeight');
            var targetText = targetEl ? targetEl.textContent.trim() : '';
            goalEl.textContent = (targetText && targetText !== '--') ? targetText : '--';
        }
    }

    // ── Grafico Chart.js (solo peso) ─────────────────────────────
    function renderChart(entries) {
        var ctx = document.getElementById('weightChart');
        if (!ctx) return;

        var labels = entries.map(function (e) { return formatDateShort(e.date); });
        var data   = entries.map(function (e) { return e.weight; });

        if (chartInstance) {
            chartInstance.data.labels         = labels;
            chartInstance.data.datasets[0].data = data;
            chartInstance.update();
            return;
        }

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Peso (kg)',
                    data: data,
                    borderColor: '#4361ee',
                    backgroundColor: 'rgba(67,97,238,0.08)',
                    borderWidth: 2.5,
                    pointBackgroundColor: '#4361ee',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.35,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) { return ctx.parsed.y.toFixed(1) + ' kg'; }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 }, color: '#9ca3af' }
                    },
                    y: {
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            font: { size: 11 },
                            color: '#9ca3af',
                            callback: function (v) { return v + ' kg'; }
                        }
                    }
                }
            }
        });
    }

    // ── Storico (mostra tutti i campi presenti per ciascuna entry)
    function renderHistory(entries) {
        var list = document.getElementById('wtHistoryList');
        if (!list) return;

        var recent = entries.slice().reverse().slice(0, 15);

        if (recent.length === 0) {
            list.innerHTML = '<div class="wt-empty">Nessuna misurazione ancora</div>';
            return;
        }

        list.innerHTML = recent.map(function (e) {
            // Costruisce dinamicamente i blocchi metriche presenti
            var metrics = [];
            if (e.weight)      metrics.push('<span class="wt-entry-weight">' + e.weight.toFixed(1) + ' kg</span>');
            if (e.height)      metrics.push('<span class="wt-entry-metric">' + e.height + ' <span class="wt-entry-metric-label">cm</span></span>');
            if (e.body_fat)    metrics.push('<span class="wt-entry-metric">' + e.body_fat.toFixed(1) + '% <span class="wt-entry-metric-label">grasso</span></span>');
            if (e.muscle_mass) metrics.push('<span class="wt-entry-metric">' + e.muscle_mass.toFixed(1) + ' kg <span class="wt-entry-metric-label">muscolo</span></span>');

            return '<div class="wt-entry">' +
                '<div class="wt-entry-left">' +
                    '<div class="wt-entry-metrics">' + metrics.join('') + '</div>' +
                    '<span class="wt-entry-date">' + formatDateFull(e.date) + '</span>' +
                    (e.notes ? '<span class="wt-entry-note">' + escHtml(e.notes) + '</span>' : '') +
                '</div>' +
                '<button class="wt-entry-del" onclick="wtDeleteEntry(\'' + e.id + '\')" title="Elimina">' +
                    '<i class="fas fa-trash"></i>' +
                '</button>' +
            '</div>';
        }).join('');
    }

    // ── Utilità ──────────────────────────────────────────────────
    function filterByDays(entries, days) {
        if (!days) return entries;
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        var cutoffStr = cutoff.toISOString().slice(0, 10);
        var inWindow = entries.filter(function (e) {
            return toISODate(e.date) >= cutoffStr;
        });

        // Ancoraggio: includi anche l'ultima entry PRIMA del cutoff (se esiste)
        // così il grafico mostra la "transizione" entrando nel periodo invece
        // di un singolo pallino isolato. Coerente con il calcolo del trend
        // nel summary (renderSummary cerca anche entry più vecchie del cutoff
        // come reference). entries è già ordinata asc per data, quindi
        // l'ultima fuori finestra è quella più vicina al cutoff.
        if (entries.length > inWindow.length) {
            var lastBefore = null;
            for (var i = entries.length - 1; i >= 0; i--) {
                if (toISODate(entries[i].date) < cutoffStr) {
                    lastBefore = entries[i];
                    break;
                }
            }
            if (lastBefore) return [lastBefore].concat(inWindow);
        }
        return inWindow;
    }

    function todayISO() {
        return new Date().toISOString().slice(0, 10);
    }

    // Estrae la parte YYYY-MM-DD da qualunque rappresentazione di data:
    //   "2026-05-20"                        → "2026-05-20"
    //   "2026-05-20T00:00:00+00:00"         → "2026-05-20"  (DB timestamptz)
    //   "2026-05-20T22:30:00.123Z"          → "2026-05-20"
    // Restituisce '' se l'input non è utilizzabile.
    function toISODate(dateStr) {
        if (!dateStr) return '';
        var s = String(dateStr).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    }

    function formatDateShort(dateStr) {
        var iso = toISODate(dateStr);
        if (!iso) return '--';
        // 'T12:00:00' (mezzogiorno) evita shift di un giorno tra fusi orari
        var d = new Date(iso + 'T12:00:00');
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    }

    function formatDateFull(dateStr) {
        var iso = toISODate(dateStr);
        if (!iso) return '--';
        var d = new Date(iso + 'T12:00:00');
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showMsg(msg, type) {
        if (window.showToast) {
            window.showToast(msg, type);
            return;
        }
        if (window.AppCore && window.AppCore.showToast) {
            window.AppCore.showToast(msg, type);
            return;
        }
        alert(msg);
    }

})();
