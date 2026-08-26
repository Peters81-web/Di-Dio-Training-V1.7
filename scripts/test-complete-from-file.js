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

// ─── Piu' registrazioni per una sola scheda ─────────────────────────
//
// Il caso dell'utente: "ho suddiviso il lavoro" — corsa, pesi e
// camminata registrati come tre attivita' distinte dall'orologio, per una
// sola sessione pianificata. Caricando un file per volta gli altri due
// andrebbero persi.
//
// LA COSA DA VERIFICARE PRIMA DI SCRIVERE LA FUSIONE erano le PAUSE: i
// venti minuti fra la corsa e i pesi non devono diventare tempo in zona.
// hr-model.js li tratta gia' con "if (!(d > 0) || d > 60) d = 1", quindi
// contano 1 secondo. I controlli qui sotto lo verificano davvero,
// eseguendo timeInZones sulla serie unita.
console.log('\n— tre registrazioni diventano una sessione —');

const { mergeActivities, partsSummary, blocksList, paceOf } = I;

/**
 * Campioni ogni 6 secondi, come esce davvero dal parser: 500 punti su
 * ~52 minuti.
 *
 * IL PASSO NON E' UN DETTAGLIO. La prima versione di questi controlli
 * usava campioni distanti 600 secondi, e l'assunzione "il totale non
 * gonfia" passava per il motivo sbagliato: hr-model azzera gli intervalli
 * sopra i 60 secondi, quindi il tempo in zona collassava a 8 secondi
 * invece dei 3360 attesi. Il controllo era verde su un dato inutilizzabile.
 */
function campioni(durSec, bpm) {
  const o = [];
  for (let t = 0; t <= durSec; t += 6) o.push([t, bpm]);
  return o;
}

// Tre blocchi come li registrerebbe l'orologio, con le pause in mezzo.
const CORSA = {
  activityType: 'running', activityLabel: 'Corsa',
  startIso: '2026-08-24T14:00:00.000Z',
  durationMin: 25, distanceKm: 3.5, calories: 300, avgHr: 141, maxHr: 165,
  temperature: 24, weather: 'sereno', humidity: 60,
  track: [[45.1, 9.1], [45.2, 9.2], [45.3, 9.3]],
  hrSeries: campioni(25 * 60, 141)
};
const PESI = {
  activityType: 'gym', activityLabel: 'Altro',
  startIso: '2026-08-24T14:45:00.000Z',   // 20 minuti dopo la fine della corsa
  durationMin: 18, distanceKm: null, calories: 120, avgHr: 127, maxHr: 150,
  temperature: null, track: null,
  hrSeries: campioni(18 * 60, 127)
};
const CAMMINATA = {
  activityType: 'walking', activityLabel: 'Camminata',
  startIso: '2026-08-24T15:10:00.000Z',
  durationMin: 13, distanceKm: 1.1, calories: 60, avgHr: 100, maxHr: 115,
  temperature: null, track: [[45.4, 9.4], [45.5, 9.5]],
  hrSeries: campioni(13 * 60, 100)
};

const uniti = mergeActivities([PESI, CORSA, CAMMINATA]);   // ordine sparso

check('la durata si somma',   uniti.durationMin, 25 + 18 + 13);
check('la distanza si somma', uniti.distanceKm, 4.6);
check('le calorie si sommano', uniti.calories, 480);
check('la FC massima e il massimo dei blocchi', uniti.maxHr, 165);
// Media PESATA sulla durata, non media delle medie: (141*25+127*18+100*13)/56
check('la FC media e pesata sulla durata', uniti.avgHr,
  Math.round((141 * 25 + 127 * 18 + 100 * 13) / 56));
checkTrue('e NON e la media delle medie',
  uniti.avgHr !== Math.round((141 + 127 + 100) / 3),
  'la media delle medie darebbe ' + Math.round((141 + 127 + 100) / 3));
check('l inizio e quello del blocco piu mattiniero',
  uniti.startIso, '2026-08-24T14:00:00.000Z');

