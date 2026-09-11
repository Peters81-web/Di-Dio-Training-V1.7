#!/usr/bin/env node
/**
 * test-rate-limit.js
 *
 * Verifica come l'app tratta il rifiuto per quota di Groq (429).
 *
 * PERCHÉ ESISTE
 * Generando due piani nello stesso minuto è arrivato questo:
 *
 *   Errore: Rate limit reached for model `openai/gpt-oss-120b` in
 *   organization `org_01kq...` service tier `on_demand` on tokens per
 *   minute (TPM): Limit 8000, Used 5289, Requested 5229. Please try
 *   again in 18.884999999s. Need more tokens? Upgrade to Dev Tier today
 *   at https://console.groq.com/settings/billing
 *
 * L'app lo inoltrava di peso, come 502 e con la parola "Errore" davanti.
 * Tre cose sbagliate in una riga: non è un errore ma una quota, non è
 * un guasto del server ma un limite dell'account, e l'unica cosa che
 * l'utente doveva fare — aspettare venti secondi — era sepolta in fondo
 * a un testo inglese fra l'id dell'organizzazione e un link al billing.
 *
 * COSA NON C'È QUI
 * Non si controlla il tetto (8000): cambia per modello e per piano, e
 * cablarlo in un controllo lo trasformerebbe in una bugia il giorno che
 * si cambia modello. I numeri si leggono dal messaggio di Groq, che è
 * l'unica fonte che li conosce davvero.
 *
 * Le funzioni del server vengono ESEGUITE, non cercate nel testo:
 * index.js apre la porta appena lo si richiede, quindi si estrae il
 * codice sorgente delle tre funzioni pure e lo si valuta. È il codice
 * vero, non una copia.
 *
 * Uso:  node scripts/test-rate-limit.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const TRAINER = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ai-trainer.js'), 'utf8');
const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'ai-trainer.css'), 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.error('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

function bodyOf(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

// Le tre funzioni pure del server, eseguite davvero.
const FONTI = ['parseRetryAfter', 'itNum', 'rateLimitMessage']
  .map(n => bodyOf(SRV, n));
checkTrue('le tre funzioni del server sono estraibili',
  FONTI.every(f => f.length > 40), FONTI.map(f => f.length).join(', '));

const mod = new Function(FONTI.join('\n') +
  '\nreturn { parseRetryAfter, itNum, rateLimitMessage };')();
const { parseRetryAfter, itNum, rateLimitMessage } = mod;

// Il messaggio vero, copiato dal rifiuto ricevuto in produzione.
const VERO =
  'Rate limit reached for model `openai/gpt-oss-120b` in organization ' +
  '`org_01kq346kfkexyshznfa0kggyys` service tier `on_demand` on tokens ' +
  'per minute (TPM): Limit 8000, Used 5289, Requested 5229. Please try ' +
  'again in 18.884999999s. Need more tokens? Upgrade to Dev Tier today ' +
  'at https://console.groq.com/settings/billing';

console.log('\n— quanto aspettare —');
check('dal messaggio, arrotondato per eccesso',
  parseRetryAfter(null, VERO), 19);
checkTrue('per ECCESSO e non per difetto',
  parseRetryAfter(null, VERO) > 18.884999999,
  'riproporre a 18,88s su un limite che scade a 18,88 significa sbatterci di nuovo');
check('l intestazione standard ha la precedenza',
  parseRetryAfter('7', VERO), 7);
check('anche se decimale', parseRetryAfter('6.2', VERO), 7);
check('senza nessuna delle due, null', parseRetryAfter(null, 'boh'), null);
check('intestazione non numerica: si ripiega sul messaggio',
  parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', VERO), 19);
check('mai zero: un attesa di zero secondi non e un attesa',
  parseRetryAfter('0', ''), 1);
check('oltre l ora non e un attesa ma un limite giornaliero',
  parseRetryAfter('7200', ''), null);

console.log('\n— i numeri si leggono, non si inventano —');
check('migliaia separate', itNum(8000), '8.000');
check('e anche i milioni', itNum(1234567), '1.234.567');
check('sotto il migliaio niente separatore', itNum(999), '999');
checkTrue('non dipende da toLocaleString',
  !/toLocaleString/.test(bodyOf(SRV, 'itNum')),
  'Node con small-icu ignora la lingua e restituirebbe 8000');

console.log('\n— il messaggio in italiano —');
const M = rateLimitMessage(VERO, 19);
checkTrue('e in italiano', /Limite di Groq raggiunto/.test(M), M);
checkTrue('dice il tetto dichiarato da Groq', /8\.000 token/.test(M));
checkTrue('dice che e al minuto',   /al minuto/.test(M));
checkTrue('dice quanto chiedeva',   /5\.229/.test(M));
checkTrue('e quanto era gia usato', /5\.289/.test(M));
checkTrue('e soprattutto quanto aspettare', /Riprova fra 19 secondi/.test(M));
checkTrue('niente id organizzazione', !/org_01kq/.test(M), M);
checkTrue('niente link al billing',   !/console\.groq\.com/.test(M));

const LUNGO = rateLimitMessage(VERO, 300);
checkTrue('oltre il minuto si parla di minuti',
  /Riprova fra circa 5 minuti/.test(LUNGO), LUNGO);
const UNO = rateLimitMessage(VERO, 1);
checkTrue('un secondo solo e al singolare',
  /Riprova fra 1 secondo\./.test(UNO), UNO);

// Il caso che conta di piu': se Groq cambia il formato del messaggio, il
// risultato deve restare utile invece di diventare "NaN token".
const IGNOTO = rateLimitMessage('Rate limit exceeded, slow down.', 12);
checkTrue('formato sconosciuto: nessun numero inventato',
  !/NaN|undefined|null/.test(IGNOTO), IGNOTO);
checkTrue('ma l attesa resta',  /Riprova fra 12 secondi/.test(IGNOTO));
const SENZA = rateLimitMessage('Rate limit exceeded.', null);
checkTrue('senza nemmeno l attesa, resta una frase sensata',
  /qualche istante/.test(SENZA) && !/NaN|undefined|null/.test(SENZA), SENZA);

console.log('\n— il server distingue la quota dal guasto —');
const ROTTA = SRV.slice(SRV.indexOf("app.post('/api/generate-plan'"));
checkTrue('il 429 esce come 429, non come 502',
  /groqRes\.status === 429[\s\S]{0,400}?res\.status\(429\)/.test(ROTTA),
  'come 502 mandava a cercare un guasto del server che non c era');
checkTrue('con i secondi di attesa nel corpo',
  /retryAfter,/.test(ROTTA));
checkTrue('e un codice riconoscibile dal client',
  /code: 'rate_limit'/.test(ROTTA));
checkTrue('il testo originale di Groq resta disponibile',
  /detail: raw/.test(ROTTA),
  'serve a capire QUALE limite e scattato se i numeri non si estraggono');
checkTrue('gli altri errori restano 502',
  /return res\.status\(502\)\.json\(\{ error: raw \|\| /.test(ROTTA));

console.log('\n— il client aspetta invece di gridare —');
const GENERA = bodyOf(TRAINER, 'generatePlan');
const MOSTRA = bodyOf(TRAINER, 'showRateLimit');
checkTrue('showRateLimit esiste', MOSTRA.length > 200, MOSTRA.length + ' caratteri');
checkTrue('il 429 non passa dalla strada degli errori',
  /if \(response\.status === 429\) \{[\s\S]{0,120}?showRateLimit\(errorData\);[\s\S]{0,40}?return;/.test(GENERA),
  'altrimenti finiva in "Errore: ..." come un guasto qualunque');
checkTrue('il pulsante si spegne',        /btn\.disabled = true/.test(MOSTRA));
checkTrue('conta alla rovescia',          /Riprova fra ' \+ sec \+ 's'/.test(MOSTRA));
checkTrue('e si riaccende da solo',       /btn\.disabled = false/.test(MOSTRA));
checkTrue('con l etichetta di prima',     /btn\.innerHTML = etichetta/.test(MOSTRA));
checkTrue('il timer precedente viene fermato',
  /clearInterval\(rateLimitTimer\)/.test(MOSTRA),
  'due rifiuti ravvicinati lascerebbero due timer sul pulsante');
checkTrue('NON riprova da solo',
  !/generatePlan\(\)/.test(MOSTRA),
  'una rigenerazione consuma quota: la decide l utente, non un timer');
checkTrue('il messaggio passa dall escape',
  /esc\(msg\)/.test(MOSTRA), 'finisce in innerHTML');
checkTrue('senza secondi non si blocca il pulsante per sempre',
  /if \(!btn \|\| !sec\) return;/.test(MOSTRA));

console.log('\n— lo stile dice "aspetta", non "e rotto" —');
checkTrue('.rate-limit-note esiste', /\.rate-limit-note \{/.test(CSS));
const BLOCCO = CSS.slice(CSS.indexOf('.rate-limit-note {'),
                         CSS.indexOf('.rate-limit-note {') + 400);
checkTrue('non e rosso',
  !/#dc2626|#b91c1c|#ef4444|#fee2e2/i.test(BLOCCO),
  'il rosso manda a cercare un guasto che non c e');

console.log('\n— il commento sul costo dei token e stato corretto —');
checkTrue('non si dice piu che un tetto alto non costa nulla',
  !/tetto più alto non\s*\n?\s*\/\/ costa nulla/.test(SRV) &&
  !/non costa nulla se non viene usato: il limite vero resta il timeout/.test(SRV),
  'e falso: max_tokens viene PRENOTATO contro la quota al minuto');
checkTrue('e la correzione spiega perche',
  /Requested" non è quello che il piano ha consumato/.test(SRV));

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli sul limite di quota superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
