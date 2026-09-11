#!/usr/bin/env node
/**
 * test-import-new-workout.js
 *
 * Verifica il pulsante "Da file" della dashboard: importare un'attività
 * già svolta come scheda NUOVA, senza passare da una scheda in programma.
 *
 * PERCHÉ ESISTE
 * Se nella stessa giornata fai due attività, la prima si carica
 * completando la scheda in programma (completeFromFile) e finisce in
 * Archivio. Per la seconda non c'è più nessuna scheda da completare, e
 * l'unica porta d'ingresso stava sulla pagina Statistiche — che non è
 * dove ti trovi quando hai appena finito di allenarti. L'app sapeva già
 * farlo: mancava il pulsante.
 *
 * IL PUNTO PIÙ DELICATO NON È IL PULSANTE
 * È che l'attività importata nasce COMPLETATA (saveImport scrive
 * completed: true), quindi da quando le schede fatte vivono in Archivio
 * finisce lì, e la dashboard si ricarica IDENTICA. Senza un avviso che
 * dica dov'è andata, il pulsante sembra rotto: premi, aspetti, e non
 * cambia niente. È la stessa famiglia di difetti del toast bianco su
 * bianco e della card che spariva — l'app fa la cosa giusta e non lo
 * dice. Metà di questi controlli sorvegliano l'avviso, non l'import.
 *
 * Uso:  node scripts/test-import-new-workout.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const p = (...a) => path.join(__dirname, '..', ...a);
const DASH_JS   = fs.readFileSync(p('public', 'js', 'dashboard.js'), 'utf8');
const DASH_HTML = fs.readFileSync(p('public', 'html', 'dashboard.html'), 'utf8');
const WORK_HTML = fs.readFileSync(p('public', 'html', 'workout.html'), 'utf8');
const UTILS     = fs.readFileSync(p('public', 'js', 'utils.js'), 'utf8');
const TCX       = fs.readFileSync(p('public', 'js', 'tcx-import.js'), 'utf8');
const CSS       = fs.readFileSync(p('public', 'css', 'styles.css'), 'utf8');
const DASHCSS   = fs.readFileSync(p('public', 'css', 'dashboard-enhanced.css'), 'utf8');
const SW        = fs.readFileSync(p('public', 'sw.js'), 'utf8');

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

/**
 * Toglie i commenti dal codice prima di cercarci dentro.
 *
 * NON È PIGNOLERIA: l'ho scoperto rompendo il codice. Cancellando del
 * tutto l'avviso da importAsNewWorkout, i controlli "c'è un avviso" e
 * "dice dove è finita" restavano VERDI — perché le parole showToast e
 * Archivio compaiono nel commento che spiega perché l'avviso serve. Un
 * controllo soddisfatto da un commento non sorveglia niente: il commento
 * sopravvive proprio alla rimozione del codice che descrive.
 *
 * Il "//" preceduto da ":" si lascia stare, per non troncare gli
 * indirizzi https:// che finissero nella funzione.
 */
function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Le due strade usano quasi le stesse parole: cercare in tutto il file
// farebbe passare un controllo su una grazie a una riga dell'altra.
const NUOVA    = senzaCommenti(bodyOf(DASH_JS, 'importAsNewWorkout'));
const COMPLETA = senzaCommenti(
  DASH_JS.slice(DASH_JS.indexOf('window.completeFromFile = function'),
                DASH_JS.indexOf('function importAsNewWorkout(')));
const SETUP    = senzaCommenti(bodyOf(DASH_JS, 'setupEventListeners'));
const INIT     = senzaCommenti(bodyOf(DASH_JS, 'init'));
const TOAST    = senzaCommenti(bodyOf(UTILS, 'showToast'));

console.log('\n— le due strade restano distinte —');
checkTrue('importAsNewWorkout esiste', NUOVA.length > 200, NUOVA.length + ' caratteri');
checkTrue('completeFromFile pure',     COMPLETA.length > 200, COMPLETA.length + ' caratteri');
checkTrue('sono corpi diversi',        NUOVA !== COMPLETA);
checkTrue('la nuova NON passa un bersaglio',
  !/planId/.test(NUOVA),
  'con un planId completerebbe una scheda esistente invece di crearne una');
checkTrue('mentre completeFromFile lo passa eccome',
  /planId: workout\.id/.test(COMPLETA),
  'se cadesse, le due strade diventerebbero la stessa');
