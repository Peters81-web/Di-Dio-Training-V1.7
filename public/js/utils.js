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
window.generateUniqueId = generateUniqueId;
window.getBaseUrl = getBaseUrl;
window.checkUserAuthentication = checkUserAuthentication;