/**
 * utils.js
 * Contiene funzioni di utility condivise tra diversi componenti
 * dell'applicazione Di Dio Training
 */

// Mostra un toast di notifica
function showToast(message, type = 'info', duration = 3000) {
    // Rimuovi i toast esistenti
    document.querySelectorAll('.toast').forEach(toast => toast.remove());
    
    // Crea il toast
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Scegli l'icona appropriata
    let icon = '';
    switch (type) {
        case 'success':
            icon = '<i class="fas fa-check-circle"></i>';
            break;
        case 'error':
            icon = '<i class="fas fa-exclamation-circle"></i>';
            break;
        case 'warning':
            icon = '<i class="fas fa-exclamation-triangle"></i>';
            break;
        case 'info':
        default:
            icon = '<i class="fas fa-info-circle"></i>';
            break;
    }
    
    // Costruisci il contenuto
    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-message">${message}</div>
        <button class="toast-close" aria-label="Chiudi">&times;</button>
    `;
    
    // Aggiungi il toast al DOM
    document.body.appendChild(toast);
    
    // Anima l'entrata
    toast.style.animation = 'toastSlideIn 0.3s ease-out forwards';
    
    // Gestisci la chiusura
    const closeButton = toast.querySelector('.toast-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => toast.remove(), 300);
        });
    }
    
    // Auto-chiusura
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add('toast-fade-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
    
    return toast;
}

// Mostra un indicatore di caricamento
function showLoading(message = 'Caricamento...') {
    const loading = document.createElement('div');
    loading.className = 'loading-overlay';
    loading.innerHTML = `
        <div class="loading-spinner"></div>
        <p>${message}</p>
    `;
    
    document.body.appendChild(loading);
    document.body.style.overflow = 'hidden'; // Blocca lo scorrimento
    
    return loading;
}

// Nascondi l'indicatore di caricamento
function hideLoading(loadingElement) {
    if (loadingElement && loadingElement.parentNode) {
        loadingElement.remove();
    }
    document.body.style.overflow = ''; // Ripristina lo scorrimento
}

// Formatta una data in formato leggibile in italiano
function formatDate(dateString) {
    const options = { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', options).replace(',', ' alle');
}

// Converti minuti in formato leggibile (es. 1h 30m). Accetta anche stringhe HH:MM:SS.
function formatDuration(minutes) {
    if (!minutes) return '0 min';

    if (typeof minutes === 'string' && minutes.includes(':')) {
        const parts = minutes.split(':');
        if (parts.length === 3) {
            minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        } else {
            minutes = parseInt(parts[0]);
        }
    } else {
        minutes = parseInt(minutes) || 0;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
    }
    return `${minutes}m`;
}

// Escape HTML per prevenire XSS quando si inietta testo via innerHTML
function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Popup di conferma elegante (sostituto del confirm() nativo) ────────────
// Ritorna una Promise<boolean>. Uso:
//   if (await window.showConfirm({ message: '...', danger: true })) { ... }
function ensureConfirmStyles() {
    if (document.getElementById('app-confirm-styles')) return;
    const style = document.createElement('style');
    style.id = 'app-confirm-styles';
    style.textContent = `
.app-confirm-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease}
.app-confirm-overlay.is-open{opacity:1}
.app-confirm{background:#fff;border-radius:18px;max-width:380px;width:100%;padding:26px 24px 20px;text-align:center;box-shadow:0 24px 60px rgba(15,23,42,.35);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}
.app-confirm-overlay.is-open .app-confirm{transform:translateY(0) scale(1)}
.app-confirm-icon{width:60px;height:60px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;background:#eef2ff;color:#4361ee}
.app-confirm-icon.danger{background:#fee2e2;color:#dc2626}
.app-confirm-title{font-size:1.15rem;font-weight:700;color:#1a1a2e;margin:0 0 6px}
.app-confirm-msg{font-size:.92rem;color:#6b7280;line-height:1.5;margin:0 0 20px}
.app-confirm-actions{display:flex;gap:10px}
.app-confirm-btn{flex:1;padding:11px 16px;border-radius:10px;font-size:.92rem;font-weight:600;cursor:pointer;border:1.5px solid transparent;font-family:inherit;transition:background .15s,transform .1s}
.app-confirm-btn:active{transform:scale(.97)}
.app-confirm-cancel{background:#f3f4f6;color:#4b5563}
.app-confirm-cancel:hover{background:#e5e7eb}
.app-confirm-ok{background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff}
.app-confirm-ok:hover{opacity:.92}
.app-confirm-ok.danger{background:linear-gradient(135deg,#ef4444,#dc2626)}`;
    document.head.appendChild(style);
}

function showConfirm(opts) {
    opts = opts || {};
    const title       = opts.title       || 'Conferma';
    const message     = opts.message     || '';
    const confirmText = opts.confirmText || 'Conferma';
    const cancelText  = opts.cancelText  || 'Annulla';
    const danger      = !!opts.danger;

    ensureConfirmStyles();

    return new Promise(function (resolve) {
        const overlay = document.createElement('div');
        overlay.className = 'app-confirm-overlay';
        const safeMsg = escapeHtml(message).replace(/\n/g, '<br>');
        const icon = danger ? 'fa-exclamation-triangle' : 'fa-question-circle';
        overlay.innerHTML =
            '<div class="app-confirm" role="dialog" aria-modal="true">' +
                '<div class="app-confirm-icon ' + (danger ? 'danger' : '') + '"><i class="fas ' + icon + '"></i></div>' +
                '<h3 class="app-confirm-title">' + escapeHtml(title) + '</h3>' +
                '<p class="app-confirm-msg">' + safeMsg + '</p>' +
                '<div class="app-confirm-actions">' +
                    '<button class="app-confirm-btn app-confirm-cancel">' + escapeHtml(cancelText) + '</button>' +
                    '<button class="app-confirm-btn app-confirm-ok ' + (danger ? 'danger' : '') + '">' + escapeHtml(confirmText) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('is-open'); });

        function cleanup(result) {
            overlay.classList.remove('is-open');
            document.removeEventListener('keydown', onKey);
            setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 200);
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        }
        overlay.querySelector('.app-confirm-cancel').addEventListener('click', function () { cleanup(false); });
        overlay.querySelector('.app-confirm-ok').addEventListener('click', function () { cleanup(true); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', onKey);
        setTimeout(function () { const b = overlay.querySelector('.app-confirm-ok'); if (b) b.focus(); }, 50);
    });
}

// Genera un ID univoco
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Ottieni l'URL base dell'applicazione
function getBaseUrl() {
    return window.location.origin;
}

// Verifica se un utente è autenticato
async function checkUserAuthentication() {
    if (!window.supabaseClient) {
        console.error('Client Supabase non disponibile');
        return null;
    }
    
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        
        if (error) {
            console.error('Errore durante la verifica della sessione:', error);
            return null;
        }
        
        if (!session) {
            console.warn('Nessuna sessione attiva');
            return null;
        }
        
        return session;
    } catch (error) {
        console.error('Errore durante la verifica dell\'autenticazione:', error);
        return null;
    }
}

// Esponi le funzioni globalmente
window.showToast = showToast;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.formatDate = formatDate;
window.formatDuration = formatDuration;
window.escapeHtml = escapeHtml;
window.showConfirm = showConfirm;
window.generateUniqueId = generateUniqueId;
window.getBaseUrl = getBaseUrl;
window.checkUserAuthentication = checkUserAuthentication;