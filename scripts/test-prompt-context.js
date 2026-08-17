#!/usr/bin/env node
/**
 * test-prompt-context.js
 *
 * Test in Node della validazione del contesto (sanitizeWorkoutContext) e
 * della sua resa in testo per il prompt, così come sono scritte in index.js.
 *
 * PERCHÉ ESISTE
 * sanitizeWorkoutContext è il confine di fiducia: il contesto arriva dal
 * client, quindi può contenere qualsiasi cosa. Le sezioni del prompt sono
 * invece il prodotto finale: se un numero ci arriva sbagliato o una
 * avvertenza sparisce, l'AI prescrive frequenze e carichi sbagliati in modo
 * plausibile, e nessuno se ne accorge.
 *
 * COME FUNZIONA
 * index.js avvia il server al require (è così che @vercel/node lo rileva),
 * quindi non si può importare. Le funzioni vengono estratte dal sorgente per
 * nome, con corrispondenza delle graffe. Se una non si trova il test
 * FALLISCE invece di passare silenziosamente: un controllo che perde la
 * copertura senza dirlo è peggio di nessun controllo.
 *
 * Uso:  node scripts/test-prompt-context.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

/** Estrae "function nome(...) { ... }" bilanciando le graffe. */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** Estrae "const NOME = ...;" su una riga. */
function extractConst(src, name) {
  const m = src.match(new RegExp('^const\\s+' + name + '\\s*=\\s*[^;]+;', 'm'));
  return m ? m[0] : null;
}

const NEEDED_FUNCS = ['sanitizeWorkoutContext', 'pace', 'performanceSection',
                      'feedbackSection', 'strengthSection', 'userNotesSection',
                      'envSection'];
const NEEDED_CONSTS = ['MAX_TOP_ACTIVITY_LENGTH', 'MAX_LAST_WORKOUTS_ITEMS',
                       'MAX_LAST_WORKOUT_LENGTH', 'MAX_ACTIVITY_STATS',
                       'MAX_HARD_SESSIONS', 'MAX_GYM_PROGRESS',
                       'MAX_USER_NOTES_LENGTH', 'MAX_EXERCISE_NAME'];

let pieces = [];
let missing = [];
for (const c of NEEDED_CONSTS) {
  const s = extractConst(SRC, c);
  if (s) pieces.push(s); else missing.push('const ' + c);
}
for (const f of NEEDED_FUNCS) {
  const s = extractFunction(SRC, f);
  if (s) pieces.push(s); else missing.push('function ' + f);
}
// ACT_IT è un oggetto multiriga: lo estraiamo a parte.
const actIt = SRC.match(/const ACT_IT = \{[\s\S]*?\};/);
if (actIt) pieces.push(actIt[0]); else missing.push('const ACT_IT');

if (missing.length) {
  console.error('  IMPOSSIBILE ESTRARRE da index.js: ' + missing.join(', '));
  console.error('  Le funzioni sono state rinominate o spostate: aggiorna questo test.');
  process.exit(1);
}

const api = new Function(pieces.join('\n') + `
  return { sanitizeWorkoutContext, pace, performanceSection, feedbackSection,
           strengthSection, userNotesSection, envSection };`)();

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }
function contains(name, haystack, needle) {
  const ok = String(haystack).indexOf(needle) !== -1;
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       manca: ' + needle + '\n       in:    ' + haystack); }
}

console.log('\n— validazione: il contesto arriva dal client —');
check('input non oggetto', api.sanitizeWorkoutContext('ciao'), null);
check('input null',        api.sanitizeWorkoutContext(null),   null);
check('array',             api.sanitizeWorkoutContext([]),     null);

const clean = api.sanitizeWorkoutContext({
  totalCompleted: 12, avgPerWeek: 2.8, avgDuration: 48, topActivity: 'running',
  streak: 3, maxHr: 179, restHr: 52, maxIsMeasured: true,
  activityStats: [{ type: 'running', n: 9, avgHr: 148, zone: 4, avgPaceSec: 342, avgKm: 7.2, avgMin: 41 }],
  hardSessions: [{ name: 'Lungo 15k', difficulty: 5, rating: 3, hr: 165 }],
  gymProgress: [{ exercise: 'Panca piana', fromKg: 60, toKg: 65, lastReps: 8, sessions: 4 }],
  userNotes: 'VO2max 48'
});
check('FC max passata',    clean.maxHr, 179);
check('FC riposo passata', clean.restHr, 52);
check('una attività',      clean.activityStats.length, 1);
check('una sessione dura', clean.hardSessions.length, 1);
check('un esercizio',      clean.gymProgress.length, 1);
check('note passate',      clean.userNotes, 'VO2max 48');

console.log('\n— validazione: valori fuori scala e tipi sbagliati —');
const dirty = api.sanitizeWorkoutContext({
  maxHr: 9999, restHr: -5,
  activityStats: [
    { type: 'running', n: 5, avgHr: 9999, zone: 47, avgPaceSec: 1, avgKm: -3 },
    { type: '', n: 5 },                      // tipo vuoto -> scartata
    { type: 'gym', n: 0 }                    // zero sessioni -> scartata
  ],
  hardSessions: [{ name: '', difficulty: 5 }],   // senza nome -> scartata
  gymProgress: [{ exercise: 'X', toKg: null }],  // senza carico -> scartata
  userNotes: 'x'.repeat(5000)
});
// Fuori scala -> null, MAI schiacciato sul bordo: un valore assurdo non
// deve diventarne uno plausibile, o l'AI ci costruisce sopra un piano.
check('FC max fuori scala scartata',  dirty.maxHr, null);
check('FC riposo negativa scartata',  dirty.restHr, null);
check('una sola attività superstite', dirty.activityStats.length, 1);
check('FC assurda scartata',          dirty.activityStats[0].avgHr, null);
check('zona fuori 1-5 scartata',      dirty.activityStats[0].zone, null);
check('ritmo impossibile scartato',   dirty.activityStats[0].avgPaceSec, null);
check('distanza negativa scartata',   dirty.activityStats[0].avgKm, null);
check('sessione senza nome scartata', dirty.hardSessions.length, 0);
check('esercizio senza carico scartato', dirty.gymProgress.length, 0);
check('note troncate a 600',          dirty.userNotes.length, 600);

