const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Imposta la cartella statica
app.use(express.static(path.join(__dirname, 'public')));

// Log delle configurazioni
console.log(`Directory root: ${__dirname}`);
console.log(`Directory public: ${path.join(__dirname, 'public')}`);

// Funzione per inviare file HTML
function sendHtmlFile(res, filename) {
  // Percorsi possibili del file
  const paths = [
    path.join(__dirname, filename), // Nella root
    path.join(__dirname, 'public', filename), // In public
    path.join(__dirname, 'public', 'html', filename) // In public/html
  ];

  // Cerca il file in tutti i percorsi possibili
  for (const filePath of paths) {
    console.log(`Cercando ${filename} in: ${filePath}`);
    if (fs.existsSync(filePath)) {
      console.log(`File trovato: ${filePath}`);
      return res.sendFile(filePath);
    }
  }

  // Se non trova il file, mostra un errore
  console.error(`File ${filename} non trovato in nessun percorso`);
  return res.status(404).send(`File ${filename} non trovato. Verifica la struttura delle tue cartelle`);
}

// Rotte per le pagine HTML
app.get('/', (req, res) => {
  sendHtmlFile(res, 'index.html');
});

app.get('/register', (req, res) => {
  sendHtmlFile(res, 'register.html');
});

app.get('/dashboard', (req, res) => {
  sendHtmlFile(res, 'dashboard.html');
});

app.get('/ai-trainer', (req, res) => {
  sendHtmlFile(res, 'ai-trainer.html');
});

app.get('/workout', (req, res) => {
  sendHtmlFile(res, 'workout.html');
});

app.get('/profile', (req, res) => {
  sendHtmlFile(res, 'profile.html');
});

app.get('/stats', (req, res) => {
  sendHtmlFile(res, 'stats.html');
});

app.get('/weekly_summary', (req, res) => {
  sendHtmlFile(res, 'weekly_summary.html');
});

// Rotta per la pagina dei report avanzati
app.get('/reports', (req, res) => {
  sendHtmlFile(res, 'reports.html');
});

// API per gestire le schede di allenamento
app.get('/api/workouts', (req, res) => {
  // Qui implementerai la logica per ottenere gli allenamenti
  // Per ora restituiamo dei dati di esempio
  res.json({
    success: true,
    workouts: [
      { id: 1, title: 'Allenamento Nuoto', content: 'Descrizione allenamento nuoto', type: 'nuoto' },
      { id: 2, title: 'Allenamento Corsa', content: 'Descrizione allenamento corsa', type: 'corsa' }
    ]
  });
});

// API per aggiornare una scheda di allenamento
app.put('/api/workouts/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, type } = req.body;
  
  // Qui implementerai la logica per aggiornare l'allenamento nel database
  // Per ora restituiamo una risposta di successo
  res.json({
    success: true,
    message: `Allenamento ${id} aggiornato con successo`,
    workout: { id, title, content, type }
  });
});

// Gestione di tutte le altre route
app.get('*', (req, res) => {
  // Controlla se è una richiesta API
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  // Altrimenti, serve sempre index.html per gestire le route lato client
  sendHtmlFile(res, 'index.html');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// API per gestire le notifiche
app.get('/api/notifications', async (req, res) => {
  // Verifica autenticazione
  const { user } = req.auth || {};
  if (!user) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  
  try {
    // Ottieni le notifiche dell'utente
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
      
    if (error) throw error;
    
    res.json({
      success: true,
      notifications: data || []
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Errore nel recupero delle notifiche' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  // Verifica autenticazione
  const { user } = req.auth || {};
  if (!user) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  
  const { id } = req.params;
  
  try {
    // Segna la notifica come letta
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', user.id);
      
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Notifica segnata come letta'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Errore nel segnare la notifica come letta' });
  }
});

app.put('/api/notifications/read-all', async (req, res) => {
  // Verifica autenticazione
  const { user } = req.auth || {};
  if (!user) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  
  try {
    // Segna tutte le notifiche come lette
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
      
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Tutte le notifiche segnate come lette'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Errore nel segnare tutte le notifiche come lette' });
  }
});