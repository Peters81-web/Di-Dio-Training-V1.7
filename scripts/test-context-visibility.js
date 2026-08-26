#!/usr/bin/env node
/**
 * test-context-visibility.js
 *
 * Verifica che l'AI Trainer non possa più generare un piano SENZA storico
 * senza che nessuno se ne accorga.
 *
 * PERCHÉ ESISTE
 * Il modello ha prodotto un piano che iniziava con "Questo piano è stato
 * costruito senza dati storici (frequenza cardiaca, ritmo, carichi o
 * percezioni soggettive) perché non sono stati forniti", mentre nel
 * database c'erano 25 sessioni completate negli ultimi 30 giorni, con
 * frequenza cardiaca, distanze, tracciati e appunti scritti a mano.
 *
 * Il modello non stava sbagliando: stava ubbidendo. Il prompt gli dice
 * "se non hai nessun dato, dichiara che stai pianificando senza storico",
 * e il blocco dello storico era davvero assente, perché il client aveva
 * spedito workoutContext: null.
 *
 * Perché fosse null c'erano TRE strade, e nessuna delle tre lasciava
 * traccia sullo schermo:
 *
 *   1. selectContext restituiva { data: [] } su QUALSIASI errore. Un
 *      guasto di rete o di permessi diventava indistinguibile da "non hai
 *      allenamenti": esattamente il mascheramento che le regole di questo
 *      progetto vietano.
 *   2. loadWorkoutContext usciva con "if (!completed.length) return;" e
 *      la card "Cosa riceve l'AI" restava display:none. La pagina
 *      sembrava solo un po' più corta.
 *   3. setupEventListeners() rende cliccabile "Genera" PRIMA che il
 *      caricamento dello storico sia finito. Un clic svelto partiva con
 *      workoutContext ancora null, e il secondo tentativo funzionava —
 *      il che rendeva il difetto quasi impossibile da riconoscere.
 *
 * Questi controlli sono stati scritti rompendo il codice a mano: ognuno è
 * stato visto FALLIRE ripristinando la versione precedente della riga che
 * sorveglia.
 *
 * Uso:  node scripts/test-context-visibility.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const TRAINER = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ai-trainer.js'), 'utf8');
const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'ai-trainer.css'), 'utf8');
const SRV = fs.readFileSync(
  path.join(__dirname, '..', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function checkTrue(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.error('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

/**
 * Estrae il corpo di una funzione bilanciando le graffe.
 *
 * Serve perché ai-trainer.js contiene più funzioni che parlano dello
 * stesso oggetto: cercando in tutto il file, un controllo su
 * generatePlan può essere soddisfatto da una riga di loadWorkoutContext.
 * È lo stesso motivo per cui esiste in test-complete-from-file.js, dove
 * l'ho scoperto rompendo il codice e vedendo i controlli passare lo
 * stesso.
 */
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

const SELECT  = bodyOf(TRAINER, 'selectContext');
const LOAD    = bodyOf(TRAINER, 'loadWorkoutContext');
const GENERA  = bodyOf(TRAINER, 'generatePlan');
const VUOTA   = bodyOf(TRAINER, 'renderNoContextCard');
const DETAIL  = bodyOf(TRAINER, 'renderContextDetail');
const INIT    = bodyOf(TRAINER, 'init');

console.log('\n— le funzioni sono distinguibili una dall\'altra —');
checkTrue('selectContext estraibile',      SELECT.length > 200, SELECT.length + ' caratteri');
checkTrue('loadWorkoutContext estraibile', LOAD.length   > 200, LOAD.length   + ' caratteri');
checkTrue('generatePlan estraibile',       GENERA.length > 200, GENERA.length + ' caratteri');
checkTrue('renderNoContextCard estraibile', VUOTA.length > 200, VUOTA.length  + ' caratteri');
checkTrue('sono corpi diversi',
  new Set([SELECT, LOAD, GENERA, VUOTA]).size === 4);

console.log('\n— 1. l\'errore non viene più inghiottito —');
// Ogni uscita di selectContext deve dichiarare il campo error: è quello
// che permette a chi chiama di distinguere "nessun allenamento" da
// "non sono riuscito a leggerli".
const USCITE = SELECT.match(/return \{ data[^;]*\}/g) || [];
checkTrue('selectContext ha più uscite', USCITE.length >= 4, USCITE.length + ' return');
checkTrue('e OGNUNA dichiara error',
  USCITE.length >= 4 && USCITE.every(u => /error/.test(u)),
  USCITE.filter(u => !/error/.test(u)).join(' | ') || 'tutte a posto');
checkTrue('il successo dichiara error: null',
  /return \{ data: data \|\| \[\], dropped, error: null \}/.test(SELECT));
checkTrue('il fallimento non-colonna restituisce l\'errore vero',
  /if \(!isMissingColumnError\(error\)\)[\s\S]{0,200}?return \{ data: \[\], dropped, error \}/.test(SELECT),
  'senza, permessi e rete tornano indistinguibili da "nessun allenamento"');