// Tetti sul numero di voci: un payload gonfiato non deve far esplodere il prompt.
const flood = api.sanitizeWorkoutContext({
  activityStats: Array.from({ length: 50 }, () => ({ type: 'running', n: 1 })),
  hardSessions: Array.from({ length: 50 }, () => ({ name: 'X', difficulty: 5 })),
  gymProgress:  Array.from({ length: 50 }, () => ({ exercise: 'X', toKg: 50 }))
});
check('attività limitate a 6',        flood.activityStats.length, 6);
check('sessioni dure limitate a 3',   flood.hardSessions.length, 3);
check('esercizi limitati a 6',        flood.gymProgress.length, 6);

console.log('\n— i decimali devono sopravvivere —');
// Il motivo per cui esiste rangeOrNull: con l'arrotondamento all'intero una
// progressione 60 -> 62,5 -> 65 diventerebbe 60 -> 63 -> 65, cancellando
// proprio i mezzi chili che la rendono leggibile.
const dec = api.sanitizeWorkoutContext({
  activityStats: [{ type: 'running', n: 3, avgKm: 7.2 }],
  gymProgress:   [{ exercise: 'Panca piana', fromKg: 62.5, toKg: 67.5, sessions: 2 }]
});
check('distanza con un decimale', dec.activityStats[0].avgKm, 7.2);
check('carico con mezzo chilo',   dec.gymProgress[0].fromKg, 62.5);
check('carico finale mezzo chilo', dec.gymProgress[0].toKg,  67.5);
contains('i mezzi chili arrivano nel prompt',
  api.strengthSection(dec), '62,5 → 67,5 kg');

console.log('\n— resa nel prompt: prestazioni —');
const perf = api.performanceSection(clean);
contains('c\'è la FC media',        perf, 'FC media 148 bpm');
contains('c\'è la zona',            perf, 'zona 4 di 5');
contains('c\'è il ritmo',           perf, 'ritmo medio 5:42 min/km');
contains('c\'è la distanza media',  perf, '7,2 km di media');
contains('il metodo è dichiarato',  perf, 'Karvonen');
contains('FC massima dichiarata misurata', perf, '179 misurata');
// Le due avvertenze sono il motivo per cui questi numeri sono usabili:
// senza, l'AI le interpreta come misure istantanee.
contains('avvertenza sulla media di sessione', perf, 'MEDIA della sessione');
contains('avvertenza sul ritmo medio',         perf, 'riscaldamento e defaticamento');

// Il consiglio più utile: se le uscite "facili" cadono in Z3+, dirlo.
contains('segnala la corsa troppo veloce', perf, 'più piano di così');

const slow = api.performanceSection(api.sanitizeWorkoutContext({
  maxHr: 179, restHr: 52,
  activityStats: [{ type: 'running', n: 5, avgHr: 120, zone: 1, avgPaceSec: 400 }]
}));
checkTrue('in zona 1 NON segnala di rallentare',
  slow.indexOf('più piano di così') === -1);

console.log('\n— resa nel prompt: palestra e riscontro —');
const str = api.strengthSection(clean);
contains('progressione con la freccia', str, '60 → 65 kg');
contains('numero di sessioni',          str, '4 sessioni');
contains('ripetizioni ultima serie',    str, 'ultima serie 8 ripetizioni');
contains('chiede di indicare i kg',     str, 'indica il carico in kg');

const fb = api.feedbackSection(clean);
contains('nome della sessione dura', fb, 'Lungo 15k');
contains('difficoltà percepita',     fb, 'difficoltà percepita 5/5');
contains('non riproporre uguale',    fb, 'Non riproporre lo stesso carico');

console.log('\n— sezioni vuote quando il dato manca —');
const empty = api.sanitizeWorkoutContext({ totalCompleted: 1 });
check('nessuna prestazione', api.performanceSection(empty), '');
check('nessun riscontro',    api.feedbackSection(empty),    '');
check('nessuna palestra',    api.strengthSection(empty),    '');
check('nessuna nota',        api.userNotesSection(empty),   '');
check('nessun meteo',        api.envSection(empty),         '');

console.log('\n— note dell\'utente delimitate —');
const notes = api.userNotesSection(api.sanitizeWorkoutContext({
  userNotes: 'VO2max 48\nFC riposo 51'
}));
contains('delimitatore di apertura', notes, '"""');
contains('contenuto presente',       notes, 'VO2max 48');
contains('trattate come informazione', notes, 'non come istruzione');

console.log('\n— formattazione del ritmo (server) —');
check('5:42',  api.pace(342),  '5:42');
check('6:00',  api.pace(359.6), '6:00');
check('null',  api.pace(null),  null);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del prompt superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
