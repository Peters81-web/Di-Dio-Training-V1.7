const express = require('express');
const path    = require('path');
const cors    = require('cors');

const app = express();

// ─── Logger condizionale (niente noise in produzione) ────────────────────────
const IS_DEV = process.env.NODE_ENV !== 'production';
const log     = IS_DEV ? (...a) => console.log(...a)   : () => {};
const logErr  = (...a) => console.error(...a); // errori sempre visibili

// ─── CORS (solo origini autorizzate) ─────────────────────────────────────────
const allowedOrigins = IS_DEV
  ? ['http://localhost:3000']
  : ['https://di-dio-training-v1-7.vercel.app'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT'],
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '50kb' })); // limite payload JSON

// ─── Cartella statica ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Mappa statica HTML (zero disk scan per ogni richiesta) ───────────────────
const HTML_DIR = path.join(__dirname, 'public', 'html');
const HTML_MAP = {
  'index.html':          path.join(__dirname, 'public', 'index.html'),
  'register.html':       path.join(HTML_DIR, 'register.html'),
  'dashboard.html':      path.join(HTML_DIR, 'dashboard.html'),
  'planner.html':        path.join(HTML_DIR, 'planner.html'),
  'ai-trainer.html':     path.join(HTML_DIR, 'ai-trainer.html'),
  'workout.html':        path.join(HTML_DIR, 'workout.html'),
  'profile.html':        path.join(HTML_DIR, 'profile.html'),
  'stats.html':          path.join(HTML_DIR, 'stats.html'),
  'weekly_summary.html': path.join(HTML_DIR, 'weekly_summary.html'),
  'reports.html':        path.join(HTML_DIR, 'reports.html'),
};

function sendHtmlFile(res, filename) {
  const filePath = HTML_MAP[filename];
  if (!filePath) {
    return res.status(404).send(`Pagina non trovata: ${filename}`);
  }
  return res.sendFile(filePath);
}

// ─── Rate limiter per endpoint AI (evita abusi e costi esplosivi) ─────────────
// NOTA: installa il pacchetto con: npm install express-rate-limit
// poi decommentare le righe qui sotto e rimuovere il middleware placeholder
let aiLimiter;
try {
  const rateLimit = require('express-rate-limit');
  aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5,              // max 5 richieste per IP al minuto
    message: { error: 'Troppe richieste. Attendi un minuto prima di rigenerare il piano.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
} catch {
  // Se express-rate-limit non è installato, usa un middleware vuoto (non blocca)
  log('⚠️  express-rate-limit non installato: rate limiting disabilitato.');
  aiLimiter = (req, res, next) => next();
}

// ─── Costanti validazione ─────────────────────────────────────────────────────
const VALID_PLAN_TYPES   = ['weekly', 'monthly', 'custom'];
const VALID_LEVELS       = ['beginner', 'intermediate', 'advanced'];
const MAX_PROMPT_LENGTH  = 2000;

// ─── Rotte pagine HTML ────────────────────────────────────────────────────────
app.get('/',               (req, res) => sendHtmlFile(res, 'index.html'));
app.get('/register',       (req, res) => sendHtmlFile(res, 'register.html'));
app.get('/dashboard',      (req, res) => sendHtmlFile(res, 'dashboard.html'));
app.get('/planner',        (req, res) => sendHtmlFile(res, 'planner.html'));
app.get('/ai-trainer',     (req, res) => sendHtmlFile(res, 'ai-trainer.html'));
app.get('/workout',        (req, res) => sendHtmlFile(res, 'workout.html'));
app.get('/profile',        (req, res) => sendHtmlFile(res, 'profile.html'));
app.get('/stats',          (req, res) => sendHtmlFile(res, 'stats.html'));
app.get('/weekly_summary', (req, res) => sendHtmlFile(res, 'weekly_summary.html'));
app.get('/reports',        (req, res) => sendHtmlFile(res, 'reports.html'));

// ─── API AI Trainer (Groq) ────────────────────────────────────────────────────
app.post('/api/generate-plan', aiLimiter, async (req, res) => {
  const { prompt, planType, fitnessLevel, activityType } = req.body || {};

  // Validazione input
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Il campo prompt è obbligatorio.' });
  }
  if (prompt.trim().length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({ error: `Il prompt non può superare ${MAX_PROMPT_LENGTH} caratteri.` });
  }
  if (planType && !VALID_PLAN_TYPES.includes(planType)) {
    return res.status(400).json({ error: 'Tipo piano non valido. Usa: weekly, monthly, custom.' });
  }
  if (fitnessLevel && !VALID_LEVELS.includes(fitnessLevel)) {
    return res.status(400).json({ error: 'Livello fitness non valido. Usa: beginner, intermediate, advanced.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logErr('GROQ_API_KEY non configurata nelle variabili d\'ambiente.');
    return res.status(500).json({ error: 'Chiave Groq non configurata sul server.' });
  }

  // Mappa parametri
  const planTypeMap = {
    weekly:  'settimanale (7 giorni)',
    monthly: 'mensile (4 settimane)',
    custom:  'personalizzato'
  };
  const levelMap = {
    beginner:     'principiante',
    intermediate: 'intermedio',
    advanced:     'avanzato'
  };

  const planTypeText = planTypeMap[planType]   || 'settimanale (7 giorni)';
  const levelText    = levelMap[fitnessLevel]  || 'intermedio';

  const systemPrompt = `Sei un personal trainer professionista italiano. Crea piani di allenamento dettagliati, pratici e motivanti in italiano. Struttura sempre la risposta in Markdown con sezioni chiare.`;

  const userMessage = `Crea un piano di allenamento ${planTypeText} per un atleta di livello ${levelText}.
Obiettivo e preferenze dell'utente: ${prompt.trim()}
${activityType ? `\nL'utente ha scelto un tipo di attività specifico: orienta prevalentemente il piano verso esercizi e sessioni di quel tipo.` : ''}

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
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ],
        max_tokens:  3000,
        temperature: 0.7
      })
    });

    if (!groqRes.ok) {
      const errData = await groqRes.json().catch(() => ({}));
      logErr('Groq API error:', errData);
      return res.status(502).json({ error: errData.error?.message || 'Errore nella chiamata a Groq.' });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    if (!text) {
      return res.status(502).json({ error: 'Risposta vuota da Groq.' });
    }

    return res.json({ text });

  } catch (err) {
    logErr('generate-plan error:', err);
    return res.status(500).json({ error: 'Errore interno del server durante la generazione del piano.' });
  }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Endpoint non trovato: ${req.method} ${req.path}` });
  }
  sendHtmlFile(res, 'index.html');
});

// ─── Avvio server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`✅ Server in ascolto sulla porta ${PORT}`);
});
