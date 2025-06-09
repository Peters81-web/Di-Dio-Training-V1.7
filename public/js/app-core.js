/**
 * app-core.js
 * Funzioni core centralizzate per l'applicazione Di Dio Training
 * Elimina duplicazioni e centralizza la logica comune
 */

// ===== CONFIGURAZIONE GLOBALE =====
window.AppCore = {
    // UUID delle attività - UNICA FONTE DI VERITÀ
    activityUuids: {
        '1': 'af12a17d-cca9-4cd3-a4f8-029d1208525f', // Corsa
        '2': '2ba50271-cd8c-4b87-8fd2-8c6d15af9078', // Ciclismo (Bicicletta)
        '3': '57c626f0-43fe-42bf-b306-67554c4eabaa', // Nuoto
        '4': '8e7e2208-4590-44a7-a317-499323f371c4', // Forza
        '5': '8deb591f-d67c-4e63-ad48-beb755814068'  // Yoga
    },
    
    // Mappatura inversa UUID -> ID
    uuidToActivityMap: {
        'af12a17d-cca9-4cd3-a4f8-029d1208525f': 1, // Corsa
        '2ba50271-cd8c-4b87-8fd2-8c6d15af9078': 2, // Ciclismo (Bicicletta)
        '57c626f0-43fe-42bf-b306-67554c4eabaa': 3, // Nuoto
        '8e7e2208-4590-44a7-a317-499323f371c4': 4, // Forza
        '8deb591f-d67c-4e63-ad48-beb755814068': 5  // Yoga
    },
    
    // Icone delle attività
    activityIcons: {
        'corsa': 'fa-running',
        'ciclismo': 'fa-bicycle',
        'nuoto': 'fa-person-swimming',
        'forza': 'fa-dumbbell',
        'yoga': 'fa-om',
        'default': 'fa-dumbbell'
    }
};

// ===== AUTENTICAZIONE =====
window.AppCore.checkAuth = async function() {
    try {
        const supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            console.error('Client Supabase non disponibile');
            window.location.href = '/';
            return null;
        }
        
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error) {
            console.error('Errore durante il controllo della sessione:', error);
            window.location.href = '/';
            return null;
        }
        
        if (!session) {
            console.log('Nessuna sessione attiva');
            window.location.href = '/';
            return null;
        }
        
        return session;
    } catch (error) {
        console.error('Errore di autenticazione:', error);
        window.location.href = '/';
        return null;
    }
};

// ===== GESTIONE MODAL =====
window.AppCore.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } else {
        console.error(`Modal con ID '${modalId}' non trovata`);
    }
};

window.AppCore.closeModal = function(modalId) {
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
};

// ===== NOTIFICHE TOAST =====
window.AppCore.showToast = function(message, type = 'info', duration = 3000) {
    // Usa la funzione già esistente in utils.js
    if (window.showToast) {
        return window.showToast(message, type, duration);
    }
    
    // Fallback se utils.js non è caricato
    alert(message);
};

// ===== LOADING OVERLAY =====
window.AppCore.showLoading = function(message = 'Caricamento...') {
    // Usa la funzione già esistente in utils.js
    if (window.showLoading) {
        return window.showLoading(message);
    }
    
    // Fallback
    const loading = document.createElement('div');
    loading.className = 'loading-overlay';
    loading.innerHTML = `
        <div class="loading-spinner"></div>
        <p>${message}</p>
    `;
    document.body.appendChild(loading);
    return loading;
};

window.AppCore.hideLoading = function(loadingElement) {
    // Usa la funzione già esistente in utils.js
    if (window.hideLoading) {
        return window.hideLoading(loadingElement);
    }
    
    // Fallback
    if (loadingElement && loadingElement.parentNode) {
        loadingElement.remove();
    }
};