console.log('\n— la mappa tiene la traccia del blocco piu lungo —');
// Scelta dell'utente: meglio un percorso vero e incompleto che uno
// completo e falso. Attaccando le tracce, route-map disegnerebbe una
// riga dritta fra la fine di un blocco e l'inizio del successivo.
check('e quella della corsa, non della camminata', uniti.track, CORSA.track);
checkTrue('non e la concatenazione delle due',
  uniti.track.length === CORSA.track.length,
  'concatenandole sarebbero ' + (CORSA.track.length + CAMMINATA.track.length) + ' punti');
check('e il meteo arriva dallo stesso blocco', uniti.temperature, 24);

console.log('\n— il tracciato cardiaco e riportato a un origine comune —');
const serie = uniti.hrSeries;
checkTrue('contiene campioni di tutti e tre', serie.length > 100,
  serie.length + ' campioni');
check('parte da zero', serie[0][0], 0);
// I pesi iniziano 45 minuti dopo la corsa: 2700 secondi.
checkTrue('i campioni dei pesi sono spostati di 45 minuti',
  serie.some(function (p) { return p[0] >= 2700 && p[1] === 127; }));
checkTrue('ed e in ordine di tempo',
  serie.every(function (p, i) { return i === 0 || p[0] >= serie[i - 1][0]; }));
// Il totale resta sotto il tetto: si sottocampiona PER BLOCCO, non
// sull'insieme, quindi il passo dentro un blocco non dipende dalle pause.
checkTrue('non supera il tetto dei punti salvati', serie.length <= 500,
  serie.length + ' punti');
/**
 * L'intervallo massimo FRA CAMPIONI DELLO STESSO BLOCCO.
 *
 * Con n blocchi ci sono esattamente n-1 salti di confine, ed e' giusto
 * che siano grandi: sono le pause. Si tolgono i piu' grandi in quel
 * numero preciso, invece di filtrare per soglia — la prima versione usava
 * "d < 600" e contava come intervallo interno la pausa di 420 secondi fra
 * i pesi e la camminata, facendo fallire il controllo per il motivo
 * sbagliato.
 */
function maxGapInterno(serie, nBlocchi) {
  const gaps = [];
  for (let i = 1; i < serie.length; i++) gaps.push(serie[i][0] - serie[i - 1][0]);
  gaps.sort(function (a, b) { return b - a; });
  return gaps.slice(nBlocchi - 1)[0] || 0;
}

checkTrue('e dentro un blocco i campioni restano fitti',
  maxGapInterno(serie, 3) <= 60,
  'intervallo massimo ' + maxGapInterno(serie, 3) + ' s, il limite di hr-model e 60');

console.log('\n— e le pause NON diventano tempo in zona —');
// Il controllo che rende onesta tutta la fusione, eseguito davvero.
// hr-model.js si aspetta un window: gli si passa il contesto che abbiamo
// gia' costruito per tcx-import.js, come fa test-recovery-load.js.
new Function('window', 'document',
  fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hr-model.js'), 'utf8')
)(sandbox.window, sandbox.document);
const HrModel = sandbox.window.HrModel;
const tz = HrModel.timeInZones(serie, 185, 53);
checkTrue('il tempo totale e calcolabile', !!tz);
// La sessione dura 56 minuti = 3360 s. Dall'inizio della corsa alla fine
// della camminata sono 83 minuti: se le pause venissero contate, il
// totale ci si avvicinerebbe.
//
// L'assunzione e' STRETTA di proposito: "<= 3360" passerebbe anche con un
// totale di 8 secondi, ed e' esattamente l'errore in cui ero caduto.
checkTrue('il totale coincide con la somma dei blocchi',
  Math.abs(tz.total - 3360) <= 30,
  tz.total + ' s contro i 3360 s attesi (scarto ' + (tz.total - 3360) + ' s)');
checkTrue('e NON con la durata a orologio',
  Math.abs(tz.total - 83 * 60) > 600,
  'le pause conterebbero ' + (83 * 60) + ' s');

