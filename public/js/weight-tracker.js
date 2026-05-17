/**
 * weight-tracker.js
 * Tracciamento peso nel profilo — usa tabella body_measurements
 * Colonne usate: id, user_id, date (DATE), weight (FLOAT), notes (TEXT)
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
                renderChart(filterByDays(allEntries, currentDays));
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

    // ── Carica misurazioni da Supabase ───────────────────────────
    function loadEntries(client, userId) {
        client
            .from('body_measurements')
            .select('id, date, weight, notes')
            .eq('user_id', userId)
            .not('weight', 'is', null)
            .order('date', { ascending: true })
            .then(function (res) {
                if (res.error) {
                    console.error('WeightTracker: errore caricamento', res.error);
                    return;
                }
                allEntries = (res.data || []).filter(function (e) {
                    return e.weight && e.weight > 0;
                });
                renderAll();
            });
    }

    // ── Aggiunge una nuova misurazione ───────────────────────────
    function addEntry() {
        var dateInput   = document.getElementById('wtDate');
        var weightInput = document.getElementById('wtWeight');
        var noteInput   = document.getElementById('wtNote');

        var date   = dateInput   ? dateInput.value.trim()   : '';
        var weight = weightInput ? parseFloat(weightInput.value) : NaN;
        var note   = noteInput   ? noteInput.value.trim()   : '';

        if (!date) {
            showMsg('Inserisci una data.', 'error');
            return;
        }
        if (isNaN(weight) || weight <= 0) {
            showMsg('Inserisci un peso valido.', 'error');
            return;
        }

        var client = window.supabaseClient;
        if (!client) return;

        client.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (!session) return;

            var userId = session.user.id;
            var addBtn = document.getElementById('wtAddBtn');
            if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Salvo...'; }

            // Upsert: se esiste già una riga con la stessa data → aggiorna
            client
                .from('body_measurements')
                .upsert(
                    { user_id: userId, date: date, weight: weight, notes: note || null },
                    { onConflict: 'user_id,date', ignoreDuplicates: false }
                )
                .select('id, date, weight, notes')
                .then(function (res2) {
                    if (addBtn) {
                        addBtn.disabled = false;
                        addBtn.innerHTML = '<i class="fas fa-save"></i> Salva misurazione';
                    }
                    if (res2.error) {
                        // Se upsert non è supportato (constraint mancante) prova insert
                        insertFallback(client, userId, date, weight, note);
                        return;
                    }
                    var saved = res2.data && res2.data[0];
                    if (saved) {
                        // Aggiorna array locale
                        allEntries = allEntries.filter(function (e) { return e.date !== date; });
                        allEntries.push(saved);
                        allEntries.sort(function (a, b) { return a.date.localeCompare(b.date); });
                        renderAll();
                        // Reset form
                        if (weightInput) weightInput.value = '';
                        if (noteInput)   noteInput.value   = '';
                        dateInput.value = todayISO();
                        showMsg('Misurazione salvata!', 'success');
                    }
                });
        });
    }

    function insertFallback(client, userId, date, weight, note) {
        client
            .from('body_measurements')
            .insert({ user_id: userId, date: date, weight: weight, notes: note || null })
            .select('id, date, weight, notes')
            .then(function (res) {
                if (res.error) {
                    showMsg('Errore: ' + res.error.message, 'error');
                    return;
                }
                var saved = res.data && res.data[0];
                if (saved) {
                    allEntries.push(saved);
                    allEntries.sort(function (a, b) { return a.date.localeCompare(b.date); });
                    renderAll();
                    showMsg('Misurazione salvata!', 'success');
                }
            });
    }

    // ── Elimina una misurazione ──────────────────────────────────
    function deleteEntry(id) {
        if (!confirm('Eliminare questa misurazione?')) return;
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
        renderSummary(allEntries);
        renderChart(filterByDays(allEntries, currentDays));
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

    // ── Grafico Chart.js ─────────────────────────────────────────
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

    // ── Storico ──────────────────────────────────────────────────
    function renderHistory(entries) {
        var list = document.getElementById('wtHistoryList');
        if (!list) return;

        var recent = entries.slice().reverse().slice(0, 15);

        if (recent.length === 0) {
            list.innerHTML = '<div class="wt-empty">Nessuna misurazione ancora</div>';
            return;
        }

        list.innerHTML = recent.map(function (e) {
            return '<div class="wt-entry">' +
                '<div class="wt-entry-left">' +
                    '<span class="wt-entry-weight">' + e.weight.toFixed(1) + ' kg</span>' +
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
        return entries.filter(function (e) { return e.date >= cutoffStr; });
    }

    function todayISO() {
        return new Date().toISOString().slice(0, 10);
    }

    function formatDateShort(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    }

    function formatDateFull(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
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