// ===== FORMATTAZIONE =====
window.AppCore.formatDuration = function(minutes) {
    if (!minutes) return '0 min';
    
    // Se è una stringa in formato HH:MM:SS
    if (typeof minutes === 'string' && minutes.includes(':')) {
        const parts = minutes.split(':');
        if (parts.length === 3) {
            // Caso speciale per il formato 00:00:XX (minuti)
            if (parts[0] === '00' && parts[1] === '00') {
                minutes = parseInt(parts[2]);
            } else {
                minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            }
        } else if (parts.length === 2) {
            minutes = parseInt(parts[0]);
        }
    } else {
        minutes = parseInt(minutes) || 0;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0) {
        return `${hours}h ${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
    } else {
        return `${minutes}m`;
    }
};

// ===== UTILITY ATTIVITÀ =====
window.AppCore.getActivityIcon = function(activityId) {
    // Se è un UUID, convertilo prima in tipo
    if (typeof activityId === 'string' && activityId.includes('-')) {
        const numericId = window.AppCore.uuidToActivityMap[activityId];
        const activityTypes = ['', 'corsa', 'ciclismo', 'nuoto', 'forza', 'yoga'];
        const activityType = activityTypes[numericId] || 'default';
        return window.AppCore.activityIcons[activityType];
    }
    
    // Se è numerico
    const activityTypes = ['', 'corsa', 'ciclismo', 'nuoto', 'forza', 'yoga'];
    const activityType = activityTypes[activityId] || 'default';
    return window.AppCore.activityIcons[activityType];
};

window.AppCore.getActivityUuid = function(activityId) {
    // Se è già un UUID, restituiscilo
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(activityId)) {
        return activityId;
    }
    
    // Altrimenti converti
    return window.AppCore.activityUuids[activityId] || null;
};

// ===== LOGOUT GLOBALE =====
window.AppCore.logout = async function() {
    try {
        const supabaseClient = window.supabaseClient;
        if (!supabaseClient) {
            throw new Error('Client Supabase non disponibile');
        }
        
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        
        window.location.href = '/';
    } catch (error) {
        console.error('Errore durante il logout:', error);
        window.AppCore.showToast('Errore durante il logout', 'error');
    }
};

// ===== INIZIALIZZAZIONE LOGOUT BUTTONS =====
window.AppCore.initLogoutButtons = function() {
    document.querySelectorAll('#logoutBtn, .logout-btn').forEach(btn => {
        btn.addEventListener('click', window.AppCore.logout);
    });
};

// ===== RICH TEXT EDITOR UTILITIES =====
window.AppCore.getRichTextContent = function(editorId) {
    const editor = document.getElementById(editorId);
    if (!editor) return '';
    
    // Clona per non modificare l'originale
    const clone = editor.cloneNode(true);
    
    // Rimuovi placeholder
    const placeholder = clone.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    
    return clone.innerHTML.trim();
};

window.AppCore.setRichTextContent = function(editorId, content) {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    
    if (!content || content.trim() === '') {
        const placeholder = editor.getAttribute('data-placeholder');
        if (placeholder) {
            editor.innerHTML = `<span class="placeholder">${placeholder}</span>`;
        } else {
            editor.innerHTML = '';
        }
    } else {
        editor.innerHTML = content;
    }
};

// Inizializza gli editor di testo ricco con comportamento placeholder corretto
window.AppCore.initRichTextEditors = function() {
    document.querySelectorAll('.rich-text-editor').forEach(editor => {
        const placeholder = editor.getAttribute('data-placeholder');
        
        // Se l'editor è vuoto, mostra il placeholder
        if (placeholder && (editor.innerHTML.trim() === '' || editor.innerHTML === '<br>')) {
            editor.innerHTML = `<span class="placeholder">${placeholder}</span>`;
        }
        
        // Rimuovi il placeholder al focus
        editor.addEventListener('focus', function() {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl) {
                this.innerHTML = '';
            }
        });
        
        // Ripristina il placeholder se vuoto al blur
        editor.addEventListener('blur', function() {
            if (this.innerHTML.trim() === '' || this.innerHTML === '<br>') {
                this.innerHTML = `<span class="placeholder">${placeholder}</span>`;
            }
        });
        
        // IMPORTANTE: Rimuovi il placeholder appena si inizia a digitare
        editor.addEventListener('input', function() {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl) {
                // Salva la posizione del cursore
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                
                // Rimuovi il placeholder
                placeholderEl.remove();
                
                // Ripristina il focus e la posizione del cursore
                this.focus();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
        
        // Gestisci anche il keydown per catturare il primo carattere
        editor.addEventListener('keydown', function(e) {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
                // Rimuovi il placeholder prima che venga inserito il carattere
                placeholderEl.remove();
            }
        });
    });
};

window.AppCore.initMobileMenu = function() {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navLinks = document.getElementById('navLinks');
    
    if (mobileMenuToggle && navLinks) {
        mobileMenuToggle.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            
            const icon = this.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
            }
        });
        
        // Chiudi il menu quando si clicca su un link
        const navButtons = navLinks.querySelectorAll('a, button');
        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                navLinks.classList.remove('active');
                const icon = mobileMenuToggle.querySelector('i');
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-times');
                }
            });
        });
        
        // Chiudi il menu quando si clicca fuori
        document.addEventListener('click', function(e) {
            if (!mobileMenuToggle.contains(e.target) && !navLinks.contains(e.target)) {
                navLinks.classList.remove('active');
                const icon = mobileMenuToggle.querySelector('i');
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-times');
                }
            }
        });
    }
};


// ===== GESTIONE ERRORI GLOBALE =====
window.addEventListener('error', function(e) {
    console.error('Errore globale:', e.error);
    
    // Non mostrare toast per errori di rete comuni durante lo sviluppo
    if (!e.message.includes('NetworkError') && !e.message.includes('Failed to fetch')) {
        window.AppCore.showToast('Si è verificato un errore imprevisto', 'error');
    }
});

// ===== INIT ON DOM READY =====
document.addEventListener('DOMContentLoaded', function() {
    // Inizializza i pulsanti di logout
    window.AppCore.initLogoutButtons();
    
    // Aggiungi listener per chiudere i modal cliccando fuori
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            window.AppCore.closeModal(e.target);
        }
    });
    
    // Listener per i pulsanti di chiusura modal
    document.querySelectorAll('.modal-close, .close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                window.AppCore.closeModal(modal);
            }
        });
    });
});

// Esponi le funzioni principali globalmente per retrocompatibilità
window.openModal = window.AppCore.openModal;
window.closeModal = window.AppCore.closeModal;
window.formatDuration = window.AppCore.formatDuration;