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
  const paths = [
    path.join(__dirname, filename),
    path.join(__dirname, 'public', filename),
    path.join(__dirname, 'public', 'html', filename)
  ];

  for (const filePath of paths) {
    console.log(`Cercando ${filename} in: ${filePath}`);
    if (fs.existsSync(filePath)) {
      console.log(`File trovato: ${filePath}`);
      return res.sendFile(filePath);
    }
  }

  console.error(`File ${filename} non trovato in nessun percorso`);
  return res.status(404).send(`File ${filename} non trovato. Verifica la struttura delle tue cartelle`);
}

// Rotte per le pagine HTML
app.get('/', (req, res) => sendHtmlFile(res, 'index.html'));
app.get('/register', (req, res) => sendHtmlFile(res, 'register.html'));
app.get('/dashboard', (req, res) => sendHtmlFile(res, 'dashboard.html'));
app.get('/planner', (req, res) => sendHtmlFile(res, 'planner.html'));
app.get('/ai-trainer', (req, res) => sendHtmlFile(res, 'ai-trainer.html'));
app.get('/workout', (req, res) => sendHtmlFile(res, 'workout.html'));
app.get('/profile', (req, res) => sendHtmlFile(res, 'profile.html'));
app.get('/stats', (req, res) => sendHtmlFile(res, 'stats.html'));
app.get('/weekly_summary', (req, res) => sendHtmlFile(res, 'weekly_summary.html'));
app.get('/reports', (req, res) => sendHtmlFile(res, 'reports.html'));

// ─── API workouts (demo) ──────────────────────────────────────────────────────
app.get('/api/workouts', (req, res) => {
  res.json({
    success: true,
    workouts: [
      { id: 1, title: 'Allenamento Nuoto', content: 'Descrizione allenamento nuoto', type: 'nuoto' },
      { id: 2, title: 'Allenamento Corsa', content: 'Descrizione allenamento corsa', type: 'corsa' }
    ]
  });
});

app.put('/api/workouts/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, type } = req.body;
  res.json({ success: true, message: `Allenamento ${id} aggiornato con successo`, workout: { id, title, content, type } });
});

// ─── API AI Trainer ───────────────────────────────────────────────────────────
// POST /api/generate-plan
// Body: { prompt: string, planType: string, fitnessLevel: string }
// Risponde con: { text: string }  (testo Markdown generato da GPT)
app.post('/api/generate-plan', async (req, res) => {
  const { prompt, planType, fitnessLevel } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Il campo prompt è obbligatorio.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chiave OpenAI non configurata sul server.' });
  }

  // Traduci i parametri
  const planTypeMap  = { weekly: 'settimanale (7 giorni)', monthly: 'mensile (4 settimane)', custom: 'personalizzato' };
  const levelMap     = { beginner: 'principiante', intermediate: 'intermedio', advanced: 'avanzato' };
  const planTypeText = planTypeMap[planType]  || 'settimanale (7 giorni)';
  const levelText    = levelMap[fitnessLevel] || 'intermedio';

  const systemPrompt = `Sei un personal trainer professionista italiano. 
Crea piani di allenamento dettagliati, pratici e motivanti in italiano.
Struttura sempre la risposta in Markdown con sezioni chiare.`;

  const userMessage = `Crea un piano di allenamento ${planTypeText} per un atleta di livello ${levelText}.

Obiettivo e preferenze dell'utente: ${prompt.trim()}

Struttura obbligatoria:
1. Una breve introduzione che spiega l'approccio del piano (2-3 righe).
2. Per ogni giorno di allenamento usa questo formato esatto:

### Giorno N: [Nome Allenamento]

#### Riscaldamento (10 minuti)
[dettagli]

#### Fase Principale (30 minuti)
[dettagli]

#### Defaticamento (5-10 minuti)
[dettagli]

#### Note e Consigli
[dettagli]

Per i giorni di riposo usa:
### Giorno N: Riposo attivo
[cosa fare]

Sii specifico, concreto e adatto al livello ${levelText}.`;

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ],
        max_tokens: 3000,
        temperature: 0.7
      })
    });

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}));
      console.error('OpenAI error:', errData);
      return res.status(502).json({ error: errData.error?.message || 'Errore nella chiamata a OpenAI.' });
    }

    const data = await openaiRes.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    if (!text) {
      return res.status(502).json({ error: 'Risposta vuota da OpenAI.' });
    }

    return res.json({ text });
  } catch (err) {
    console.error('generate-plan error:', err);
    return res.status(500).json({ error: 'Errore interno del server durante la generazione del piano.' });
  }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  sendHtmlFile(res, 'index.html');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
