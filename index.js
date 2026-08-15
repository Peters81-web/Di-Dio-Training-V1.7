const express = require('express');
const path    = require('path');
const cors    = require('cors');

const app = express();

// Dietro il proxy di Vercel: senza questo req.ip è SEMPRE l'IP del proxy,
// quindi il rate limiter metterebbe tutti gli utenti nello stesso secchiello
// (5 richieste/minuto per l'intera app invece che per utente).
app.set('trust proxy', 1);

// ─── Logger condizionale (niente noise in produzione) ────────────────────────
const IS_DEV = process.env.NODE_ENV !== 'production';
const log     = IS_DEV ? (...a) => console.log(...a)   : () => {};
const logErr  = (...a) => console.error(...a); // errori sempre visibili

// ─── CORS (origini autorizzate) ──────────────────────────────────────────────
// In produzione accettiamo:
//   - il dominio principale (di-dio-training-v1-7.vercel.app)
//   - qualsiasi preview deployment di Vercel (*-peters81*.vercel.app o
//     *-git-*.vercel.app) per consentire testing su PR/branch
// In dev solo localhost.
const PROD_ORIGIN_REGEX = /^https:\/\/di-dio-training-v1-7(-[a-z0-9-]+)?\.vercel\.app$/;
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function corsOriginCheck(origin, callback) {
  // Richieste server-to-server (es. curl, health checks) non hanno Origin → consenti
  if (!origin) return callback(null, true);

  if (IS_DEV) {
    return callback(null, DEV_ORIGINS.includes(origin));
  }
  return callback(null, PROD_ORIGIN_REGEX.test(origin));
}

