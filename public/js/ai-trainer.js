/**
 * AI Trainer - DiDio Training App
 * Script per gestire la generazione di piani di allenamento personalizzati tramite IA
 */

document.addEventListener('DOMContentLoaded', async function() {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
    
    // Variabili globali
    let currentUser = null;
    let workoutActivities = [];
    let generatedWorkouts = [];
    
    // Elementi DOM
    const elements = {
        planType: document.getElementById('planType'),
        fitnessLevel: document.getElementById('fitnessLevel'),
        aiPrompt: document.getElementById('aiPrompt'),
        generatePlanBtn: document.getElementById('generatePlanBtn'),
        aiResponseContainer: document.getElementById('aiResponseContainer'),
        aiResponse: document.getElementById('aiResponse'),
        saveWorkoutsBtn: document.getElementById('saveWorkoutsBtn'),
        regenerateBtn: document.getElementById('regenerateBtn'),
        newPlanBtn: document.getElementById('newPlanBtn'),
        workoutPreviewContainer: document.getElementById('workoutPreviewContainer'),
        workoutPreviewList: document.getElementById('workoutPreviewList'),
        confirmSaveBtn: document.getElementById('confirmSaveBtn'),
        cancelSaveBtn: document.getElementById('cancelSaveBtn'),
        aiLoadingOverlay: document.getElementById('aiLoadingOverlay'),
        logoutBtn: document.getElementById('logoutBtn')
    };
    
    // Inizializzazione
    async function init() {
        try {
            // Verifica autenticazione
            const session = await checkAuth();
            if (session) {
                currentUser = session.user;
                setupEventListeners();
                await loadActivities();
            }
        } catch (error) {
            console.error('Initialization error:', error);
            showToast('Errore durante l\'inizializzazione', 'error');
        }
    }
    
    // Verifica autenticazione
    async function checkAuth() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            if (!session) {
                window.location.href = '/';
                return null;
            }
            return session;
        } catch (error) {
            console.error('Auth error:', error);
            showToast('Errore di autenticazione', 'error');
            return null;
        }
    }
    
    // Carica le attività disponibili
    async function loadActivities() {
        try {
            const { data, error } = await supabaseClient
                .from('activities')
                .select('*')
                .order('name');
                
            if (error) throw error;
            workoutActivities = data || [];
        } catch (error) {
            console.error('Error loading activities:', error);
        }
    }
    
    // Event listeners
    function setupEventListeners() {
        // Generazione piano
        elements.generatePlanBtn.addEventListener('click', generatePlan);
        
        // Pulsanti risposta
        elements.saveWorkoutsBtn.addEventListener('click', showWorkoutPreview);
        elements.regenerateBtn.addEventListener('click', regeneratePlan);
        elements.newPlanBtn.addEventListener('click', resetForm);
        
        // Pulsanti anteprima
        elements.confirmSaveBtn.addEventListener('click', saveWorkouts);
        elements.cancelSaveBtn.addEventListener('click', cancelPreview);
        
        // Logout
        elements.logoutBtn.addEventListener('click', async () => {
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
    
    // Genera piano con IA
    async function generatePlan() {
        // Verifica se i campi sono compilati
        const prompt = elements.aiPrompt.value.trim();
        const planType = elements.planType.value;
        const fitnessLevel = elements.fitnessLevel.value;
        
        if (!prompt) {
            showToast('Descrivi il tuo obiettivo per generare un piano', 'warning');
            elements.aiPrompt.focus();
            return;
        }
        
        // Mostra loader
        elements.aiLoadingOverlay.style.display = 'flex';
        
        try {
            // Costruisci il prompt per l'IA
            const fullPrompt = buildAIPrompt(prompt, planType, fitnessLevel);
            
            // Chiama l'API di Hugging Face
            const response = await callHuggingFaceAPI(fullPrompt);
            
            // Analizza la risposta e genera i workout
            generatedWorkouts = parseAIResponse(response, planType);
            
            // Visualizza la risposta
            displayAIResponse(response);
            
            // Mostra il container della risposta
            elements.aiResponseContainer.style.display = 'block';
            
            // Scroll alla risposta
            elements.aiResponseContainer.scrollIntoView({ behavior: 'smooth' });
        } catch (error) {
            console.error('Error generating plan:', error);
            showToast('Errore nella generazione del piano: ' + error.message, 'error');
        } finally {
            // Nascondi loader
            elements.aiLoadingOverlay.style.display = 'none';
        }
    }
    
    // Costruisci il prompt per l'IA
    function buildAIPrompt(userPrompt, planType, fitnessLevel) {
        // Traduci il tipo di piano
        let planTypeText = '';
        switch (planType) {
            case 'weekly':
                planTypeText = 'settimanale (7 giorni)';
                break;
            case 'monthly':
                planTypeText = 'mensile (4 settimane)';
                break;
            case 'custom':
                planTypeText = 'personalizzato';
                break;
        }
        
        // Traduci il livello di fitness
        let levelText = '';
        switch (fitnessLevel) {
            case 'beginner':
                levelText = 'principiante';
                break;
            case 'intermediate':
                levelText = 'intermedio';
                break;
            case 'advanced':
                levelText = 'avanzato';
                break;
        }
        
        // Costruisci il prompt
        return `Sei un personal trainer professionista. 
                Crea un piano di allenamento ${planTypeText} dettagliato per un cliente di livello ${levelText}.
                
                Ecco l'obiettivo e le preferenze del cliente: ${userPrompt}
                
                Fornisci un piano dettagliato con i seguenti elementi:
                1. Una breve introduzione che spiega l'approccio del piano
                2. Per ogni giorno di allenamento, specifica:
                   - Nome dell'allenamento
                   - Tipo di attività (es. cardio, forza, flessibilità, ecc.)
                   - Descrizione dettagliata del riscaldamento (5-10 minuti)
                   - Descrizione dettagliata della fase principale (20-40 minuti)
                   - Descrizione dettagliata del defaticamento (5-10 minuti)
                   - Note o suggerimenti specifici per l'allenamento

                Struttura il tuo output in modo chiaro e organizzato.`;
    }
    
    // Chiamata API a Hugging Face
    async function callHuggingFaceAPI(prompt) {
        try {
            // Per questo esempio, utilizziamo un'API di Hugging Face
            const API_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2";
            const API_KEY = "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"; // Chiave API demo, da sostituire in produzione
            
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: 2048,
                        temperature: 0.7,
                        top_p: 0.95,
                        do_sample: true
                    }
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Errore nella chiamata API");
            }
            
            const data = await response.json();
            
            // In produzione, sostituire con il modello specifico di Hugging Face
            // Per questo esempio, creiamo una risposta simulata
            return simulateAIResponse(prompt);
        } catch (error) {
            console.error("API call error:", error);
            // Fallback alla simulazione in caso di errore API
            return simulateAIResponse(prompt);
        }
    }
    
    // Funzione per simulare una risposta AI (da sostituire con API reale)
    function simulateAIResponse(prompt) {
        // Estrai informazioni dal prompt dell'utente
        const isWeekly = elements.planType.value === 'weekly';
        const isMonthly = elements.planType.value === 'monthly';
        const isBeginner = elements.fitnessLevel.value === 'beginner';
        
        // Determina il numero di giorni
        const numDays = isWeekly ? 7 : (isMonthly ? 28 : 14);
        
        // Determina il focus dell'allenamento in base al prompt
        let focus = 'generale';
        if (prompt.toLowerCase().includes('forza')) focus = 'forza';
        if (prompt.toLowerCase().includes('cardio') || prompt.toLowerCase().includes('resistenza')) focus = 'cardio';
        if (prompt.toLowerCase().includes('flessibilità')) focus = 'flessibilità';
        
        // Genera una risposta simulata
        let response = `# Piano di Allenamento Personalizzato\n\n`;
        
        response += `## Introduzione\n`;
        if (focus === 'forza') {
            response += `Questo piano è focalizzato sul miglioramento della forza muscolare, utilizzando una combinazione di allenamenti con i pesi e esercizi a corpo libero. L'obiettivo è aumentare la forza complessiva, migliorare la definizione muscolare e creare una solida base di fitness.\n\n`;
        } else if (focus === 'cardio') {
            response += `Questo piano è progettato per migliorare la resistenza cardiovascolare e l'efficienza aerobica. Combina diversi tipi di allenamento cardio a intensità variabile per massimizzare i benefici cardiovascolari e preparare il corpo per attività di resistenza.\n\n`;
        } else if (focus === 'flessibilità') {
            response += `Questo piano si concentra sul miglioramento della flessibilità, mobilità articolare e allungamento muscolare. Attraverso una combinazione di yoga, stretching e pilates, lavoreremo per migliorare la gamma di movimento e prevenire infortuni.\n\n`;
        } else {
            response += `Questo piano è stato progettato per migliorare il tuo fitness generale, combinando allenamenti di forza, cardio e flessibilità. L'obiettivo è creare un approccio equilibrato che migliori la tua condizione fisica complessiva.\n\n`;
        }
        
        response += `## Piano Giornaliero\n\n`;
        
        // Genera schedule in base ai giorni
        const workoutDays = isBeginner ? Math.floor(numDays / 2) : Math.ceil(numDays * 0.7);
        const restDays = numDays - workoutDays;
        
        // Crea un array di giorni e mescolalo per distribuire gli allenamenti
        let days = Array.from({length: numDays}, (_, i) => i + 1);
        days = shuffleArray(days);
        
        // Determina i giorni di allenamento e di riposo
        const trainingDays = days.slice(0, workoutDays);
        const restingDays = days.slice(workoutDays);
        
        // Ordina i giorni numericamente per la presentazione
        trainingDays.sort((a, b) => a - b);
        restingDays.sort((a, b) => a - b);
        
        // Genera allenamenti per i giorni di training
        for (let day of trainingDays) {
            // Determina il tipo di allenamento
            let workoutType = '';
            if (focus === 'forza') {
                workoutType = ['Forza Parte Superiore', 'Forza Parte Inferiore', 'Forza Core', 'Forza Funzionale'][Math.floor(Math.random() * 4)];
            } else if (focus === 'cardio') {
                workoutType = ['Corsa Intervallata', 'Ciclismo', 'HIIT Cardio', 'Nuoto'][Math.floor(Math.random() * 4)];
            } else if (focus === 'flessibilità') {
                workoutType = ['Yoga Flow', 'Stretching Dinamico', 'Pilates', 'Mobilità Articolare'][Math.floor(Math.random() * 4)];
            } else {
                workoutType = ['Allenamento Completo', 'Cardio e Forza', 'Circuito Funzionale', 'Allenamento Metabolico'][Math.floor(Math.random() * 4)];
            }
            
            // Aggiungi l'allenamento al piano
            response += `### Giorno ${day}: ${workoutType}\n\n`;
            
            // Riscaldamento
            response += `#### Riscaldamento (10 minuti)\n`;
            if (focus === 'forza') {
                response += `- 5 minuti di salto della corda o jogging leggero\n`;
                response += `- 20 jumping jack\n`;
                response += `- 10 squat a corpo libero\n`;
                response += `- 10 push-up sulle ginocchia o completi\n`;
                response += `- Rotazioni dinamiche delle articolazioni (spalle, anche, caviglie)\n\n`;
            } else if (focus === 'cardio') {
                response += `- 5 minuti di camminata veloce o jogging leggero\n`;
                response += `- 30 secondi di salto della corda\n`;
                response += `- 20 jumping jack\n`;
                response += `- 10 mountain climber (5 per gamba)\n`;
                response += `- Mobilità dinamica delle anche e delle spalle\n\n`;
            } else {
                response += `- 5 minuti di camminata o jogging leggero\n`;
                response += `- Rotazioni delle articolazioni (polsi, gomiti, spalle, anche, ginocchia, caviglie)\n`;
                response += `- 15 jumping jack\n`;
                response += `- 10 squat a corpo libero\n\n`;
            }
            
            // Fase principale
            response += `#### Fase Principale (30 minuti)\n`;
            if (focus === 'forza' && workoutType.includes('Parte Superiore')) {
                response += `- 3 serie di 8-12 push-up (sulle ginocchia se necessario)\n`;
                response += `- 3 serie di 10-15 dumbbell rows (bilanciere con un braccio)\n`;
                response += `- 3 serie di 10-12 shoulder press con manubri\n`;
                response += `- 3 serie di 12-15 curl bicipiti con manubri\n`;
                response += `- 3 serie di 12-15 estensioni tricipiti\n\n`;
            } else if (focus === 'forza' && workoutType.includes('Parte Inferiore')) {
                response += `- 3 serie di 10-15 squat con peso corporeo o con peso aggiunto\n`;
                response += `- 3 serie di 10-12 affondi per gamba\n`;
                response += `- 3 serie di 12-15 hip thrust\n`;
                response += `- 3 serie di 15-20 sollevamento polpacci\n`;
                response += `- 3 serie di 10-12 romanian deadlift\n\n`;
            } else if (focus === 'cardio' && workoutType.includes('Corsa')) {
                response += `- 5 minuti di corsa a ritmo moderato\n`;
                response += `- 10 ripetizioni di: 30 secondi di corsa veloce seguiti da 1 minuto di camminata/recupero\n`;
                response += `- 5 minuti di corsa a ritmo moderato\n`;
                response += `- 5 ripetizioni di: 1 minuto di corsa veloce seguiti da 1 minuto di camminata/recupero\n\n`;
            } else if (focus === 'cardio' && workoutType.includes('HIIT')) {
                response += `Esegui il seguente circuito, 30 secondi di lavoro, 15 secondi di riposo, 4 round completi:\n`;
                response += `- Burpees\n`;
                response += `- Mountain climbers\n`;
                response += `- Jumping squats\n`;
                response += `- Jumping jacks\n`;
                response += `- High knees\n`;
                response += `- Plank\n\n`;
            } else if (focus === 'flessibilità' && workoutType.includes('Yoga')) {
                response += `Sequenza di yoga flow:\n`;
                response += `- 5 saluti al sole\n`;
                response += `- 2 minuti in posizione del guerriero I (1 minuto per lato)\n`;
                response += `- 2 minuti in posizione del guerriero II (1 minuto per lato)\n`;
                response += `- 1 minuto in posizione dell'albero per lato\n`;
                response += `- 2 minuti in posizione del piccione (1 minuto per lato)\n`;
                response += `- 2 minuti in posizione del triangolo (1 minuto per lato)\n\n`;
            } else {
                response += `Circuito completo (esegui 3 round, 40 secondi di lavoro, 20 secondi di riposo):\n`;
                response += `- Jumping jacks\n`;
                response += `- Push-up\n`;
                response += `- Air squat\n`;
                response += `- Mountain climber\n`;
                response += `- Plank\n`;
                response += `- Burpees\n\n`;
            }
            
            // Defaticamento
            response += `#### Defaticamento (5-10 minuti)\n`;
            if (focus === 'forza') {
                response += `- 5 minuti di camminata lenta o cyclette a bassa intensità\n`;
                response += `- Stretching statico per tutti i principali gruppi muscolari allenati\n`;
                response += `- 30 secondi di stretching per pettorali\n`;
                response += `- 30 secondi di stretching per bicipiti e tricipiti\n`;
                response += `- 30 secondi di stretching per spalle\n\n`;
            } else if (focus === 'cardio') {
                response += `- 5 minuti di camminata lenta per abbassare gradualmente la frequenza cardiaca\n`;
                response += `- Stretching delicato per gambe e anche:\n`;
                response += `- 30 secondi di stretching per quadricipiti per lato\n`;
                response += `- 30 secondi di stretching per ischio-crurali per lato\n`;
                response += `- 30 secondi di stretching per polpacci per lato\n\n`;
            } else if (focus === 'flessibilità') {
                response += `- 1 minuto in posizione del bambino (child's pose)\n`;
                response += `- 1 minuto in posizione supina con gambe al petto\n`;
                response += `- 1 minuto in posizione sdraiata con gambe al muro\n`;
                response += `- 2 minuti in posizione savasana (rilassamento finale)\n\n`;
            } else {
                response += `- 5 minuti di camminata lenta o movimento leggero\n`;
                response += `- Stretching completo del corpo:\n`;
                response += `- 30 secondi per ogni principale gruppo muscolare\n`;
                response += `- Respirazione profonda e rilassamento\n\n`;
            }
            
            // Note
            response += `#### Note e Consigli\n`;
            if (isBeginner) {
                response += `- Inizia con pesi leggeri e concentrati sulla forma corretta\n`;
                response += `- Fai pause quando necessario e ascolta il tuo corpo\n`;
                response += `- Assicurati di bere acqua durante l'allenamento\n`;
                response += `- Se qualche esercizio risulta troppo difficile, usa le varianti modificate\n\n`;
            } else {
                response += `- Mantieni un'intensità costante e sfidante\n`;
                response += `- Controlla sempre la tecnica, specialmente quando aumenti i pesi\n`;
                response += `- Cerca di migliorare rispetto alla sessione precedente (più peso, più ripetizioni o migliore esecuzione)\n`;
                response += `- Resta idratato e ascolta i segnali del tuo corpo\n\n`;
            }
        }
        
        // Aggiungi i giorni di riposo
        for (let day of restingDays) {
            response += `### Giorno ${day}: Riposo attivo\n\n`;
            response += `Oggi è un giorno di recupero. Puoi fare:\n`;
            response += `- 20-30 minuti di camminata leggera\n`;
            response += `- Stretching delicato per tutto il corpo\n`;
            response += `- Yoga leggero o esercizi di mobilità\n`;
            response += `- Idratazione e recupero\n\n`;
        }
        
        return response;
    }
    
    // Funzione di utilità per mescolare un array
    function shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }
    
    // Analisi della risposta dell'IA
    function parseAIResponse(response, planType) {
        const workouts = [];
        const days = [];
        
        // Estrai i giorni dalla risposta
        const dayMatches = response.matchAll(/### Giorno (\d+): ([^\n]+)/g);
        
        for (const match of dayMatches) {
            const dayNumber = parseInt(match[1]);
            const workoutName = match[2].trim();
            
            // Calcola la data in base al giorno
            const startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() + dayNumber - 1);
            
            // Estrai il tipo di attività
            let activityType = '';
            if (workoutName.toLowerCase().includes('cardio') || workoutName.toLowerCase().includes('corsa') || workoutName.toLowerCase().includes('ciclismo')) {
                activityType = workoutActivities.find(a => a.name.toLowerCase().includes('cardio'))?.id;
            } else if (workoutName.toLowerCase().includes('forza') || workoutName.toLowerCase().includes('peso')) {
                activityType = workoutActivities.find(a => a.name.toLowerCase().includes('forza'))?.id;
            } else if (workoutName.toLowerCase().includes('flessibilità') || workoutName.toLowerCase().includes('yoga') || workoutName.toLowerCase().includes('stretching')) {
                activityType = workoutActivities.find(a => a.name.toLowerCase().includes('flessibilità'))?.id;
            } else if (workoutName.toLowerCase().includes('hiit')) {
                activityType = workoutActivities.find(a => a.name.toLowerCase().includes('hiit'))?.id;
            } else if (workoutName.toLowerCase().includes('riposo')) {
                activityType = workoutActivities.find(a => a.name.toLowerCase().includes('recupero'))?.id;
            } else {
                // Usa la prima attività come default
                activityType = workoutActivities[0]?.id;
            }
            
            // Estrai le sezioni principali
            const dayContent = response.split(`### Giorno ${dayNumber}:`)[1].split(/### Giorno \d+:|$$/)[0];
            
            // Estrai riscaldamento
            let warmup = '';
            if (dayContent.includes('#### Riscaldamento')) {
                warmup = dayContent.split('#### Riscaldamento')[1].split(/####|$$/)[0].trim();
            }
            
            // Estrai fase principale
            let mainPhase = '';
            if (dayContent.includes('#### Fase Principale')) {
                mainPhase = dayContent.split('#### Fase Principale')[1].split(/####|$$/)[0].trim();
            }
            
            // Estrai defaticamento
            let cooldown = '';
            if (dayContent.includes('#### Defaticamento')) {
                cooldown = dayContent.split('#### Defaticamento')[1].split(/####|$$/)[0].trim();
            }
            
            // Estrai note
            let notes = '';
            if (dayContent.includes('#### Note')) {
                notes = dayContent.split('#### Note')[1].split(/####|$$/)[0].trim();
            }
            
            // Aggiungi al workout solo se non è un giorno di riposo o se è un riposo attivo
            if (!workoutName.toLowerCase().includes('riposo') || notes || warmup) {
                workouts.push({
                    name: workoutName,
                    date: startDate.toISOString(),
                    activity_id: activityType,
                    warmup: warmup,
                    main_phase: mainPhase,
                    cooldown: cooldown,
                    notes: notes,
                    total_duration: 45, // Durata stimata
                    objective: `Parte del piano ${planType} generato dall'IA`
                });
            }
            
            days.push(dayNumber);
        }
        
        return workouts;
    }
    
    // Visualizza risposta dell'IA
    function displayAIResponse(response) {
        // Visualizza la risposta in formato HTML
        const htmlResponse = response
            .replace(/# (.*?)$/gm, '<h2>$1</h2>')
            .replace(/## (.*?)$/gm, '<h3>$1</h3>')
            .replace(/### (.*?)$/gm, '<h4>$1</h4>')
            .replace(/#### (.*?)$/gm, '<h5>$1</h5>')
            .replace(/- (.*?)$/gm, '<li>$1</li>')
            .replace(/(^|[^\n])\n(?!\n)/gm, '$1<br>')
            .replace(/\n\n/gm, '</p><p>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        elements.aiResponse.innerHTML = `<p>${htmlResponse}</p>`;
    }
    
    // Mostra l'anteprima dei workout da salvare
    function showWorkoutPreview() {
        if (generatedWorkouts.length === 0) {
            showToast('Nessun allenamento da salvare', 'warning');
            return;
        }
        
        // Mostra il container dell'anteprima
        elements.workoutPreviewContainer.style.display = 'block';
        
        // Nascondi il container della risposta
        elements.aiResponseContainer.style.display = 'none';
        
        // Svuota la lista di anteprima
        elements.workoutPreviewList.innerHTML = '';
        
        // Popola la lista di anteprima
        generatedWorkouts.forEach((workout, index) => {
            const workoutDate = new Date(workout.date);
            const formattedDate = workoutDate.toLocaleDateString('it-IT', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long' 
            });
            
            // Trova il nome dell'attività
            const activity = workoutActivities.find(a => a.id === workout.activity_id);
            const activityName = activity ? activity.name : 'Attività non specificata';
            
            const previewItem = document.createElement('div');
            previewItem.className = 'workout-preview-item';
            previewItem.dataset.index = index;
            
            previewItem.innerHTML = `
                <div class="preview-header">
                    <div class="preview-title">${workout.name}</div>
                    <div class="preview-date">${formattedDate}</div>
                </div>
                <div class="preview-section">
                    <h5>Tipo di Attività</h5>
                    <p>${activityName}</p>
                </div>
                <div class="preview-section">
                    <h5>Riscaldamento</h5>
                    <p>${workout.warmup || 'Non specificato'}</p>
                </div>
                <div class="preview-section">
                    <h5>Fase Principale</h5>
                    <p>${workout.main_phase || 'Non specificata'}</p>
                </div>
                <div class="preview-section">
                    <h5>Defaticamento</h5>
                    <p>${workout.cooldown || 'Non specificato'}</p>
                </div>
                ${workout.notes ? `
                <div class="preview-section">
                    <h5>Note</h5>
                    <p>${workout.notes}</p>
                </div>
                ` : ''}
            `;
            
            elements.workoutPreviewList.appendChild(previewItem);
        });
        
        // Scroll all'anteprima
        elements.workoutPreviewContainer.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Salva i workout nel database
    async function saveWorkouts() {
        if (generatedWorkouts.length === 0) {
            showToast('Nessun allenamento da salvare', 'warning');
            return;
        }
        
        const loading = showLoading();
        
        try {
            // Aggiungi user_id a ogni workout
            const workoutsWithUserId = generatedWorkouts.map(workout => ({
                ...workout,
                user_id: currentUser.id,
                created_at: new Date().toISOString()
            }));
            
            // Salva nel database
            const { data, error } = await supabaseClient
                .from('workout_plans')
                .insert(workoutsWithUserId);
                
            if (error) throw error;
            
            showToast('Piano di allenamento salvato con successo!', 'success');
            
            // Nascondi l'anteprima
            elements.workoutPreviewContainer.style.display = 'none';
            
            // Reimposta il form
            resetForm();
            
            // Reindirizza alla dashboard dopo un breve ritardo
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1500);
        } catch (error) {
            console.error('Error saving workouts:', error);
            showToast('Errore nel salvataggio degli allenamenti: ' + error.message, 'error');
        } finally {
            hideLoading(loading);
        }
    }
    
    // Annulla l'anteprima
    function cancelPreview() {
        // Nascondi il container dell'anteprima
        elements.workoutPreviewContainer.style.display = 'none';
        
        // Mostra il container della risposta
        elements.aiResponseContainer.style.display = 'block';
    }
    
    // Rigenera il piano
    function regeneratePlan() {
        // Mantieni i valori dei campi e rigenera il piano
        generatePlan();
    }
    
    // Reimposta il form
    function resetForm() {
        // Reimposta i campi
        elements.aiPrompt.value = '';
        elements.planType.value = 'weekly';
        elements.fitnessLevel.value = 'beginner';
        
        // Nascondi i container della risposta e dell'anteprima
        elements.aiResponseContainer.style.display = 'none';
        elements.workoutPreviewContainer.style.display = 'none';
        
        // Svuota i workout generati
        generatedWorkouts = [];
        
        // Focus sul campo prompt
        elements.aiPrompt.focus();
    }
    
    // Utility: Mostra il loader
    function showLoading() {
        elements.aiLoadingOverlay.style.display = 'flex';
        return elements.aiLoadingOverlay;
    }
    
    // Utility: Nascondi il loader
    function hideLoading() {
        elements.aiLoadingOverlay.style.display = 'none';
    }
    
    // Avvia l'inizializzazione
    init();
    });