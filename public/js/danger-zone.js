/**
 * danger-zone.js — Eliminazione di tutti i dati utente
 *
 * Stava nella dashboard, come UNICA azione della sezione "I Tuoi
 * Allenamenti": un pulsante rosso esattamente dove ci si aspetta "Nuovo
 * allenamento". Spostato qui nel profilo, in fondo, in una zona
 * chiaramente separata: resta raggiungibile ma non lo si incontra per
 * sbaglio mentre si usa l'app.
 *
 * Modulo autonomo: inietta il proprio modal e il proprio CSS. Basta
 * mettere in pagina un contenitore con id="dangerZone".
 */
(function () {
    'use strict';

    // L'ordine conta poco (sono cancellazioni indipendenti), ma l'elenco
    // serve a dire all'utente COSA sta per perdere, prima di farlo.
    var TARGETS = [
        { table: 'workout_plans',      label: 'schede di allenamento' },
        { table: 'completed_workouts', label: 'allenamenti completati' },
        { table: 'weekly_summaries',   label: 'riepiloghi settimanali' },
        { table: 'body_measurements',  label: 'misure corporee e storico peso' },
        { table: 'user_preferences',   label: 'preferenze' }
    ];

    var CONFIRM_WORD = 'ELIMINA';

    document.addEventListener('DOMContentLoaded', function () {
        var host = document.getElementById('dangerZone');
        if (!host) return;
        injectCss();
        render(host);
    });

    function render(host) {
        host.innerHTML =
            '<div class="dz-card">' +
                '<div class="dz-head">' +
                    '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>' +
                    '<h3>Zona pericolosa</h3>' +
                '</div>' +
                '<p class="dz-text">' +
                    'Elimina definitivamente tutti i tuoi dati di allenamento. ' +
                    'L\'account resta attivo, ma il contenuto non è recuperabile.' +
                '</p>' +
                '<ul class="dz-list">' +
                    TARGETS.map(function (t) { return '<li>' + t.label + '</li>'; }).join('') +
                '</ul>' +
                '<button type="button" class="dz-btn" id="dzOpen">' +
                    '<i class="fas fa-trash-alt" aria-hidden="true"></i> Elimina tutti i dati' +
                '</button>' +
            '</div>';

        document.getElementById('dzOpen').addEventListener('click', openDialog);
    }

    // ── Conferma ─────────────────────────────────────────────────────────
    function openDialog() {
        var old = document.getElementById('dzModal');
        if (old) old.remove();

        var modal = document.createElement('div');
        modal.id = 'dzModal';
        modal.className = 'dz-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'dzModalTitle');
        modal.innerHTML =
            '<div class="dz-modal-box">' +
                '<h3 id="dzModalTitle"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Conferma eliminazione</h3>' +
                '<p>Stai per eliminare <strong>tutti</strong> i tuoi dati. ' +
                   'Questa azione è <strong>irreversibile</strong>.</p>' +
                '<label for="dzInput">Scrivi <strong>' + CONFIRM_WORD + '</strong> per confermare:</label>' +
                '<input type="text" id="dzInput" autocomplete="off" placeholder="' + CONFIRM_WORD + '">' +
                '<div class="dz-modal-actions">' +
                    '<button type="button" class="dz-cancel" id="dzCancel">Annulla</button>' +
                    '<button type="button" class="dz-confirm" id="dzConfirm" disabled>Elimina tutto</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        var input   = document.getElementById('dzInput');
        var confirm = document.getElementById('dzConfirm');

        // Il pulsante si sblocca solo scrivendo la parola esatta: rende
        // impossibile cancellare tutto con un doppio clic distratto.
        input.addEventListener('input', function () {
            confirm.disabled = input.value.trim() !== CONFIRM_WORD;
        });

        document.getElementById('dzCancel').addEventListener('click', close);
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
        document.addEventListener('keydown', onEsc);
        input.focus();

        confirm.addEventListener('click', function () {
            confirm.disabled = true;
            confirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Elimino...';
            wipe().then(close);
        });

        function onEsc(e) { if (e.key === 'Escape') close(); }
        function close() {
            document.removeEventListener('keydown', onEsc);
            var m = document.getElementById('dzModal');
            if (m) m.remove();
        }
    }

    // ── Cancellazione ────────────────────────────────────────────────────
    function wipe() {
        var sc = window.supabaseClient;
        if (!sc) { toast('Client non disponibile. Ricarica la pagina.', 'error'); return Promise.resolve(); }

        return sc.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (!session) { toast('Sessione scaduta. Effettua di nuovo il login.', 'error'); return; }
            var uid = session.user.id;

            // Supabase NON lancia eccezioni sugli errori di query (ritorna
            // {error}), quindi Promise.all maschererebbe i fallimenti
            // parziali: con allSettled + ispezione esplicita sappiamo
            // davvero cosa è stato cancellato e cosa no.
            return Promise.allSettled(
                TARGETS.map(function (t) { return sc.from(t.table).delete().eq('user_id', uid); })
            ).then(function (results) {
                var failures = [];
                results.forEach(function (r, i) {
                    var label = TARGETS[i].label;
                    if (r.status === 'rejected') {
                        failures.push(label + ' (rete: ' + ((r.reason && r.reason.message) || 'errore sconosciuto') + ')');
                    } else if (r.value && r.value.error) {
                        failures.push(label + ' (' + r.value.error.message + ')');
                    }
                });

                if (failures.length === 0) {
                    toast('Tutti i dati sono stati eliminati.', 'success');
                    setTimeout(function () { window.location.href = '/dashboard'; }, 1200);
                } else if (failures.length < TARGETS.length) {
                    console.warn('Reset parziale:', failures);
                    toast('Eliminazione parziale — non riuscita per: ' + failures.join('; '), 'warning');
                } else {
                    console.error('Reset fallito:', failures);
                    toast('Impossibile eliminare i dati (' + failures[0] + ')', 'error');
                }
            });
        });
    }

    function toast(msg, type) {
        if (window.showToast) return window.showToast(msg, type);
        if (window.AppCore && window.AppCore.showToast) return window.AppCore.showToast(msg, type);
        alert(msg);
    }

    // ── CSS ──────────────────────────────────────────────────────────────
    function injectCss() {
        if (document.getElementById('dzCss')) return;
        var s = document.createElement('style');
        s.id = 'dzCss';
        s.textContent = [
            '.dz-card{border:1.5px solid #fecaca;background:#fff;border-radius:12px;padding:1.25rem;margin-top:2rem}',
            '.dz-head{display:flex;align-items:center;gap:.55rem;margin-bottom:.6rem}',
            '.dz-head i{color:#dc2626;font-size:1.05rem}',
            '.dz-head h3{margin:0;font-size:.98rem;font-weight:700;color:#b91c1c}',
            '.dz-text{font-size:.85rem;color:#6b7280;margin:0 0 .6rem;line-height:1.55}',
            '.dz-list{margin:0 0 1rem 1.1rem;padding:0;font-size:.8rem;color:#9ca3af;line-height:1.7}',
            '.dz-btn{background:#fff;border:1.5px solid #dc2626;color:#dc2626;font-weight:600;font-size:.85rem;' +
              'padding:.55rem 1rem;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:.45rem;transition:all .15s}',
            '.dz-btn:hover{background:#dc2626;color:#fff}',
            '.dz-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;' +
              'justify-content:center;z-index:10000;padding:1rem}',
            '.dz-modal-box{background:#fff;border-radius:14px;padding:1.5rem;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25)}',
            '.dz-modal-box h3{margin:0 0 .75rem;font-size:1.05rem;color:#b91c1c;display:flex;align-items:center;gap:.5rem}',
            '.dz-modal-box p{font-size:.87rem;color:#475569;line-height:1.6;margin:0 0 1rem}',
            '.dz-modal-box label{display:block;font-size:.8rem;color:#475569;margin-bottom:.35rem}',
            '.dz-modal-box input{width:100%;padding:.6rem .8rem;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.95rem;letter-spacing:.05em}',
            '.dz-modal-box input:focus{outline:none;border-color:#dc2626}',
            '.dz-modal-actions{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.25rem}',
            '.dz-cancel{background:#f1f5f9;border:none;color:#475569;font-weight:600;padding:.55rem 1.1rem;border-radius:8px;cursor:pointer}',
            '.dz-confirm{background:#dc2626;border:none;color:#fff;font-weight:600;padding:.55rem 1.1rem;border-radius:8px;cursor:pointer}',
            '.dz-confirm:disabled{background:#fca5a5;cursor:not-allowed}'
        ].join('');
        document.head.appendChild(s);
    }

})();
