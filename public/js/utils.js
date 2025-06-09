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

// Converti secondi in formato leggibile (es. 1h 30m)
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes > 0 ? minutes + 'm' : ''}`;
    }
    
    return `${minutes}m`;
}

// Genera un ID univoco
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Ottieni l'URL base dell'applicazione
function getBaseUrl() {
    return window.location.origin;
}

// Ottieni il nome di un'attività dal suo ID
function getActivityNameById(activityId) {
    const activityMap = {
        1: 'Corsa',
        2: 'Ciclismo',
        3: 'Nuoto',
        4: 'Forza',
        5: 'Yoga'
    };
    
    return activityMap[activityId] || 'Attività sconosciuta';
}

// Ottieni l'icona di un'attività dal suo ID
function getActivityIconById(activityId) {
    const iconMap = {
        1: 'fa-running',
        2: 'fa-bicycle',
        3: 'fa-person-swimming',
        4: 'fa-dumbbell',
        5: 'fa-om',
        'default': 'fa-dumbbell'
    };
    
    return iconMap[activityId] || iconMap.default;
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
window.generateUniqueId = generateUniqueId;
window.getBaseUrl = getBaseUrl;
window.getActivityNameById = getActivityNameById;
window.getActivityIconById = getActivityIconById;
window.checkUserAuthentication = checkUserAuthentication;