checkTrue('la nuova riusa openTcxImport, non una seconda strada di salvataggio',
  /window\.openTcxImport\(/.test(NUOVA));
checkTrue('e si arrende con un messaggio se l import non ha caricato',
  /typeof window\.openTcxImport !== 'function'/.test(NUOVA));

console.log('\n— l attivita importata nasce completata: e il motivo dell avviso —');
checkTrue('saveImport scrive completed: true',
  /completed: true/.test(TCX),
  'per questo finisce in Archivio e la dashboard non cambia');

console.log('\n— l avviso, che e la meta piu importante —');
checkTrue('c e un avviso dopo l import',
  /showToast\(/.test(NUOVA));
checkTrue('dice dove e finita',
  /Archivio/.test(NUOVA),
  '"importata" senza dire dove lascia a cercarla a mano');
checkTrue('e porta un collegamento',
  /href: '\/archivio'/.test(NUOVA));
checkTrue('dura piu dei 3 secondi predefiniti',
  /showToast\([^)]*,\s*8000\s*,/.test(NUOVA),
  'un collegamento che sparisce prima che tu lo clicchi non e un collegamento');
checkTrue('la dashboard si ricarica comunque',
  /loadDashboardData\(\)/.test(NUOVA));

console.log('\n— showToast sa mostrare un collegamento, e resta sicuro —');
checkTrue('accetta il quarto parametro',
  /function showToast\(message, type = 'info', duration = 3000, action = null\)/.test(UTILS));
checkTrue('il messaggio resta escapato',
  /escapeHtml\(String\(message \?\? ''\)\)/.test(TOAST),
  'contiene nomi letti dai file e messaggi del server');
checkTrue('e anche l etichetta del collegamento',
  /escapeHtml\(String\(action\.label\)\)/.test(TOAST));
checkTrue('accetta SOLO indirizzi interni',
  /action\.href\.charAt\(0\) === '\/'/.test(TOAST),
  'escapare non basta: "javascript:..." non contiene nulla da escapare');
checkTrue('e rifiuta anche //host-esterno',
  /action\.href\.charAt\(1\) !== '\/'/.test(TOAST),
  '"//altro-sito" e un indirizzo assoluto travestito da percorso');
checkTrue('senza action il toast resta com era',
  /azioneOk[\s\S]{0,200}?\? `<a class="toast-action"[\s\S]{0,200}?: ''/.test(TOAST));

console.log('\n— il pulsante sulla dashboard —');
checkTrue('esiste nel markup',   /id="importFromFileBtn"/.test(DASH_HTML));
checkTrue('si chiama "Da file"', /<span>Da file<\/span>/.test(DASH_HTML));
checkTrue('sta accanto a Nuovo Allenamento',
  /importFromFileBtn[\s\S]{0,400}?href="\/workout"/.test(DASH_HTML),
  'e PRIMA: se hai il file, il modulo a mano non lo vuoi nemmeno aprire');
checkTrue('e collegato alla funzione giusta',
  /getElementById\('importFromFileBtn'\)[\s\S]{0,200}?addEventListener\('click', importAsNewWorkout\)/.test(SETUP),
  'senza questo il pulsante c e e non fa niente');
checkTrue('tcx-import.js e caricato dalla dashboard',
  /src="\/js\/tcx-import\.js"/.test(DASH_HTML));

console.log('\n— la scorciatoia su /workout —');
checkTrue('la riga esiste',            /id="workoutImportHint"/.test(WORK_HTML));
checkTrue('nasce nascosta',            /id="workoutImportHint" hidden/.test(WORK_HTML),
  'si mostra solo se l import e davvero disponibile');
checkTrue('si mostra solo se l import c e',
  /typeof window\.openTcxImport !== 'function'\) return;[\s\S]{0,120}?hint\.hidden = false/.test(WORK_HTML),
  'un pulsante che non puo funzionare e peggio di nessun pulsante');
checkTrue('apre l import invece di rimbalzare altrove',
  /workoutImportBtn[\s\S]{0,400}?window\.openTcxImport\(/.test(WORK_HTML),
  'una scorciatoia che ti manda su un altra pagina non e una scorciatoia');
checkTrue('nemmeno qui passa un bersaglio',
  !/planId/.test(WORK_HTML));
checkTrue('gli script servono ci sono',
  /src="\/js\/weather\.js"/.test(WORK_HTML) && /src="\/js\/tcx-import\.js"/.test(WORK_HTML));
checkTrue('e weather.js viene PRIMA di tcx-import.js',
  WORK_HTML.indexOf('/js/weather.js') < WORK_HTML.indexOf('/js/tcx-import.js'),
  'l import lo usa per il meteo storico');
checkTrue('a import fatto si torna alla dashboard',
  /location\.href = '\/dashboard\?imported=1'/.test(WORK_HTML),
  'restare su un modulo mezzo compilato non ha senso');

console.log('\n— e chi torna dalla /workout riceve lo stesso avviso —');
checkTrue('la dashboard legge il parametro',
  /get\('imported'\) === '1'/.test(INIT));
checkTrue('con lo stesso testo e lo stesso collegamento',
  /Archivio/.test(INIT) && /href: '\/archivio'/.test(INIT));
checkTrue('DOPO il caricamento dei dati, non prima',
  INIT.indexOf('await loadDashboardData()') < INIT.indexOf("get('imported')"),
  'darlo prima lo farebbe sparire sotto il ridisegno della pagina');
// Lo stesso avviso esiste in DUE punti — qui e in importAsNewWorkout — e
// la durata va sorvegliata in entrambi. Rompendo solo questo, il
// controllo sull'altro restava verde e il difetto passava.
checkTrue('e dura anche qui piu dei 3 secondi predefiniti',
  /showToast\([^)]*,\s*8000\s*,/.test(INIT),
  'un collegamento che sparisce prima del clic non e un collegamento');
checkTrue('e l indirizzo viene ripulito',
  /history\.replaceState\(\{\}, '', '\/dashboard'\)/.test(INIT),
  'senza, basta un aggiornamento per rivedere l avviso di un import gia fatto');

console.log('\n— stile e cache —');
checkTrue('.toast-action e definito',  /\.toast-action \{/.test(CSS));
checkTrue('.import-hint pure',         /\.import-hint \{/.test(CSS));
checkTrue('la riga va a capo sul telefono',
  /\.import-hint \{[\s\S]{0,300}?flex-wrap: wrap/.test(CSS));

// I DUE PULSANTI IN RIGA.
// Alla prima stesura il contenitore non aveva nessuna regola: finche' ci
// stava un solo pulsante andava bene, ma .btn arriva da workout.css con
// "display: flex", che ne fa un blocco a se'. Con due, si sono impilati
// uno sopra l'altro contro il bordo destro.
checkTrue('.section-actions mette i pulsanti in riga',
  /\.section-actions \{[\s\S]{0,200}?display: flex/.test(DASHCSS),
  'senza, .btn { display: flex } di workout.css li impila in colonna');
checkTrue('con uno spazio fra i due',
  /\.section-actions \{[\s\S]{0,200}?gap:/.test(DASHCSS));
checkTrue('e non si lasciano schiacciare dal titolo',
  /\.section-actions \{[\s\S]{0,260}?flex-shrink: 0/.test(DASHCSS));

// IL COLORE.
// .btn-secondary su questo tema e' un grigio ferro PIENO: accanto al blu
// dell'azione principale faceva una seconda macchia scura, pesante
// uguale e per giunta spenta.
checkTrue('"Da file" non usa piu il grigio pieno',
  !/id="importFromFileBtn" class="btn btn-secondary"/.test(DASH_HTML));
checkTrue('ma il pulsante di appoggio',
  /id="importFromFileBtn" class="btn btn-ghost"/.test(DASH_HTML));
checkTrue('e lo stesso su /workout',
  /id="workoutImportBtn" class="btn btn-ghost"/.test(WORK_HTML));
checkTrue('.btn-ghost e definito con la classe doppia',
  /\.btn\.btn-ghost \{/.test(CSS),
  '.btn di workout.css dichiara "border: none" e arriva DOPO: a parita di specificita il bordo sparirebbe');
checkTrue('ha uno sfondo chiaro, non una tinta piena',
  /\.btn\.btn-ghost \{[\s\S]{0,200}?background: #ffffff/.test(CSS));
checkTrue('e un bordo che lo rende leggibile',
  /\.btn\.btn-ghost \{[\s\S]{0,200}?border: 1\.5px solid/.test(CSS));

const ver = /const CACHE_NAME  = 'didio-v(\d+)'/.exec(SW);
checkTrue('CACHE_NAME bumpato oltre la v67',
  ver && Number(ver[1]) > 67,
  ver ? 'v' + ver[1] : 'non trovato');

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli dell import come scheda nuova superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