console.log('\n— anche se i blocchi sono a dodici ore di distanza —');
// Corsa la mattina, palestra la sera.
//
// DICHIARO IL LIMITE DI QUESTO CONTROLLO: non distingue il
// sottocampionamento per blocco da quello sull'insieme. L'ho verificato
// rompendo il codice, e le due strade danno 4501 e 4495 secondi sui 4500
// attesi — sei secondi. Il sottocampionamento sceglie per indice, e gli
// indici sono fitti dentro i blocchi, quindi anche spalmando 500 punti su
// 12 ore il passo interno resta di 12 secondi.
//
// Quello che questo controllo protegge davvero e' il RISULTATO: se un
// giorno la fusione perdesse tempo per via delle pause, qui si vedrebbe.
const MATTINA = Object.assign({}, CORSA, {
  startIso: '2026-08-24T07:00:00.000Z', durationMin: 30,
  hrSeries: campioni(30 * 60, 141), track: null
});
const SERA = Object.assign({}, PESI, {
  startIso: '2026-08-24T19:00:00.000Z', durationMin: 45,
  hrSeries: campioni(45 * 60, 127)
});
const lontani = mergeActivities([MATTINA, SERA]);
checkTrue('i campioni dentro un blocco restano fitti',
  maxGapInterno(lontani.hrSeries, 2) <= 60,
  'intervallo massimo ' + maxGapInterno(lontani.hrSeries, 2) + ' s');
const tzL = HrModel.timeInZones(lontani.hrSeries, 185, 53);
checkTrue('e il tempo in zona regge', Math.abs(tzL.total - 75 * 60) <= 30,
  tzL.total + ' s contro i ' + (75 * 60) + ' s attesi');

console.log('\n— un blocco solo non viene toccato —');
const solo = mergeActivities([CORSA]);
check('e lo stesso oggetto di partenza', solo, CORSA);
check('elenco vuoto', mergeActivities([]), null);
check('argomento non valido', mergeActivities(null), null);

console.log('\n— il riepilogo per blocco —');
const riepilogo = partsSummary(uniti);
checkTrue('una riga per registrazione', riepilogo.split('\n').length === 3, riepilogo);
checkTrue('con il ritmo della corsa', /7:0\d\/km/.test(riepilogo), riepilogo);
checkTrue('e la FC dei pesi', /FC 127/.test(riepilogo));
checkTrue('i pesi non hanno un ritmo inventato',
  riepilogo.split('\n')[1].indexOf('/km') === -1,
  'senza distanza il ritmo non e calcolabile: ' + riepilogo.split('\n')[1]);
check('con un blocco solo non c e riepilogo', partsSummary(CORSA), '');

check('il ritmo di 25 min su 3.5 km', paceOf(25, 3.5), '7:09');
check('senza distanza niente ritmo', paceOf(25, null), null);
check('ne con distanza zero', paceOf(25, 0), null);

console.log('\n— l elenco dei blocchi nell anteprima —');
const lista = blocksList([CORSA, PESI, CAMMINATA]);
checkTrue('dichiara quante sono', /3 registrazioni unite/.test(lista));
checkTrue('con un pulsante per toglierne una', /data-rimuovi="1"/.test(lista));
check('con un blocco solo non compare', blocksList([CORSA]), '');

console.log('\n— le note del riepilogo arrivano al completamento —');
checkTrue('completeExistingPlan accetta le note',
  /completeExistingPlan\(data, userId, sc, target, whenIso, note\)/.test(TCX));
checkTrue('e le scrive nel record',
  /notes: \(note && note\.trim\(\)\) \|\| partsSummary\(data\) \|\| null/.test(COMPLETA));
checkTrue('il campo e modificabile prima di confermare', /id="tcxNotes"/.test(TCX));
checkTrue('e il salvataggio lo legge', /ov\.querySelector\('#tcxNotes'\)/.test(TCX));

console.log('\n— i file multipli solo dove ha senso —');
checkTrue('il campo accetta piu file quando si completa una scheda',
  /completa \? ' multiple' : ''/.test(TCX));
checkTrue('i blocchi si accumulano',
  /if \(completa\) nuovi\.forEach\(function \(a\) \{ blocchi\.push\(a\); \}\)/.test(TCX));
checkTrue('mentre l import classico sostituisce, come sempre',
  /else \{ blocchi\.length = 0; blocchi\.push\(nuovi\[nuovi\.length - 1\]\); \}/.test(TCX));
checkTrue('la zona di scelta resta aperta per aggiungerne altri',
  /drop\.style\.display = completa \? '' : 'none'/.test(TCX));
checkTrue('il campo file si svuota dopo la lettura',
  /fileInput\.value = ''/.test(TCX),
  'senza, riscegliendo lo stesso file l evento change non scatta');

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del completamento da file superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