app.use(cors({
  origin: corsOriginCheck,
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
  'archivio.html':       path.join(HTML_DIR, 'archivio.html'),
};

function sendHtmlFile(res, filename) {
  const filePath = HTML_MAP[filename];
  if (!filePath) {
    return res.status(404).send(`Pagina non trovata: ${filename}`);
  }
  return res.sendFile(filePath);
}

// ─── Autenticazione (verifica del JWT Supabase) ───────────────────────────────
// Senza questo middleware /api/generate-plan è un endpoint pubblico: chiunque
// può chiamarlo con curl e bruciare la quota Groq. Il CORS non basta, perché
// protegge solo dal browser di terzi, non da richieste server-to-server.
//
// La verifica avviene chiedendo a Supabase chi è il portatore del token
// (GET /auth/v1/user). Costa un round-trip (~100-300ms) ma non richiede né
// dipendenze nuove né il JWT secret fra le variabili d'ambiente.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szybzycjdqlhpgdlcoou.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_9PWi6QX0YsUBx5RoaleQ1g_FQz82pmn';
const AUTH_TIMEOUT_MS = 4000;

async function requireAuth(req, res, next) {
  req.startedAt = Date.now(); // serve a calcolare il budget residuo per Groq
  const header = req.get('authorization') || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Autenticazione richiesta. Effettua il login.' });
  }

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey':        SUPABASE_ANON_KEY
      },
      signal: controller.signal
    });

    if (!authRes.ok) {
      return res.status(401).json({ error: 'Sessione non valida o scaduta. Effettua di nuovo il login.' });
    }

    const user = await authRes.json();
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Sessione non valida. Effettua di nuovo il login.' });
    }

    req.userId = user.id; // usato dal rate limiter per il conteggio per-utente
    return next();

  } catch (err) {
    logErr('Verifica auth fallita:', err.name === 'AbortError' ? 'timeout' : err);
    return res.status(503).json({ error: 'Verifica dell\'identità non riuscita. Riprova.' });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Rate limiter per endpoint AI (evita abusi e costi esplosivi) ─────────────
// Conta per utente autenticato, non per IP: dietro il proxy di Vercel gli IP
// sono poco affidabili e più utenti possono condividere lo stesso indirizzo.
let aiLimiter;
try {
  const rateLimit = require('express-rate-limit');
  aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5,              // max 5 generazioni per utente al minuto
    keyGenerator: (req) => req.userId || req.ip,
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
const VALID_PLAN_TYPES        = ['weekly', 'monthly', 'custom'];
const VALID_LEVELS            = ['beginner', 'intermediate', 'advanced'];
const MAX_PROMPT_LENGTH       = 2000;
const MAX_TOP_ACTIVITY_LENGTH = 60;
const MAX_LAST_WORKOUTS_ITEMS = 10;
const MAX_LAST_WORKOUT_LENGTH = 100;

/**
 * Sanitizza workoutContext (proveniente dal client) prima di iniettarlo
 * nel prompt Groq. Difesa in profondità contro:
 *  - prompt injection (input troppo lunghi che gonfiano il prompt e
 *    sprecano token / cambiano la struttura attesa)
 *  - tipi inattesi (numero negativo, oggetto al posto di stringa, ecc.)
 *  - array gigante (lastWorkouts esploso)
 * Ritorna un nuovo oggetto pulito, o null se l'input non è utilizzabile.
 */
function sanitizeWorkoutContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const clampInt = (v, min, max, fallback) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const clampNum = (v, min, max, fallback) => {
    const n = Number.parseFloat(v);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const clampStr = (v, maxLen) =>
    (typeof v === 'string' ? v : '').trim().slice(0, maxLen);
  // Come clampInt, ma distingue "assente" da "zero": per temperatura e
  // umidità lo zero è un valore legittimo, non un valore mancante.
  const clampOrNull = (v, min, max) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number.parseFloat(v);
    if (Number.isNaN(n)) return null;
    return Math.round(Math.min(max, Math.max(min, n)));
  };

  const lastWorkoutsArr = Array.isArray(raw.lastWorkouts)
    ? raw.lastWorkouts
        .filter(s => typeof s === 'string')
        .slice(0, MAX_LAST_WORKOUTS_ITEMS)
        .map(s => clampStr(s, MAX_LAST_WORKOUT_LENGTH))
        .filter(Boolean)
    : [];

  return {
    totalCompleted: clampInt(raw.totalCompleted, 0, 10000, 0),
    avgPerWeek:     clampNum(raw.avgPerWeek,     0, 100,   0).toFixed(1),
    avgDuration:    clampInt(raw.avgDuration,    0, 600,   0),
    topActivity:    clampStr(raw.topActivity, MAX_TOP_ACTIVITY_LENGTH),
    streak:         clampInt(raw.streak,         0, 3650,  0),
    // Condizioni ambientali tipiche. null quando il dato non c'è: uno zero
    // finto direbbe all'AI "si allena a 0 gradi con 0% di umidità", che è
    // peggio del non saperlo.
    avgTemperature: clampOrNull(raw.avgTemperature, -60, 60),
    avgHumidity:    clampOrNull(raw.avgHumidity,      0, 100),
    lastWorkouts:   lastWorkoutsArr
  };
}

// ─── Digital Asset Links (TWA / app Android Vortex Stride) ────────────────────
// Necessario per far aprire l'app Android a schermo intero (senza barra Chrome).
// Express di default ignora i file dotfile (.well-known), quindi lo serviamo
// con una route esplicita e Content-Type corretto.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

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
app.get('/archivio',       (req, res) => sendHtmlFile(res, 'archivio.html'));

// ─── API AI Trainer (Groq) ────────────────────────────────────────────────────
// requireAuth PRIMA di aiLimiter: il limiter conta per req.userId, che viene
// popolato dalla verifica del token.
app.post('/api/generate-plan', requireAuth, aiLimiter, async (req, res) => {
  const { prompt, planType, fitnessLevel, activityType, workoutContext: rawWorkoutContext } = req.body || {};

  // Sanitizza workoutContext lato server (anche se il client lo costruisce
  // correttamente, non possiamo fidarci di payload arbitrari)
  const workoutContext = sanitizeWorkoutContext(rawWorkoutContext);

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

  // Budget token in base al tipo di piano (evita troncamenti su piani lunghi)
  // weekly ~ 7 giorni × ~150 token/giorno = ~1100 + intro
  // monthly ~ 28 giorni → serve molto più spazio
  // custom = manteniamo margine ampio
  //
  // I margini sono più larghi di quanto serva al solo piano perché
  // gpt-oss-20b è un modello di RAGIONAMENTO: prima di rispondere produce
  // token di ragionamento, che con llama-3.1-8b-instant non esistevano.
  // Se quei token rientrano nel tetto (la documentazione Groq non è
  // raggiungibile da qui per confermarlo), un budget tarato sul solo
  // testo finale troncherebbe il piano a metà. Un tetto più alto non
  // costa nulla se non viene usato: il limite vero resta il timeout.
  const tokenBudgetMap = {
    weekly:  2500,
    monthly: 5000,
    custom:  3500
  };
  const maxTokens = tokenBudgetMap[planType] || 2500;

  // Condizioni ambientali: incidono sulla prestazione quanto il livello di
  // allenamento. Con aria umida il sudore evapora poco, la termoregolazione
  // perde efficacia e a parità di ritmo la frequenza cardiaca sale — quindi
  // un piano tarato su clima secco va rivisto su clima afoso.
  // Vengono incluse solo se disponibili: inventarle sarebbe peggio.
  function envSection(ctx) {
    const parts = [];
    if (ctx.avgTemperature !== null) parts.push(`temperatura media ${ctx.avgTemperature} gradi`);
    if (ctx.avgHumidity !== null)    parts.push(`umidità relativa media ${ctx.avgHumidity}%`);
    if (!parts.length) return '';

    let guidance = 'Tienine conto nel calibrare ritmi, durate e recuperi.';
    if (ctx.avgHumidity !== null && ctx.avgHumidity >= 70 && (ctx.avgTemperature === null || ctx.avgTemperature >= 22)) {
      guidance = 'Sono condizioni afose: con questa umidità il sudore evapora ' +
                 'poco e a parità di ritmo la frequenza cardiaca sale. Riduci ' +
                 'le aspettative sui ritmi, allunga i recuperi, prediligi le ' +
                 'ore più fresche e dai indicazioni esplicite sull\'idratazione.';
    } else if (ctx.avgTemperature !== null && ctx.avgTemperature <= 5) {
      guidance = 'Sono condizioni fredde: prevedi un riscaldamento più lungo e ' +
                 'graduale, e ricorda l\'abbigliamento a strati.';
    }
    return `- Condizioni abituali di allenamento: ${parts.join(', ')}.\n  ${guidance}`;
  }

  const systemPrompt = `Sei un personal trainer professionista italiano. Crea piani di allenamento dettagliati, pratici e motivanti in italiano. Struttura sempre la risposta in Markdown con sezioni chiare.`;

  const contextSection = workoutContext ? `
Storico recente dell'utente (ultime settimane):
- Allenamenti completati: ${workoutContext.totalCompleted}
- Frequenza media: ${workoutContext.avgPerWeek} sessioni/settimana
- Durata media: ${workoutContext.avgDuration} minuti
- Attività più frequente: ${workoutContext.topActivity || 'non specificata'}
- Giorni di streak: ${workoutContext.streak}
${workoutContext.lastWorkouts?.length ? `- Ultimi allenamenti: ${workoutContext.lastWorkouts.join(', ')}` : ''}
${envSection(workoutContext)}
Tieni conto di questo storico per calibrare il piano: non essere troppo conservativo se l'utente si allena già regolarmente.
` : '';

  const userMessage = `Crea un piano di allenamento ${planTypeText} per un atleta di livello ${levelText}.
Obiettivo e preferenze dell'utente: ${prompt.trim()}
${activityType ? `\nL'utente ha scelto un tipo di attività specifico: orienta prevalentemente il piano verso esercizi e sessioni di quel tipo.` : ''}
${contextSection}
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
    // Budget totale della funzione su Vercel Hobby: 10s. La verifica del token
    // ha già consumato parte del tempo, quindi a Groq diamo ciò che resta
    // (meno un margine per serializzare la risposta), non 9s fissi.
    const HARD_BUDGET_MS = 9500;
    const elapsed        = Date.now() - req.startedAt;
    const groqBudget     = Math.max(3000, HARD_BUDGET_MS - elapsed);

    const groqController = new AbortController();
    const groqTimeout = setTimeout(() => groqController.abort(), groqBudget);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        // llama-3.1-8b-instant è stato spento da Groq il 16 agosto 2026
        // (deprecato dal 17 giugno). openai/gpt-oss-20b è il sostituto
        // indicato da Groq stessa nell'avviso di dismissione.
        model:       'openai/gpt-oss-20b',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ],
        max_tokens:  maxTokens,
        temperature: 0.7,
        // Il modello nuovo ragiona prima di rispondere, con effort
        // 'medium' come predefinito. Qui il compito è compilare un piano
        // in un formato dato, non risolvere un problema: il ragionamento
        // aggiunge latenza e token senza migliorare il risultato, e la
        // funzione ha 10 secondi in tutto su Vercel Hobby. 'low' è la
        // scelta che protegge il budget.
        reasoning_effort: 'low'
      }),
      signal: groqController.signal
    });
    clearTimeout(groqTimeout);

    if (!groqRes.ok) {
      const errData = await groqRes.json().catch(() => ({}));
      logErr('Groq API error:', errData);
      return res.status(502).json({ error: errData.error?.message || 'Errore nella chiamata a Groq.' });
    }

    const data    = await groqRes.json();
    const message = data.choices?.[0]?.message || {};

    // Con un modello di ragionamento il pensiero può arrivare in un campo
    // separato (message.reasoning) oppure, a seconda del formato, inline
    // dentro il contenuto racchiuso fra tag. Nel primo caso lo ignoriamo
    // già leggendo solo .content; nel secondo finirebbe nel piano mostrato
    // all'utente, che si troverebbe il monologo del modello al posto degli
    // allenamenti. Lo togliamo in modo difensivo: se non c'è, questa riga
    // non fa nulla.
    const stripReasoning = (s) => s
      .replace(/<(think|thinking|reasoning|analysis)>[\s\S]*?<\/\1>/gi, '')
      // Blocco aperto e mai chiuso: succede quando la risposta viene
      // troncata dal tetto di token a metà ragionamento.
      .replace(/<(think|thinking|reasoning|analysis)>[\s\S]*$/i, '')
      .trim();

    const text = stripReasoning(String(message.content || ''));

    if (!text) {
      // Distinguiamo i due casi: senza questa distinzione un piano
      // mangiato dal ragionamento sembrerebbe un guasto di Groq, e si
      // cercherebbe il problema nel posto sbagliato.
      const finish = data.choices?.[0]?.finish_reason;
      if (message.reasoning || finish === 'length') {
        logErr('Groq: nessun contenuto utile.', { finish, usage: data.usage });
        return res.status(502).json({
          error: 'Il modello ha esaurito lo spazio disponibile ragionando ' +
                 'senza scrivere il piano. Riprova, oppure chiedi un piano più breve.'
        });
      }
      return res.status(502).json({ error: 'Risposta vuota da Groq.' });
    }

    return res.json({ text });

  } catch (err) {
    logErr('generate-plan error:', err);
    const msg = err.name === 'AbortError'
      ? 'Timeout: Groq ha impiegato troppo tempo. Riprova.'
      : 'Errore interno del server durante la generazione del piano.';
    return res.status(500).json({ error: msg });
  }
});

