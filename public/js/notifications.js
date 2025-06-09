/**
 * notifications.js - Sistema di notifiche per l'app DiDio Training
 * Gestisce le notifiche per allenamenti, obiettivi e progressi
 */

// Inizializzazione del sistema di notifiche
document.addEventListener('DOMContentLoaded', async function() {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    
    // Variabili globali
    let currentUser = null;
    let notifications = [];
    let hasUnreadNotifications = false;
    
    // Elementi UI
    const notificationContainer = document.createElement('div');
    notificationContainer.className = 'notification-container';
    document.body.appendChild(notificationContainer);
    
    // Inizializzazione
    async function init() {
        try {
            // Verifica autenticazione
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error || !session) {
                console.warn('Utente non autenticato');
                return;
            }
            
            currentUser = session.user;
            
            // Carica le preferenze di notifica dell'utente
            await loadNotificationPreferences();
            
            // Carica le notifiche
            await loadNotifications();
            
            // Aggiorna i badge di notifica
            updateNotificationBadges();
            
            // Setup event listener per mostrare/nascondere pannello notifiche
            setupNotificationPanel();
            
            // Attiva il polling delle notifiche (ogni 5 minuti)
            setInterval(checkNewNotifications, 5 * 60 * 1000);
            
            console.log('Sistema di notifiche inizializzato');
        } catch (error) {
            console.error('Errore nell\'inizializzazione del sistema di notifiche:', error);
        }
    }
    
async function updateNotificationPreferences(settings) {
    try {
        // Verifica se l'utente è autenticato
        if (!currentUser || !currentUser.id) {
            console.error('Utente non autenticato');
            return false;
        }
        
        // Aggiorna le preferenze di notifica nel database
        const { error } = await supabaseClient
            .from('user_preferences')
            .upsert({
                user_id: currentUser.id,
                notification_settings: settings,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });
            
        if (error) throw error;
        
        console.log('Preferenze di notifica aggiornate con successo');
        return true;
    } catch (error) {
        console.error('Errore nell\'aggiornamento delle preferenze di notifica:', error);
        return false;
    }
}

    // Carica le preferenze di notifica
async function loadNotificationPreferences() {
    try {
        // Verifica se l'utente è autenticato
        if (!currentUser || !currentUser.id) {
            console.error('Utente non autenticato');
            return {};
        }
        
        const { data, error } = await supabaseClient
            .from('user_preferences')
            .select('notification_settings')
            .eq('user_id', currentUser.id);
            
        if (error) throw error;
        
        // Impostazioni predefinite
        const defaultSettings = {
            email_notifications: true,
            push_notifications: true,
            workout_reminders: true
        };
        
        // Gestisci il caso in cui non ci sono record o notification_settings è nullo
        if (!data || data.length === 0 || !data[0]?.notification_settings) {
            console.log('Preferenze di notifica non trovate o vuote, utilizzo impostazioni predefinite...');
            
            // Aggiorna o crea il record con le impostazioni predefinite
            await updateNotificationPreferences(defaultSettings);
            
            return defaultSettings;
        }
        
        return data[0].notification_settings;
    } catch (error) {
        console.error('Errore nel caricamento delle preferenze di notifica:', error);
        // Ritorna preferenze predefinite in caso di errore
        return {
            email_notifications: true,
            push_notifications: true,
            workout_reminders: true
        };
    }
}

// Aggiungi questa funzione per creare le preferenze predefinite
async function createDefaultNotificationPreferences() {
    try {
        // Crea valori predefiniti
        const defaultSettings = {
            email_notifications: true,
            push_notifications: true,
            workout_reminders: true
        };
        
        // Inserisci il record predefinito
        const { data, error } = await supabaseClient
            .from('user_preferences')
            .insert([{
                user_id: currentUser.id,
                notification_settings: defaultSettings
            }])
            .select();
            
        if (error) throw error;
        
        return defaultSettings;
    } catch (error) {
        console.error('Errore nella creazione delle preferenze predefinite:', error);
        return {};
    }
}
    
    // Salva le preferenze di notifica predefinite
    async function saveDefaultNotificationPreferences() {
        try {
            const defaultPreferences = {
                user_id: currentUser.id,
                notification_settings: {
                    workout_reminders: true,
                    goal_updates: true,
                    achievement_alerts: true,
                    system_notifications: true,
                    email_notifications: true
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            const { error } = await supabaseClient
                .from('user_preferences')
                .upsert([defaultPreferences]);
                
            if (error) {
                console.error('Errore nel salvataggio delle preferenze predefinite:', error);
            }
        } catch (error) {
            console.error('Errore durante il salvataggio delle preferenze predefinite:', error);
        }
    }
    
    // Carica le notifiche
    async function loadNotifications() {
        try {
            const { data, error } = await supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(20);
                
            if (error) {
                console.error('Errore nel caricamento delle notifiche:', error);
                return;
            }
            
            notifications = data || [];
            
            // Controlla se ci sono notifiche non lette
            hasUnreadNotifications = notifications.some(notification => !notification.read);
        } catch (error) {
            console.error('Errore durante il caricamento delle notifiche:', error);
        }
    }
    
    // Controlla se ci sono nuove notifiche
    async function checkNewNotifications() {
        if (!currentUser) return;
        
        try {
            // Ottieni la data dell'ultima notifica
            let latestTimestamp = null;
            if (notifications.length > 0) {
                latestTimestamp = notifications[0].created_at;
            }
            
            // Cerca nuove notifiche
            const query = supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(5);
                
            if (latestTimestamp) {
                query.gt('created_at', latestTimestamp);
            }
            
            const { data, error } = await query;
            
            if (error) {
                console.error('Errore nel controllo delle nuove notifiche:', error);
                return;
            }
            
            // Se ci sono nuove notifiche, aggiorna l'array e mostra un popup
            if (data && data.length > 0) {
                // Aggiungi le nuove notifiche all'inizio dell'array
                notifications = [...data, ...notifications];
                
                // Limita l'array a 20 notifiche
                if (notifications.length > 20) {
                    notifications = notifications.slice(0, 20);
                }
                
                // Aggiorna i badge
                hasUnreadNotifications = true;
                updateNotificationBadges();
                
                // Mostra un toast per la nuova notifica
                showNotificationToast(data[0]);
            }
        } catch (error) {
            console.error('Errore durante il controllo delle nuove notifiche:', error);
        }
    }
    
    // Aggiorna i badge di notifica
    function updateNotificationBadges() {
        // Trova tutti i badge di notifica e li aggiorna
        const badges = document.querySelectorAll('.notification-badge');
        
        if (hasUnreadNotifications) {
            // Conta le notifiche non lette
            const unreadCount = notifications.filter(notification => !notification.read).length;
            
            badges.forEach(badge => {
                badge.textContent = unreadCount;
                badge.style.display = 'inline-flex';
            });
        } else {
            badges.forEach(badge => {
                badge.style.display = 'none';
            });
        }
    }
    
    // Setup del pannello delle notifiche
    function setupNotificationPanel() {
        // Cerca tutti i pulsanti di notifica
        const notificationButtons = document.querySelectorAll('#notificationsBtn');
        
        notificationButtons.forEach(button => {
            button.addEventListener('click', toggleNotificationPanel);
        });
    }
    
    // Mostra/nascondi il pannello delle notifiche
    function toggleNotificationPanel() {
        // Verifica se il pannello esiste già
        let panel = document.getElementById('notificationPanel');
        
        if (panel) {
            // Se il pannello è già aperto, lo chiude
            panel.remove();
            return;
        }
        
        // Crea il pannello
        panel = document.createElement('div');
        panel.id = 'notificationPanel';
        panel.className = 'notification-panel';
        
        // Intestazione del pannello
        const header = document.createElement('div');
        header.className = 'notification-panel-header';
        header.innerHTML = `
            <h3>Notifiche</h3>
            <button id="closeNotificationsBtn" class="btn-icon">
                <i class="fas fa-times"></i>
            </button>
        `;
        panel.appendChild(header);
        
        // Contenuto del pannello
        const content = document.createElement('div');
        content.className = 'notification-panel-content';
        
        if (notifications.length === 0) {
            content.innerHTML = `
                <div class="no-notifications">
                    <i class="fas fa-bell-slash"></i>
                    <p>Nessuna notifica</p>
                </div>
            `;
        } else {
            // Elenca le notifiche
            notifications.forEach(notification => {
                const notificationItem = document.createElement('div');
                notificationItem.className = `notification-item ${notification.read ? '' : 'unread'}`;
                notificationItem.dataset.id = notification.id;
                
                // Determina l'icona in base al tipo
                let icon = 'fa-bell';
                let iconClass = '';
                
                switch (notification.type) {
                    case 'workout_reminder':
                        icon = 'fa-dumbbell';
                        iconClass = 'workout-icon';
                        break;
                    case 'goal_update':
                        icon = 'fa-bullseye';
                        iconClass = 'goal-icon';
                        break;
                    case 'achievement':
                        icon = 'fa-trophy';
                        iconClass = 'achievement-icon';
                        break;
                    case 'system':
                        icon = 'fa-cog';
                        iconClass = 'system-icon';
                        break;
                }
                
                // Data e ora formattate
                const date = new Date(notification.created_at);
                const formattedDate = date.toLocaleDateString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
                
                const timeAgo = getTimeAgo(date);
                
                notificationItem.innerHTML = `
                    <div class="notification-icon ${iconClass}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${notification.title}</div>
                        <div class="notification-message">${notification.message}</div>
                        <div class="notification-time" title="${formattedDate}">${timeAgo}</div>
                    </div>
                    <div class="notification-actions">
                        <button class="btn-icon mark-read-btn" title="Segna come letto">
                            <i class="fas ${notification.read ? 'fa-envelope-open' : 'fa-envelope'}"></i>
                        </button>
                    </div>
                `;
                
                // Aggiungi evento per segnare come letto
                const markReadBtn = notificationItem.querySelector('.mark-read-btn');
                markReadBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Evita che il click si propaghi all'intero item
                    markNotificationAsRead(notification.id);
                });
                
                // Aggiungi evento per aprire la notifica
                notificationItem.addEventListener('click', () => {
                    openNotification(notification);
                });
                
                content.appendChild(notificationItem);
            });
        }
        
        panel.appendChild(content);
        
        // Footer del pannello
        const footer = document.createElement('div');
        footer.className = 'notification-panel-footer';
        footer.innerHTML = `
            <button id="markAllReadBtn" class="btn btn-sm">
                Segna tutti come letti
            </button>
            <button id="notificationSettingsBtn" class="btn btn-sm">
                Impostazioni
            </button>
        `;
        panel.appendChild(footer);
        
        // Aggiungi il pannello al body
        document.body.appendChild(panel);
        
        // Posiziona il pannello
        positionNotificationPanel(panel);
        
        // Aggiungi event listeners per i pulsanti del pannello
        document.getElementById('closeNotificationsBtn').addEventListener('click', () => {
            panel.remove();
        });
        
        document.getElementById('markAllReadBtn').addEventListener('click', markAllNotificationsAsRead);
        
        document.getElementById('notificationSettingsBtn').addEventListener('click', openNotificationSettings);
        
        // Segna automaticamente come lette le notifiche visualizzate
        setTimeout(() => {
            const visibleNotifications = Array.from(document.querySelectorAll('.notification-item.unread'))
                .map(item => item.dataset.id);
                
            if (visibleNotifications.length > 0) {
                markNotificationsAsRead(visibleNotifications);
            }
        }, 2000);
        
        // Chiudi il pannello cliccando fuori
        document.addEventListener('click', function closePanel(e) {
            if (panel && !panel.contains(e.target) && e.target.id !== 'notificationsBtn') {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        });
    }
    
    // Posiziona il pannello delle notifiche
    function positionNotificationPanel(panel) {
        const notificationBtn = document.getElementById('notificationsBtn');
        
        if (notificationBtn) {
            const rect = notificationBtn.getBoundingClientRect();
            const panelWidth = 350;
            
            // Posiziona il pannello sotto il pulsante
            panel.style.position = 'fixed';
            panel.style.top = (rect.bottom + 10) + 'px';
            panel.style.right = (window.innerWidth - rect.right) + 'px';
            panel.style.width = panelWidth + 'px';
            panel.style.maxHeight = '80vh';
            panel.style.overflowY = 'auto';
            panel.style.zIndex = '1000';
            panel.style.backgroundColor = 'white';
            panel.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';
            panel.style.borderRadius = '8px';
            panel.style.animation = 'fadeIn 0.3s ease-out';
        }
    }
    
    // Segna una notifica come letta
    async function markNotificationAsRead(notificationId) {
        try {
            const { error } = await supabaseClient
                .from('notifications')
                .update({ read: true })
                .eq('id', notificationId);
                
            if (error) {
                console.error('Errore nel segnare la notifica come letta:', error);
                return;
            }
            
            // Aggiorna lo stato locale
            const notification = notifications.find(n => n.id === notificationId);
            if (notification) {
                notification.read = true;
            }
            
            // Aggiorna l'elemento UI
            const notificationItem = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
            if (notificationItem) {
                notificationItem.classList.remove('unread');
                
                // Aggiorna l'icona
                const iconElement = notificationItem.querySelector('.mark-read-btn i');
                if (iconElement) {
                    iconElement.classList.remove('fa-envelope');
                    iconElement.classList.add('fa-envelope-open');
                }
            }
            
            // Verifica se ci sono ancora notifiche non lette
            hasUnreadNotifications = notifications.some(notification => !notification.read);
            updateNotificationBadges();
        } catch (error) {
            console.error('Errore durante il segnare la notifica come letta:', error);
        }
    }
    
    // Segna più notifiche come lette
    async function markNotificationsAsRead(notificationIds) {
        try {
            const { error } = await supabaseClient
                .from('notifications')
                .update({ read: true })
                .in('id', notificationIds);
                
            if (error) {
                console.error('Errore nel segnare le notifiche come lette:', error);
                return;
            }
            
            // Aggiorna lo stato locale
            notifications.forEach(notification => {
                if (notificationIds.includes(notification.id)) {
                    notification.read = true;
                }
            });
            
            // Aggiorna gli elementi UI
            notificationIds.forEach(id => {
                const notificationItem = document.querySelector(`.notification-item[data-id="${id}"]`);
                if (notificationItem) {
                    notificationItem.classList.remove('unread');
                    
                    // Aggiorna l'icona
                    const iconElement = notificationItem.querySelector('.mark-read-btn i');
                    if (iconElement) {
                        iconElement.classList.remove('fa-envelope');
                        iconElement.classList.add('fa-envelope-open');
                    }
                }
            });
            
            // Verifica se ci sono ancora notifiche non lette
            hasUnreadNotifications = notifications.some(notification => !notification.read);
            updateNotificationBadges();
        } catch (error) {
            console.error('Errore durante il segnare le notifiche come lette:', error);
        }
    }
    
    // Segna tutte le notifiche come lette
    async function markAllNotificationsAsRead() {
        try {
            const { error } = await supabaseClient
                .from('notifications')
                .update({ read: true })
                .eq('user_id', currentUser.id)
                .eq('read', false);
                
            if (error) {
                console.error('Errore nel segnare tutte le notifiche come lette:', error);
                return;
            }
            
            // Aggiorna lo stato locale
            notifications.forEach(notification => {
                notification.read = true;
            });
            
            // Aggiorna gli elementi UI
            document.querySelectorAll('.notification-item').forEach(item => {
                item.classList.remove('unread');
                
                // Aggiorna l'icona
                const iconElement = item.querySelector('.mark-read-btn i');
                if (iconElement) {
                    iconElement.classList.remove('fa-envelope');
                    iconElement.classList.add('fa-envelope-open');
                }
            });
            
            // Aggiorna i badge
            hasUnreadNotifications = false;
            updateNotificationBadges();
            
            // Mostra una conferma
            showToast('Tutte le notifiche sono state segnate come lette', 'success');
        } catch (error) {
            console.error('Errore durante il segnare tutte le notifiche come lette:', error);
        }
    }
    
    // Apri una notifica
    function openNotification(notification) {
        // Se la notifica non è stata letta, la segna come letta
        if (!notification.read) {
            markNotificationAsRead(notification.id);
        }
        
        // In base al tipo, reindirizza alla pagina appropriata
        switch (notification.type) {
            case 'workout_reminder':
                // Reindirizza alla pagina degli allenamenti
                window.location.href = `/workout?reminder=${notification.id}`;
                break;
            case 'goal_update':
                // Reindirizza alla pagina del profilo
                window.location.href = `/profile?goal=${notification.id}`;
                break;
            case 'achievement':
                // Reindirizza alla pagina delle statistiche
                window.location.href = `/stats?achievement=${notification.id}`;
                break;
            default:
                // Chiudi il pannello
                const panel = document.getElementById('notificationPanel');
                if (panel) {
                    panel.remove();
                }
        }
    }
    
    // Apri le impostazioni delle notifiche
    function openNotificationSettings() {
        // Chiudi il pannello delle notifiche
        const panel = document.getElementById('notificationPanel');
        if (panel) {
            panel.remove();
        }
        
        // Crea il modal delle impostazioni
        const settingsModal = document.createElement('div');
        settingsModal.id = 'notificationSettingsModal';
        settingsModal.className = 'modal';
        
        settingsModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Impostazioni Notifiche</h2>
                    <button class="modal-close" id="closeSettingsModalBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p>Scegli quali notifiche ricevere:</p>
                    
                    <div class="settings-group">
                        <label class="custom-checkbox">
                            <input type="checkbox" id="workoutRemindersSetting" checked>
                            <span class="checkmark"></span>
                            Promemoria allenamenti
                        </label>
                        
                        <label class="custom-checkbox">
                            <input type="checkbox" id="goalUpdatesSetting" checked>
                            <span class="checkmark"></span>
                            Aggiornamenti obiettivi
                        </label>
                        
                        <label class="custom-checkbox">
                            <input type="checkbox" id="achievementAlertsSetting" checked>
                            <span class="checkmark"></span>
                            Avvisi obiettivi raggiunti
                        </label>
                        
                        <label class="custom-checkbox">
                            <input type="checkbox" id="systemNotificationsSetting" checked>
                            <span class="checkmark"></span>
                            Notifiche di sistema
                        </label>
                    </div>
                    
                    <div class="settings-group">
                        <h3>Opzioni aggiuntive</h3>
                        <label class="custom-checkbox">
                            <input type="checkbox" id="emailNotificationsSetting" checked>
                            <span class="checkmark"></span>
                            Ricevi notifiche via email
                        </label>
                    </div>
                </div>
                <div class="modal-actions">
                    <button id="resetNotificationsBtn" class="btn btn-secondary">
                        <i class="fas fa-undo-alt"></i> Ripristina default
                    </button>
                    <button id="saveNotificationSettingsBtn" class="btn btn-primary">
                        <i class="fas fa-save"></i> Salva impostazioni
                    </button>
                </div>
            </div>
        `;
        
        // Aggiungi il modal al body
        document.body.appendChild(settingsModal);
        
        // Mostra il modal
        settingsModal.style.display = 'flex';
        
        // Carica le impostazioni attuali
        loadCurrentNotificationSettings();
        
        // Aggiungi event listeners
        document.getElementById('closeSettingsModalBtn').addEventListener('click', () => {
            settingsModal.remove();
        });
        
        document.getElementById('resetNotificationsBtn').addEventListener('click', resetNotificationSettings);
        
        document.getElementById('saveNotificationSettingsBtn').addEventListener('click', saveNotificationSettings);
        
        // Chiudi il modal cliccando fuori
        settingsModal.addEventListener('click', function(e) {
            if (e.target === settingsModal) {
                settingsModal.remove();
            }
        });
    }
    
    // Carica le impostazioni attuali
    async function loadCurrentNotificationSettings() {
        try {
            const { data, error } = await supabaseClient
                .from('user_preferences')
                .select('notification_settings')
                .eq('user_id', currentUser.id)
                .single();
                
            if (error) {
                console.error('Errore nel caricamento delle impostazioni di notifica:', error);
                return;
            }
            
            if (data && data.notification_settings) {
                const settings = data.notification_settings;
                
                // Imposta i checkbox
                document.getElementById('workoutRemindersSetting').checked = settings.workout_reminders !== false;
                document.getElementById('goalUpdatesSetting').checked = settings.goal_updates !== false;
                document.getElementById('achievementAlertsSetting').checked = settings.achievement_alerts !== false;
                document.getElementById('systemNotificationsSetting').checked = settings.system_notifications !== false;
                document.getElementById('emailNotificationsSetting').checked = settings.email_notifications !== false;
            }
        } catch (error) {
            console.error('Errore durante il caricamento delle impostazioni di notifica:', error);
        }
    }
    
    // Ripristina le impostazioni predefinite
    function resetNotificationSettings() {
        // Imposta tutti i checkbox su true
        document.getElementById('workoutRemindersSetting').checked = true;
        document.getElementById('goalUpdatesSetting').checked = true;
        document.getElementById('achievementAlertsSetting').checked = true;
        document.getElementById('systemNotificationsSetting').checked = true;
        document.getElementById('emailNotificationsSetting').checked = true;
        
        // Mostra un messaggio
        showToast('Impostazioni ripristinate', 'info');
    }
    
    // Salva le impostazioni delle notifiche
    async function saveNotificationSettings() {
        try {
            const settings = {
                workout_reminders: document.getElementById('workoutRemindersSetting').checked,
                goal_updates: document.getElementById('goalUpdatesSetting').checked,
                achievement_alerts: document.getElementById('achievementAlertsSetting').checked,
                system_notifications: document.getElementById('systemNotificationsSetting').checked,
                email_notifications: document.getElementById('emailNotificationsSetting').checked
            };
            
            const { error } = await supabaseClient
                .from('user_preferences')
                .update({ 
                    notification_settings: settings,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', currentUser.id);
                
            if (error) {
                console.error('Errore nel salvataggio delle impostazioni di notifica:', error);
                showToast('Errore nel salvataggio delle impostazioni', 'error');
                return;
            }
            
            // Chiudi il modal
            const modal = document.getElementById('notificationSettingsModal');
            if (modal) {
                modal.remove();
            }
            
            // Mostra una conferma
            showToast('Impostazioni salvate con successo', 'success');
        } catch (error) {
            console.error('Errore durante il salvataggio delle impostazioni:', error);
            showToast('Errore nel salvataggio delle impostazioni', 'error');
        }
    }
    
    // Mostra un toast di notifica
    function showNotificationToast(notification) {
        // Crea un elemento toast
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        
        // Determina l'icona in base al tipo
        let icon = 'fa-bell';
        let iconClass = '';
        
        switch (notification.type) {
            case 'workout_reminder':
                icon = 'fa-dumbbell';
                iconClass = 'workout-icon';
                break;
            case 'goal_update':
                icon = 'fa-bullseye';
                iconClass = 'goal-icon';
                break;
            case 'achievement':
                icon = 'fa-trophy';
                iconClass = 'achievement-icon';
                break;
            case 'system':
                icon = 'fa-cog';
                iconClass = 'system-icon';
                break;
        }
        
        toast.innerHTML = `
            <div class="notification-toast-icon ${iconClass}">
                <i class="fas ${icon}"></i>
            </div>
            <div class="notification-toast-content">
                <div class="notification-toast-title">${notification.title}</div>
                <div class="notification-toast-message">${notification.message}</div>
            </div>
            <button class="notification-toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Aggiungi il toast al container
        notificationContainer.appendChild(toast);
        
        // Aggiungi l'evento di click per aprire la notifica
        toast.addEventListener('click', (e) => {
            if (!e.target.closest('.notification-toast-close')) {
                openNotification(notification);
                toast.remove();
            }
        });
        
        // Aggiungi l'evento di chiusura
        toast.querySelector('.notification-toast-close').addEventListener('click', (e) => {
            e.stopPropagation();
            toast.classList.add('closing');
            setTimeout(() => {
                toast.remove();
            }, 300);
        });
        
        // Chiudi automaticamente dopo 5 secondi
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('closing');
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }
        }, 5000);
    }
    
    // Ottieni il tempo trascorso in formato leggibile
    function getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        
        if (diffSec < 60) {
            return 'proprio ora';
        } else if (diffMin < 60) {
            return `${diffMin} min fa`;
        } else if (diffHour < 24) {
            return `${diffHour} ore fa`;
        } else if (diffDay < 7) {
            return `${diffDay} giorni fa`;
        } else {
            return date.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit'
            });
        }
    }
    
    // Inizializza il sistema di notifiche
    init();
});