checkTrue('anche gli otto tentativi esauriti producono un errore',
  /error: new Error\(/.test(SELECT));

console.log('\n— 2. lo storico assente si VEDE —');
checkTrue('loadWorkoutContext registra l\'errore della lettura',
  /contextError = ctxRes\.error \|\| null/.test(LOAD));
checkTrue('con zero righe disegna comunque la card',
  /if \(!completed\.length\) \{[\s\S]{0,160}?renderNoContextCard\(contextError\)/.test(LOAD),
  'prima qui c\'era "return;" e la card restava nascosta');
checkTrue('e anche l\'eccezione finisce sulla card, non solo in console',
  /catch \(err\)[\s\S]{0,220}?renderNoContextCard\(err\)/.test(LOAD));
checkTrue('in entrambi i casi workoutContext viene azzerato',
  (LOAD.match(/workoutContext = null/g) || []).length >= 2,
  'un contesto di un caricamento precedente non deve sopravvivere a un fallimento');

checkTrue('la card distingue il guasto dall\'assenza di allenamenti',
  /if \(err\)/.test(VUOTA) && /is-error/.test(VUOTA),
  'grigio = non ti sei allenato, giallo = non sono riuscito a leggere');
checkTrue('e mostra il messaggio del database',
  /err\.message/.test(VUOTA) && /<code>/.test(VUOTA));
checkTrue('il messaggio passa dall\'escape',
  /esc\(msg\)/.test(VUOTA),
  'il testo dell\'errore finisce in innerHTML');
checkTrue('la card diventa visibile',
  /card\.style\.display = 'block'/.test(VUOTA));
checkTrue('i suggerimenti rapidi spariscono quando non ci sono numeri',
  /sugg\.style\.display = 'none'/.test(VUOTA),
  'si costruiscono sullo storico: senza, sarebbero frasi con dei buchi');

console.log('\n— la riga che dice se lo storico arriva davvero al prompt —');
checkTrue('renderContextDetail apre con lo Storico',
  /label: 'Storico'/.test(DETAIL));
checkTrue('e ne dichiara il numero di sessioni',
  /ctx\.totalCompleted/.test(DETAIL) && /30 giorni/.test(DETAIL));

console.log('\n— 3. la generazione aspetta lo storico —');
checkTrue('init tiene la promessa del caricamento',
  /contextReady = loadWorkoutContext\(\)/.test(INIT));
// ATTENZIONE: qui il controllo ovvio NON funziona.
//
// La prima versione di questa riga era /await contextReady/.test(GENERA).
// L'ho rotta apposta togliendo l'attesa iniziale — quella che protegge il
// caso vero, il clic svelto su una pagina appena aperta — e il controllo
// è passato lo stesso: in generatePlan ci sono DUE attese, e la seconda,
// dentro il ritentativo "if (!workoutContext && contextError)", bastava a
// soddisfarlo. Ma quel ramo scatta solo se una lettura è già fallita: a
// pagina appena aperta contextError è null e non si aspetta niente.
//
// Quindi si controlla che la PRIMA attesa venga prima del ritentativo,
// cioè che sia incondizionata.
const attese   = GENERA.split('await contextReady').length - 1;
const posAttesa = GENERA.indexOf('await contextReady');
const posRitent = GENERA.indexOf('if (!workoutContext && contextError)');
const posFetch  = GENERA.indexOf('fetch(\'/api/generate-plan\'');
checkTrue('generatePlan attende lo storico due volte', attese >= 2,
  attese + ' attese');
checkTrue('e la PRIMA non è dentro il ritentativo: è incondizionata',
  posAttesa !== -1 && posRitent !== -1 && posAttesa < posRitent,
  'attesa a ' + posAttesa + ', ritentativo a ' + posRitent +
  ' — se l\'attesa sta solo nel ritentativo, a pagina appena aperta non scatta');
checkTrue('e viene comunque PRIMA della chiamata, non dopo',
  posAttesa !== -1 && posFetch !== -1 && posAttesa < posFetch,
  'attesa a ' + posAttesa + ', fetch a ' + posFetch);
checkTrue('se la lettura era fallita si riprova',
  /if \(!workoutContext && contextError\) \{[\s\S]{0,120}?contextReady = loadWorkoutContext\(\)/.test(GENERA),
  'fra l\'apertura della pagina e il clic la rete può essere tornata');
checkTrue('e se ancora non c\'è, l\'utente viene avvisato',
  /showToast\([\s\S]{0,120}?[Ss]torico non disponibile/.test(GENERA),
  'un piano non tarato deve dichiararsi tale prima di essere creduto');

console.log('\n— il contesto arriva al prompt solo se non è nullo —');
// Questo è il lato server della stessa storia: se il client manda null,
// contextSection resta vuota e il modello — correttamente — dichiara di
// non avere storico. Il controllo fissa il legame, così se un domani si
// toccasse il prompt si vedrebbe subito che dipende da quel campo.
checkTrue('contextBlocks dipende da workoutContext',
  /const contextBlocks = workoutContext \?/.test(SRV));
checkTrue('e il prompt istruisce il modello a dichiarare la mancanza',
  /dichiara che stai pianificando senza storico/.test(SRV),
  'è la frase che ha reso visibile il difetto: va tenuta');

console.log('\n— lo stile dei due stati esiste —');
checkTrue('.ctx-empty è definito',        /\.ctx-empty \{/.test(CSS));
checkTrue('.ctx-empty.is-error pure',     /\.ctx-empty\.is-error \{/.test(CSS));
checkTrue('il messaggio lungo va a capo',
  /\.ctx-empty code \{[\s\S]{0,200}?word-break: break-word/.test(CSS),
  'i messaggi di PostgREST sono lunghi e senza spazi');

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli sulla visibilità del contesto superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