// ─── API Meteo storico (Open-Meteo) ──────────────────────────────────────────
//
// I file TCX/GPX non contengono le condizioni meteo, e la temperatura solo
// a volte. Garmin Connect le recupera da un servizio meteo usando posizione
// e orario dell'attività: qui facciamo lo stesso.
//
// PERCHÉ PASSA DAL SERVER invece di chiamare l'API dal browser:
//   * la CSP resta stretta (nessun dominio esterno da aggiungere a connect-src)
//   * l'indirizzo IP dell'utente non arriva al servizio meteo: escono solo
//     le coordinate dell'allenamento
//   * l'endpoint è protetto dalla stessa autenticazione dell'AI
//
// Open-Meteo è gratuito e senza chiave API. L'endpoint "forecast" con
// past_days copre gli ultimi ~92 giorni; per attività più vecchie serve
// l'archivio, che però ha qualche giorno di ritardo sul presente. Proviamo
// prima quello adatto alla distanza temporale, e in caso ripieghiamo
// sull'altro.
const WEATHER_TIMEOUT_MS = 5000;

app.get('/api/weather', requireAuth, async (req, res) => {
  const lat  = Number.parseFloat(req.query.lat);
  const lon  = Number.parseFloat(req.query.lon);
  const when = String(req.query.time || '');

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'Latitudine non valida.' });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Longitudine non valida.' });
  }
  const ts = new Date(when);
  if (Number.isNaN(ts.getTime())) {
    return res.status(400).json({ error: 'Data/ora non valida.' });
  }

  const day  = ts.toISOString().slice(0, 10);
  const hour = ts.toISOString().slice(0, 13) + ':00';

  // Quanto è distante nel tempo? L'archivio è affidabile per il passato,
  // il forecast copre gli ultimi giorni con dati già consolidati.
  const daysAgo = Math.floor((Date.now() - ts.getTime()) / 86400000);
  const params  = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
                  `&hourly=temperature_2m,relative_humidity_2m,weathercode&timezone=UTC`;

  const endpoints = daysAgo <= 90
    ? [`https://api.open-meteo.com/v1/forecast?${params}&past_days=92&forecast_days=1`,
       `https://archive-api.open-meteo.com/v1/archive?${params}&start_date=${day}&end_date=${day}`]
    : [`https://archive-api.open-meteo.com/v1/archive?${params}&start_date=${day}&end_date=${day}`];

  for (const url of endpoints) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: controller.signal });
      if (!r.ok) continue;

      const data  = await r.json();
      const times = (data.hourly && data.hourly.time) || [];
      const idx   = times.indexOf(hour);
      if (idx < 0) continue;

      const temperature = data.hourly.temperature_2m       ? data.hourly.temperature_2m[idx]       : null;
      const humidity    = data.hourly.relative_humidity_2m ? data.hourly.relative_humidity_2m[idx] : null;
      const code        = data.hourly.weathercode          ? data.hourly.weathercode[idx]          : null;
      if (temperature === null && code === null && humidity === null) continue;

      return res.json({
        temperature: temperature === null ? null : Math.round(temperature * 10) / 10,
        // L'umidità relativa è una percentuale: arrotondata all'intero,
        // e comunque vincolata a 0-100 dal database.
        humidity: (typeof humidity === 'number') ? Math.round(humidity) : null,
        weatherCode: code
      });
    } catch (err) {
      logErr('Meteo:', err.name === 'AbortError' ? 'timeout' : err.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Nessun dato: non è un errore dell'app, semplicemente per quel punto e
  // quell'ora il servizio non ha nulla.
  return res.status(404).json({ error: 'Nessun dato meteo per quel luogo e orario.' });
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
// Serve index.html per le rotte sconosciute (comportamento SPA), MA non per i
// file statici: un .js mancante che risponde "200 + HTML" fa fallire il parse
// nel browser con "Unexpected token '<'", un errore che fa sembrare il file
// presente e rende la diagnosi molto più lunga di quanto dovrebbe. Meglio un
// 404 onesto.
const ASSET_EXT_REGEX = /\.(js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Endpoint non trovato: ${req.method} ${req.path}` });
  }
  if (ASSET_EXT_REGEX.test(req.path)) {
    return res.status(404).type('text/plain').send('File non trovato');
  }
  sendHtmlFile(res, 'index.html');
});

// ─── Avvio server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`✅ Server in ascolto sulla porta ${PORT}`);
});
