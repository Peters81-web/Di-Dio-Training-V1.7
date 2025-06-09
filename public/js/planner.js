// Planner management - Versione corretta
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Inizializzazione pagina planner...');
    
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    
    if (!supabaseClient) {
        console.error('Client Supabase non disponibile');
        showToast('Errore: Client Supabase non disponibile', 'error');
        return;
    }
    
    // Verifica autenticazione con retry
    const checkAuth = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                console.log(`Tentativo di autenticazione ${i + 1}/${retries}...`);
                
                const { data: { session }, error } = await supabaseClient.auth.getSession();
                
                if (error) {
                    console.error('Errore nella verifica della sessione:', error);
                    if (i === retries - 1) throw error;
                    continue;
                }
                
                if (!session || !session.user) {
                    console.warn('Nessuna sessione attiva trovata');
                    if (i === retries - 1) {
                        // Ultimo tentativo fallito, reindirizza
                        showToast('Sessione scaduta, reindirizzamento al login...', 'warning');
                        setTimeout(() => {
                            window.location.href = '/';
                        }, 2000);
                        return null;
                    }
                    continue;
                }
                
                console.log('Autenticazione riuscita:', session.user.email);
                return session;
                
            } catch (error) {
                console.error('Errore durante il controllo autenticazione:', error);
                if (i === retries - 1) {
                    showToast('Errore di autenticazione: ' + error.message, 'error');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                    return null;
                }
                
                // Aspetta un po' prima del prossimo tentativo
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return null;
    };
    
    // Carica programmi attivi
    const loadActivePrograms = async () => {
        const loading = showLoading();
        try {
            const session = await checkAuth();
            if (!session) return;
            
            console.log('Caricamento programmi per utente:', session.user.id);
            
            const { data: programs, error } = await supabaseClient
                .from('training_programs')
                .select(`
                    *,
                    scheduled_workouts!fk_program_unique (
                        *,
                        workout_plans (
                            *,
                            activities (*)
                        )
                    )
                `)
                .eq('user_id', session.user.id)
                .order('start_date', { ascending: true });
           
            if (error) {
                console.error('Errore nel caricamento dei programmi:', error);
                throw error;
            }
            
            console.log('Programmi caricati:', programs?.length || 0);
            
            const programsList = document.getElementById('programsList');
            if (!programsList) {
                console.error('Elemento programsList non trovato nel DOM');
                return;
            }
            
            if (!programs || programs.length === 0) {
                programsList.innerHTML = `
                    <div class="no-programs">
                        <i class="fas fa-calendar-plus"></i>
                        <h3>Nessun programma trovato</h3>
                        <p>Inizia creando il tuo primo programma di allenamento!</p>
                    </div>
                `;
                return;
            }
            
            renderPrograms(programs);
            
        } catch (error) {
            console.error('Errore completo nel caricamento:', error);
            showToast(`Errore caricamento programmi: ${error.message}`, 'error');
        } finally {
            hideLoading(loading);
        }
    };
    
    // Renderizza programmi
    const renderPrograms = (programs) => {
        const programsList = document.getElementById('programsList');
        if (!programsList) return;
        
        programsList.innerHTML = programs.map(program => `
            <div class="program-card">
                <div class="program-header">
                    <h3>${program.name}</h3>
                    <span class="program-status status-${program.status}">
                        ${program.status === 'in_progress' ? 'In Corso' : 'Pianificato'}
                    </span>
                </div>
                <p class="program-description">${program.description || 'Nessuna descrizione'}</p>
                <div class="program-details">
                    <div class="detail-item">
                        <i class="fas fa-calendar-week"></i>
                        <span>${program.duration_weeks} settimane</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-calendar-day"></i>
                        <span>${new Date(program.start_date).toLocaleDateString('it-IT')}</span>
                    </div>
                </div>
                <div class="upcoming-workouts">
                    <h4><i class="fas fa-dumbbell"></i> Prossimi Allenamenti</h4>
                    ${renderUpcomingWorkouts(program.scheduled_workouts)}
                </div>
                <div class="program-actions">
                    <button class="btn btn-danger delete-program-btn" data-program-id="${program.id}">
                        <i class="fas fa-trash"></i> Elimina
                    </button>
                </div>
            </div>
        `).join('');
        
        // Aggiungi event listeners ai pulsanti delete
        document.querySelectorAll('.delete-program-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                const programId = e.currentTarget.dataset.programId;
                await confirmDeleteProgram(programId);
            });
        });
    };
    
    // Renderizza prossimi allenamenti
    const renderUpcomingWorkouts = (workouts) => {
        if (!workouts || workouts.length === 0) {
            return '<p class="no-workouts">Nessun allenamento programmato</p>';
        }
        
        const validWorkouts = workouts.filter(w =>
            w.workout_plans?.name &&
            new Date(w.scheduled_date) >= new Date()
        );
        
        if (validWorkouts.length === 0) {
            return '<p class="no-workouts">Nessun allenamento programmato</p>';
        }
        
        return `
            <div class="workouts-list">
                ${validWorkouts.slice(0, 3).map(w => `
                    <div class="workout-item">
                        <div class="workout-date">
                            <i class="fas fa-calendar-alt"></i>
                            ${new Date(w.scheduled_date).toLocaleDateString('it-IT')}
                        </div>
                        <div class="workout-name">
                            ${w.workout_plans.name}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    };
    
    // Conferma eliminazione programma
    const confirmDeleteProgram = async (programId) => {
        if (confirm('Sei sicuro di voler eliminare questo programma e tutti i suoi allenamenti associati?')) {
            await deleteProgram(programId);
        }
    };
    
    // Elimina programma
    const deleteProgram = async (programId) => {
        const loading = showLoading();
        try {
            const { error } = await supabaseClient
                .from('training_programs')
                .delete()
                .eq('id', programId);
            
            if (error) {
                console.error('Errore eliminazione:', error);
                throw error;
            }
            
            showToast('Programma eliminato con successo', 'success');
            
            // Ricarica la pagina
            window.location.reload();
        } catch (error) {
            console.error('Errore nell\'eliminazione:', error);
            showToast(`Errore nell'eliminazione del programma: ${error.message}`, 'error');
        } finally {
            hideLoading(loading);
        }
    };
    
    // Handler per il form di nuovo programma
    const handleProgramFormSubmit = async (e) => {
        e.preventDefault();
        const loading = showLoading();
        
        try {
            // Verifica campi vuoti
            const requiredFields = {
                programName: 'Il nome del programma è obbligatorio',
                programDuration: 'La durata è obbligatoria',
                programStart: 'La data di inizio è obbligatoria'
            };
            
            // Controlla campi obbligatori
            for (const [fieldId, message] of Object.entries(requiredFields)) {
                const field = document.getElementById(fieldId);
                if (!field || !field.value.trim()) {
                    if (field) field.focus();
                    throw new Error(message);
                }
            }
            
            // Verifica autenticazione
            const session = await checkAuth();
            if (!session) return;
            
            // Preparazione dati
            const programData = {
                name: document.getElementById('programName').value.trim(),
                description: document.getElementById('programDescription').value.trim(),
                duration_weeks: parseInt(document.getElementById('programDuration').value),
                start_date: document.getElementById('programStart').value,
                user_id: session.user.id,
                status: 'planned'
            };
            
            // Validazione avanzata
            if (programData.name.length < 3) {
                throw new Error('Il nome deve contenere almeno 3 caratteri');
            }
            
            if (isNaN(programData.duration_weeks) || programData.duration_weeks < 1 || programData.duration_weeks > 52) {
                throw new Error('Durata non valida (1-52 settimane)');
            }
            
            const startDate = new Date(programData.start_date);
            if (startDate < new Date().setHours(0,0,0,0)) {
                throw new Error('Non puoi selezionare una data nel passato');
            }
            
            console.log('Inserimento programma:', programData);
            
            // Inserimento nel database
            const { data, error } = await supabaseClient
                .from('training_programs')
                .insert([programData])
                .select()
                .single();
                
            if (error) {
                console.error('Errore database:', error);
                throw new Error(`Errore database: ${error.details || error.message}`);
            }
            
            showToast('✅ Programma salvato con successo!', 'success');
            
            // Reset e ricarica
            document.getElementById('programForm').reset();
            closeModal('programModal');
            await loadActivePrograms();
            
        } catch (error) {
            console.error('Errore salvataggio:', error);
            showToast(`❌ Salvataggio fallito: ${error.message}`, 'error');
        } finally {
            hideLoading(loading);
        }
    };
    
    // Event Listeners
    // Gestione modale
    const newProgramBtn = document.getElementById('newProgramBtn');
    if (newProgramBtn) {
        newProgramBtn.addEventListener('click', () => {
            document.getElementById('programModal').style.display = 'block';
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signOut();
                if (error) throw error;
                window.location.href = '/';
            } catch (error) {
                console.error('Logout error:', error);
                showToast('Errore durante il logout', 'error');
            }
        });
    }
    
    // Form submit
    const programForm = document.getElementById('programForm');
    if (programForm) {
        programForm.addEventListener('submit', handleProgramFormSubmit);
    }
    
    // Inizializzazione
    console.log('Avvio caricamento programmi...');
    await loadActivePrograms();
});

// Funzione per chiudere i modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Funzioni di utilità
function showToast(message, type = 'info') {
    console.log(`Toast ${type}: ${message}`);
    // Implementa la logica del toast
    alert(message); // Placeholder temporaneo
}

function showLoading() {
    console.log('Showing loading...');
    return { id: 'loading' }; // Placeholder
}

function hideLoading(loading) {
    console.log('Hiding loading...');
}