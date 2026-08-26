#!/usr/bin/env node
/**
 * test-complete-from-file.js
 *
 * Verifica il completamento di una scheda dal file di un'attività Garmin.
 *
 * PERCHÉ ESISTE
 * L'import che c'era, dalla pagina Statistiche, crea una scheda NUOVA.
 * Importando il file della corsa che avevi pianificato ti ritrovavi con
 * DUE voci: la scheda pianificata mai completata e l'attività Garmin. Sui
 * dati veri erano 27 attività importate accanto alle schede dell'AI, e
 * alcune schede risultavano "da fare" pur essendo state svolte.
 *
 * LA DATA LA DECIDE IL FILE.
 * Se anticipi a oggi l'allenamento previsto per domani, è oggi che l'hai
 * fatto. Nel TCX la data sta in <Activity><Id> ed è obbligatoria — il
 * parser rifiuta il file senza — quindi è un fatto registrato
 * dall'orologio, non una stima. Resta correggibile a mano prima di
 * confermare, perché un orologio può avere la data sbagliata.
 *
 * Uso:  node scripts/test-complete-from-file.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const TCX = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'tcx-import.js'), 'utf8');
const DASH = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');
const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'html', 'dashboard.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'dashboard-enhanced.css'), 'utf8');

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

/**
 * Estrae il corpo di una funzione bilanciando le graffe.
 *
 * PERCHÉ SERVE, e non è pignoleria: tcx-import.js contiene DUE strade di
 * salvataggio — saveImport, che crea una scheda nuova, e
 * completeExistingPlan, che ne completa una esistente — e usano quasi le
 * stesse parole. Cercando in tutto il file, un controllo su
 * completeExistingPlan può essere soddisfatto da una riga di saveImport.
 *
 * L'ho scoperto rompendo il codice: togliendo "scheduled_date: dateOnly"
 * e il ripristino da completeExistingPlan, i controlli passavano lo
 * stesso, perché le stesse stringhe esistono anche nell'altra funzione.
 * Un controllo che non distingue le due funzioni non protegge nessuna
 * delle due.
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

const COMPLETA = bodyOf(TCX, 'completeExistingPlan');
const SALVA    = bodyOf(TCX, 'saveImport');

console.log('\n— le due strade sono distinguibili —');
checkTrue('completeExistingPlan è estraibile', COMPLETA.length > 200,
  COMPLETA.length + ' caratteri');
checkTrue('e saveImport pure', SALVA.length > 200, SALVA.length + ' caratteri');
checkTrue('sono due funzioni diverse', COMPLETA !== SALVA);

console.log('\n— la scheda esistente viene completata, non duplicata —');
checkTrue('aggiorna la scheda indicata',
  /updateDroppingMissing\(sc, target\.planId, userId, base, optional\)/.test(COMPLETA));
checkTrue('e il record di completamento punta a quella scheda',
  /workout_id: target\.planId/.test(COMPLETA));
checkTrue('non crea nessuna scheda nuova',
  !/from\('workout_plans'\)\s*\.insert/.test(COMPLETA),
  'era il difetto: la corsa pianificata e quella fatta restavano due voci');
// E la strada vecchia continua a crearla, perché lì è giusto così.
checkTrue('mentre saveImport continua a crearne una',
  /insertDroppingMissing\(sc, basePlan, optional\)/.test(SALVA));

console.log('\n— la data del file vince, e sposta la scheda —');
checkTrue('scheduled_date viene riscritta',
  /scheduled_date: dateOnly/.test(COMPLETA),
  'anticipando un allenamento, la scheda deve spostarsi al giorno vero');
checkTrue('completed_at usa la stessa data', /completed_at: iso/.test(COMPLETA));
checkTrue('ma un valore passato a mano ha la precedenza',
  /const iso = whenIso \|\| data\.startIso/.test(COMPLETA));

// La correzione manuale: il campo esiste, è precompilato dal file, e ciò
// che contiene al momento della conferma è ciò che viene salvato.
console.log('\n— e resta correggibile a mano —');
checkTrue('c è un campo data nell anteprima', /id="tcxWhen"/.test(TCX));
checkTrue('precompilato con la data del file',
  /toLocalInput\(fileIso\)/.test(TCX));
checkTrue('e il salvataggio lo legge',
  /ov\.querySelector\('#tcxWhen'\)/.test(TCX));
checkTrue('una data illeggibile non finisce nel database',
  /if \(!isNaN\(d\.getTime\(\)\)\) quando = d\.toISOString\(\)/.test(TCX),
  'senza il controllo si salverebbe "Invalid Date"');

console.log('\n— l avviso quando il giorno non coincide —');
checkTrue('il riquadro confronta le due date',
  /const spostata = scheduledDate && scheduledDate !== fileDay/.test(TCX));
checkTrue('e lo dice esplicitamente',
  /la scheda si sposta/.test(TCX));

// ─── Le funzioni pure, eseguite davvero ─────────────────────────────
console.log('\n— la conversione della data per il campo —');
// toLocalInput e dateBox non dipendono dal DOM: si possono eseguire.
const stub = {
  window: { showToast: null },
  document: { getElementById: () => null, createElement: () => ({ style: {} }) },
  DOMParser: function () {}
};
const sandbox = { window: stub.window, document: stub.document, DOMParser: stub.DOMParser,
                  caches: undefined, console: console };
sandbox.window.supabaseClient = null;
const vm = require('vm');
vm.createContext(sandbox);
try {
  vm.runInContext(TCX, sandbox);
} catch (e) {
  console.error('  Impossibile eseguire tcx-import.js in Node: ' + e.message);
  process.exit(1);
}
const I = sandbox.window.TcxImport._internals;

checkTrue('toLocalInput è esportata', typeof I.toLocalInput === 'function');
// Il formato richiesto da <input type="datetime-local">.
checkTrue('produce il formato del campo',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(I.toLocalInput('2026-08-24T14:31:00Z')),
  I.toLocalInput('2026-08-24T14:31:00Z'));
check('una data illeggibile dà stringa vuota', I.toLocalInput('domani'), '');
check('e anche un valore assente', I.toLocalInput(null), '');

console.log('\n— il riquadro della data —');
const spostato = I.dateBox('2026-08-24T14:31:00Z', '2026-08-25');
checkTrue('avverte che la scheda si sposta', /la scheda si sposta/.test(spostato));
checkTrue('nomina il giorno previsto', /25 agosto/.test(spostato), spostato.slice(0, 0));
checkTrue('e quello del file', /24 agosto/.test(spostato));

const uguale = I.dateBox('2026-08-25T14:31:00Z', '2026-08-25');
checkTrue('a date coincidenti non avverte di nessuno spostamento',
  !/la scheda si sposta/.test(uguale));
checkTrue('ma dice comunque che è modificabile', /Modificala/.test(uguale));

// Il nome della scheda finisce in un attributo HTML.
checkTrue('le virgolette nel nome non spezzano il campo',
  I.dateBox('2026-08-24T14:31:00Z', '2026-08-25').indexOf('value="2026-08-24T') !== -1);

console.log('\n— se la seconda scrittura fallisce si torna indietro —');
// Senza ripristino la scheda resterebbe segnata come svolta ma senza il
// record: sparirebbe dalla dashboard e non comparirebbe nell'archivio.
checkTrue('lo stato precedente viene letto prima',
  /select\('completed, completed_at, scheduled_date'\)/.test(COMPLETA));
checkTrue('e ripristinato in caso di errore',
  /if \(compRes\.error\) \{[\s\S]{0,400}update\(\{ completed: prev\.completed/.test(COMPLETA));
// La strada vecchia ha il suo ripristino, diverso: lì la scheda è stata
// creata dal nulla, quindi si cancella invece di ripristinarla.
checkTrue('saveImport invece cancella la scheda che aveva creato',
  /delete\(\)\s*\.eq\('id', planRes\.data\.id\)/.test(SALVA));

console.log('\n— il ripiego graduato sulle colonne di migrazione —');
checkTrue('esiste updateDroppingMissing', /async function updateDroppingMissing\(/.test(TCX));
checkTrue('toglie una colonna alla volta', /delete extra\[bad\]/.test(TCX));
checkTrue('e solo quella nominata dal database',
  /if \(!bad \|\| !\(bad in extra\)\) return/.test(TCX));
checkTrue('un errore che non è "colonna mancante" resta visibile',
  /if \(!isMissingColumnError\(res\.error\)\) return \{ res: res, dropped: dropped \};/.test(TCX));
checkTrue('se la traccia si perde, l utente lo sa',
  /la traccia GPS non è stata/.test(TCX),
  'altrimenti cerca la mappa, non la trova e non capisce perché');

console.log('\n— i pulsanti, in entrambi i posti —');
checkTrue('sulla card', /completeFromFile\('\$\{workout\.id\}'\)[\s\S]{0,200}Da file/.test(DASH));
checkTrue('e nel dettaglio', /Completa da file/.test(DASH));
checkTrue('la funzione esiste', /window\.completeFromFile = function/.test(DASH));
checkTrue('passa la scheda come destinazione',
  /planId: workout\.id[\s\S]{0,120}scheduledDate: workout\.scheduled_date/.test(DASH));
checkTrue('e ricarica la dashboard dopo',
  /completeFromFile[\s\S]{0,700}loadDashboardData\(\)/.test(DASH));
checkTrue('il dettaglio si chiude prima di aprire l import',
  /closeModal\('workoutDetailsModal'\);[\s\S]{0,300}openTcxImport/.test(DASH),
  'altrimenti il modale coprirebbe la finestra del file');
checkTrue('lo stile del pulsante è definito', /\.btn-garmin\s*\{/.test(CSS));

console.log('\n— senza destinazione, il comportamento di prima —');
checkTrue('openTcxImport accetta un target facoltativo',
  /window\.openTcxImport = function \(onDone, preloadedText, target\)/.test(TCX));
checkTrue('e senza target crea la scheda come sempre',
  /const completa = !!\(target && target\.planId\)/.test(TCX));
checkTrue('la strada vecchia è intatta', /await saveImport\(parsed, userId, sc\)/.test(TCX));

console.log('\n— la pagina carica cosa serve —');
checkTrue('tcx-import.js è in dashboard.html', /\/js\/tcx-import\.js/.test(HTML));
checkTrue('e weather.js prima di lui',
  HTML.indexOf('/js/weather.js') < HTML.indexOf('/js/tcx-import.js'),
  'l import usa VortexWeather per il meteo storico');
checkTrue('entrambi prima di dashboard.js',
  HTML.indexOf('/js/tcx-import.js') < HTML.indexOf('/js/dashboard.js'));
checkTrue('weather.js è nel precache', /'\/js\/weather\.js'/.test(SW));
checkTrue('la versione della cache è stata alzata',
  Number((SW.match(/CACHE_NAME\s*=\s*'didio-v(\d+)'/) || [0, 0])[1]) >= 60);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del completamento da file superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
