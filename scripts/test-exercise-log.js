#!/usr/bin/env node
/**
 * test-exercise-log.js
 *
 * Test in Node della logica pura di public/js/exercise-log.js: il
 * riconoscimento della tabella mancante, l'aggregazione delle serie e
 * il calcolo della progressione.
 *
 * PERCHÉ ESISTE
 * Il log della palestra decide da solo se spegnersi, in base al codice
 * d'errore che riceve dal database. Se quel riconoscimento fosse troppo
 * largo, un errore di permessi o un vincolo violato verrebbero scambiati
 * per "migrazione non eseguita" e nascosti all'utente — cioè il guasto
 * vero diventerebbe invisibile. I controlli qui sotto verificano
 * entrambe le direzioni: che riconosca la tabella mancante, e che NON
 * riconosca nient'altro.
 *
 * Uso:  node scripts/test-exercise-log.js
 * Esce con codice 1 se un controllo fallisce.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// --- finto DOM, quanto basta a far caricare la IIFE del modulo ---
const fakeEl = () => ({
  id: '', textContent: '', innerHTML: '', className: '', style: {},
  appendChild() {}, addEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, remove() {}, setAttribute() {},
  getAttribute() { return null; }, classList: { add() {}, remove() {} },
  children: [], firstChild: null
});
global.document = {
  getElementById: () => null,
  createElement: fakeEl,
  head: { appendChild() {} },
  body: { appendChild() {}, contains: () => false },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
};
global.window = {};
global.requestAnimationFrame = (f) => f();

const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'exercise-log.js'), 'utf8');
new Function('window', 'document', 'requestAnimationFrame', src)(
  global.window, global.document, global.requestAnimationFrame);

const X = global.window.ExerciseLog._internals;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }

console.log('\n— riconoscimento "tabella inesistente" —');
checkTrue('PGRST205',            X.isMissingTableError({ code: 'PGRST205' }));
checkTrue('42P01',               X.isMissingTableError({ code: '42P01' }));
checkTrue('messaggio PostgREST', X.isMissingTableError({
  message: "Could not find the table 'public.exercise_sets' in the schema cache" }));
checkTrue('messaggio Postgres',  X.isMissingTableError({
  message: 'relation "public.exercise_sets" does not exist' }));

// Il punto della regola 2: NON deve scattare su errori veri, altrimenti
// un guasto reale verrebbe mascherato da "migrazione non eseguita".
check('permesso negato NON è tabella mancante',
  X.isMissingTableError({ code: '42501', message: 'permission denied for table exercise_sets' }), false);
check('violazione RLS NON è tabella mancante',
  X.isMissingTableError({ code: '42501', message: 'new row violates row-level security policy' }), false);
check('vincolo violato NON è tabella mancante',
  X.isMissingTableError({ code: '23514', message: 'violates check constraint "exercise_sets_weight_range"' }), false);
check('colonna mancante NON è tabella mancante',
  X.isMissingTableError({ code: 'PGRST204',
    message: "Could not find the 'humidity' column of 'workout_plans'" }), false);
check('errore di rete NON è tabella mancante',
  X.isMissingTableError({ message: 'Failed to fetch' }), false);
check('null', X.isMissingTableError(null), false);

console.log('\n— normalizzazione del nome —');
check('maiuscole',      X.keyOf('Panca Piana'),      'panca piana');
check('spazi ai bordi', X.keyOf('  Panca piana  '),  'panca piana');
check('già normale',    X.keyOf('panca piana'),      'panca piana');
check('vuoto',          X.keyOf(''),                 '');
checkTrue('le tre forme coincidono',
  X.keyOf('Panca Piana') === X.keyOf('  panca piana ') &&
  X.keyOf('panca piana') === X.keyOf('PANCA PIANA'));

console.log('\n— riassunto di una lista di serie —');
const setsFull = [
  { reps: 10, weight_kg: 60 },
  { reps: 8,  weight_kg: 65 },
  { reps: 6,  weight_kg: 65 }
];
check('numero serie',    X.summarize(setsFull).nSets,          3);
check('carico massimo',  X.summarize(setsFull).maxWeight,      65);
check('rip. totali',     X.summarize(setsFull).totalReps,      24);
check('volume',          X.summarize(setsFull).volume,         10 * 60 + 8 * 65 + 6 * 65);
check('volume completo', X.summarize(setsFull).volumeComplete, true);

// Un dato mancante non deve diventare zero: il volume va marcato parziale.
const setsPartial = [{ reps: 10, weight_kg: 60 }, { reps: 8, weight_kg: null }];
check('volume parziale segnalato',       X.summarize(setsPartial).volumeComplete, false);
check('volume ignora la serie incompleta', X.summarize(setsPartial).volume,       600);
check('rip. contate comunque',           X.summarize(setsPartial).totalReps,      18);

// Corpo libero: 0 kg è un valore vero, non un dato assente.
const setsBw = [{ reps: 12, weight_kg: 0 }, { reps: 10, weight_kg: 0 }];
check('corpo libero: massimo 0',           X.summarize(setsBw).maxWeight,      0);
check('corpo libero: volume 0 ma completo', X.summarize(setsBw).volumeComplete, true);

// PostgREST restituisce i numeric come stringhe ("60.0"): se non fossero
// convertiti, il carico massimo verrebbe confrontato come testo e "9"
// risulterebbe maggiore di "60".
const setsStr = [{ reps: 10, weight_kg: '60.0' }, { reps: 8, weight_kg: '9.0' }];
check('numeric come stringa: massimo corretto', X.summarize(setsStr).maxWeight, 60);

console.log('\n— raggruppamento per esercizio —');
const rows = [
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', set_number: 1, reps: 10, weight_kg: 60 },
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', set_number: 2, reps: 8,  weight_kg: 65 },
  { exercise_key: 'squat',       exercise_name: 'Squat',       set_number: 1, reps: 5,  weight_kg: 80 }
];
const groups = X.groupByExercise(rows);
check('due gruppi',      groups.length,          2);
check('primo gruppo',    groups[0].name,         'Panca piana');
check('serie nel primo', groups[0].sets.length,  2);
check('secondo gruppo',  groups[1].name,         'Squat');

console.log('\n— progressione fra sessioni —');
const history = [
  { workout_id: 'w1', performed_at: '2026-01-07T18:00:00Z', reps: 10, weight_kg: 60 },
  { workout_id: 'w1', performed_at: '2026-01-07T18:00:00Z', reps: 8,  weight_kg: 60 },
  { workout_id: 'w2', performed_at: '2026-01-21T18:00:00Z', reps: 8,  weight_kg: 62.5 },
  { workout_id: 'w3', performed_at: '2026-02-04T18:00:00Z', reps: 8,  weight_kg: 65 }
];
const prog = X.progressionFromHistory(history);
check('tre sessioni',       prog.length,       3);
check('massimo sessione 1', prog[0].maxWeight, 60);
check('massimo sessione 3', prog[2].maxWeight, 65);

const d = X.deltaLabel(prog);
check('da',       d.from,     60);
check('a',        d.to,       65);
check('scarto',   d.diff,     5);
check('sessioni', d.sessions, 3);
check('periodo',  d.period,   'in 4 settimane');   // 28 giorni
checkTrue('il caso del passaggio di consegne: 60→65 in 4 settimane',
  d.from === 60 && d.to === 65 && d.period === 'in 4 settimane');

check('una sola sessione: nessun confronto',
  X.deltaLabel(X.progressionFromHistory(history.slice(0, 2))), null);

console.log('\n— formattazione del carico —');
check('intero',           X.fmtWeight(65),    '65 kg');
check('decimale',         X.fmtWeight(62.5),  '62,5 kg');
check('corpo libero',     X.fmtWeight(0),     'corpo libero');
check('assente',          X.fmtWeight(null),  null);
check('stringa vuota',    X.fmtWeight(''),    null);
check('stringa numerica', X.fmtWeight('60'),  '60 kg');

console.log('\n— data attribuita alle serie —');
// Deve essere quella dell'allenamento, non quella di oggi: è lo stesso
// errore che metteva le attività importate nel mese sbagliato (v46).
check('usa completed_at',
  X.performedAtFor({ completed_at: '2026-03-02T19:30:00Z', created_at: '2026-08-06T10:00:00Z' }),
  '2026-03-02T19:30:00.000Z');
checkTrue('senza completed_at usa scheduled_date (stesso giorno)',
  X.performedAtFor({ scheduled_date: '2026-03-02', created_at: '2026-08-06T10:00:00Z' })
    .slice(0, 10) === '2026-03-02');
check('ultimo ripiego: created_at',
  X.performedAtFor({ created_at: '2026-08-06T10:00:00Z' }),
  '2026-08-06T10:00:00.000Z');

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del log palestra superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
