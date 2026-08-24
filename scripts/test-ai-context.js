#!/usr/bin/env node
/**
 * test-ai-context.js
 *
 * Test in Node delle aggregazioni che finiscono nel prompt dell'AI
 * (public/js/ai-context.js) e della loro resa in testo (index.js).
 *
 * PERCHÉ ESISTE
 * Da questi numeri l'AI ricava frequenze, ritmi e chili da prescrivere. Un
 * errore qui non fa crashare niente: produce un piano sbagliato in modo
 * plausibile, che è il guasto peggiore perché nessuno lo nota. In
 * particolare PostgREST restituisce i numeric come STRINGHE ("60.0"), e
 * senza conversione una media diventa una concatenazione di testo e un
 * confronto mette "9" sopra "60".
 *
 * Uso:  node scripts/test-ai-context.js
 * Esce con codice 1 se un controllo fallisce.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// hr-model.js e ai-context.js si aspettano un window: gliene diamo uno finto.
global.window = {};
for (const f of ['hr-model.js', 'ai-context.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  new Function('window', src)(global.window);
}
const A = global.window.AiContext;
const H = global.window.HrModel;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }

// Profilo reale dell'utente secondo migrations/002: FC max 179, riposo 52.
// Con Karvonen i confini sono Z1 115, Z2 128, Z3 141, Z4 154, Z5 166.
const PROFILE = { maxHr: 179, restHr: 52, maxIsMeasured: true };

console.log('\n— statistiche per tipo di attività —');
const completed = [
  { completed_at: '2026-08-10T07:00:00Z', actual_duration: 45, distance: 8,
    heart_rate_avg: 150, workout_plans: { name: 'Corsa lenta', activity_type: 'running' } },
  { completed_at: '2026-08-08T07:00:00Z', actual_duration: 30, distance: 5,
    heart_rate_avg: 146, workout_plans: { name: 'Corsa breve', activity_type: 'running' } },
  { completed_at: '2026-08-07T18:00:00Z', actual_duration: 60, distance: null,
    heart_rate_avg: 120, workout_plans: { name: 'Palestra A', activity_type: 'gym' } }
];
const stats = A.aggregateByActivity(completed, PROFILE);

check('due tipi di attività', stats.length, 2);
check('ordinati per numero di sessioni', stats[0].type, 'running');
check('sessioni di corsa', stats[0].n, 2);
check('FC media corsa', stats[0].avgHr, 148);           // (150+146)/2
check('distanza media corsa', stats[0].avgKm, 6.5);     // (8+5)/2
// 45 min / 8 km = 337,5 s/km ; 30 min / 5 km = 360 s/km ; media 348,75 -> 349
check('ritmo medio corsa (s/km)', stats[0].avgPaceSec, 349);
check('ritmo formattato', A.formatPace(stats[0].avgPaceSec), '5:49');

// Il punto: la palestra NON deve avere un ritmo. "min/km" in palestra non
// significa nulla e finirebbe nel prompt come un dato inventato.
const gym = stats.find(s => s.type === 'gym');
check('palestra senza ritmo',    gym.avgPaceSec, null);
check('palestra senza distanza', gym.avgKm,      null);
check('palestra con FC',         gym.avgHr,      120);

console.log('\n— zona cardio derivata dalla FC media —');
// 148 bpm con FC max 179 e riposo 52: riserva 127, 148 = riposo + 75,6% -> Z4
check('zona della corsa coerente con HrModel',
  stats[0].zone, H.zoneOf(148, PROFILE.maxHr, PROFILE.restHr));
checkTrue('la zona è valorizzata', stats[0].zone >= 1 && stats[0].zone <= 5);
// 120 bpm = riposo + 53,5% della riserva -> Z1
check('zona della palestra coerente',
  gym.zone, H.zoneOf(120, PROFILE.maxHr, PROFILE.restHr));

// Senza profilo FC la zona non si può calcolare: deve restare null, non 0.
const noProfile = A.aggregateByActivity(completed, null);
check('senza profilo nessuna zona', noProfile[0].zone, null);
check('senza profilo la FC resta',  noProfile[0].avgHr, 148);

console.log('\n— numeric restituiti come stringhe da PostgREST —');
const asStrings = [
  { completed_at: '2026-08-10T07:00:00Z', actual_duration: 45, distance: '8.0',
    heart_rate_avg: '150', workout_plans: { name: 'X', activity_type: 'running' } },
  { completed_at: '2026-08-09T07:00:00Z', actual_duration: 45, distance: '9.0',
    heart_rate_avg: '9', workout_plans: { name: 'Y', activity_type: 'running' } }
];
const s2 = A.aggregateByActivity(asStrings, PROFILE);
check('FC media da stringhe',       s2[0].avgHr, 80);    // (150+9)/2 = 79,5 -> 80
check('distanza media da stringhe', s2[0].avgKm, 8.5);
checkTrue('non è una concatenazione di testo', typeof s2[0].avgHr === 'number');

console.log('\n— sessioni percepite come dure —');
const sessions = [
  { completed_at: '2026-08-10T07:00:00Z', perceived_difficulty: 5, rating: 3,
    heart_rate_avg: 165, workout_plans: { name: 'Lungo 15k' } },
  { completed_at: '2026-08-09T07:00:00Z', perceived_difficulty: 2, rating: 5,
    heart_rate_avg: 130, workout_plans: { name: 'Facile' } },
  { completed_at: '2026-08-08T07:00:00Z', perceived_difficulty: 3, rating: 2,
    heart_rate_avg: 150, workout_plans: { name: 'Faticata e non piaciuta' } },
  { completed_at: '2026-08-07T07:00:00Z', perceived_difficulty: 4, rating: 4,
    heart_rate_avg: 158, workout_plans: { name: 'Ripetute' } }
];
const hard = A.findHardSessions(sessions);
check('tre sessioni dure',       hard.length, 3);
check('la più dura per prima',   hard[0].name, 'Lungo 15k');
check('difficoltà 4 inclusa',    hard[1].name, 'Ripetute');
// difficoltà 3 ma gradimento 2: faticata e non piaciuta, va segnalata
check('difficoltà media + gradimento basso inclusa',
  hard[2].name, 'Faticata e non piaciuta');
checkTrue('la sessione facile è esclusa',
  !hard.some(h => h.name === 'Facile'));

// Senza difficoltà dichiarata non si inventa nulla.
check('senza difficoltà nessuna sessione dura',
  A.findHardSessions([{ completed_at: '2026-08-10T07:00:00Z',
    perceived_difficulty: null, workout_plans: { name: 'Z' } }]).length, 0);

console.log('\n— progressione dei carichi —');
const sets = [
  // 7 gennaio: 3 serie, massimale 60
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', reps: 10, weight_kg: 57.5, performed_at: '2026-01-07T18:00:00Z' },
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', reps: 8,  weight_kg: 60,   performed_at: '2026-01-07T18:30:00Z' },
  // 21 gennaio
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', reps: 8,  weight_kg: 62.5, performed_at: '2026-01-21T18:00:00Z' },
  // 4 febbraio: massimale 65
  { exercise_key: 'panca piana', exercise_name: 'Panca piana', reps: 8,  weight_kg: 65,   performed_at: '2026-02-04T18:00:00Z' },
  { exercise_key: 'squat',       exercise_name: 'Squat',       reps: 5,  weight_kg: 80,   performed_at: '2026-02-04T18:20:00Z' }
];
const prog = A.aggregateGymProgress(sets);
const panca = prog.find(p => p.exercise === 'Panca piana');
check('due esercizi',                  prog.length, 2);
check('tre sessioni di panca',         panca.sessions, 3);
check('primo massimale',               panca.fromKg, 60);
check('ultimo massimale',              panca.toKg,   65);
check('ripetizioni dell ultima serie', panca.lastReps, 8);
checkTrue('è il caso del passaggio di consegne: panca 60→65',
  panca.fromKg === 60 && panca.toKg === 65);

// Più serie nello stesso giorno = una sessione, non tre.
check('le serie dello stesso giorno non contano come sessioni diverse',
  A.aggregateGymProgress(sets.filter(s => s.performed_at.startsWith('2026-01-07')))[0].sessions, 1);

// Serie senza carico registrato: non devono valere 0 kg.
check('serie senza carico ignorate',
  A.aggregateGymProgress([{ exercise_name: 'Plank', reps: 60, weight_kg: null,
    performed_at: '2026-02-04T18:00:00Z' }]).length, 0);

console.log('\n— formattazione del ritmo —');
check('5:00',            A.formatPace(300),  '5:00');
check('zero padding',    A.formatPace(305),  '5:05');
check('arrotondamento a 60 s', A.formatPace(359.6), '6:00');
check('null se assente', A.formatPace(null), null);
check('null se zero',    A.formatPace(0),    null);

// ─── Gli appunti di fine sessione ───────────────────────────────────
//
// Il campo note di completed_workouts non veniva letto da nessuna parte:
// l'AI Trainer chiedeva durata, distanza, calorie, FC media, difficoltà e
// gradimento, ma non le note. Eppure è lì che finisce il dettaglio dentro
// la sessione, mentre gli altri campi sono medie dell'intera seduta.
console.log('\n— gli appunti di fine sessione —');

const NOTA = "5' camminata + 4x20sec di scatto media 5.25/km.\n" +
             "25' corsa in Z2 (passo medio: 7.08/Km, 3.51Km, asfalto).";

const righe = [
  { completed_at: '2026-08-24T14:39:00Z', notes: NOTA,
    workout_plans: { name: 'Corsa – Zone 2 + Core' } },
  { completed_at: '2026-08-22T17:17:00Z', notes: '   ',
    workout_plans: { name: 'Ciclismo' } },
  { completed_at: '2026-08-20T08:00:00Z', notes: 'gambe pesanti',
    workout_plans: { name: 'Palestra' } },
  { completed_at: '2026-08-18T06:28:00Z', notes: null,
    workout_plans: { name: 'Ciclismo' } }
];

const note = A.collectSessionNotes(righe);
check('solo le sessioni che hanno una nota', note.length, 2);
check('la data', note[0].date, '2026-08-24');
check('il nome della sessione', note[0].name, 'Corsa – Zone 2 + Core');
check('il testo integro', note[0].note, NOTA);
checkTrue('gli a-capo non vengono appiattiti', note[0].note.indexOf('\n') !== -1);

// L'ordine non deve dipendere da come arrivano le righe: basterebbe
// cambiare un .order() altrove per mandare al modello le note più vecchie
// invece delle ultime.
const mescolate = [righe[2], righe[0], righe[3], righe[1]];
check('la più recente resta prima',
  A.collectSessionNotes(mescolate).map(n => n.date),
  ['2026-08-24', '2026-08-20']);

console.log('\n— i tetti che proteggono il budget —');
// Senza tetto, 30 sessioni a nota piena costerebbero ~1.800 token
// sottratti alla generazione del piano, che vive sullo stesso budget.
const lunghe = A.collectSessionNotes([
  { completed_at: '2026-08-24T10:00:00Z', notes: 'a'.repeat(5000) }
]);
check('una nota enorme viene troncata a 400', lunghe[0].note.length, 401); // +1 per il segno di taglio
checkTrue('e il taglio è dichiarato', lunghe[0].note.slice(-1) === '…');

const tante = A.collectSessionNotes(
  Array.from({ length: 40 }, (_, i) => ({
    completed_at: '2026-0' + (i % 8 + 1) + '-01T10:00:00Z',
    notes: 'nota ' + i
  })));
check('non più di 8 sessioni', tante.length, 8);
check('i tetti sono dichiarati',
  [A._limits.MAX_NOTE_SESSIONS, A._limits.MAX_NOTE_CHARS], [8, 400]);

// LA COLONNA DEVE ESSERE LETTA, non solo saputa aggregare.
//
// Buco trovato rompendo il codice: togliendo 'notes' da BASE_COLS in
// ai-trainer.js, tutti i controlli qui sopra continuavano a passare —
// perché lavorano su righe sintetiche costruite nel test. In produzione
// però la query non avrebbe più chiesto quella colonna, collectSessionNotes
// avrebbe ricevuto righe senza note, e l'intera funzione sarebbe morta in
// silenzio: nessun errore, nessuna sezione nel prompt, nessun indizio.
// È esattamente il modo in cui una funzione smette di esistere senza che
// nessuno se ne accorga.
console.log('\n— la colonna arriva davvero dal database —');
const TRAINER = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ai-trainer.js'), 'utf8');

checkTrue("'notes' è fra le colonne lette da completed_workouts",
  /BASE_COLS\s*=\s*\[[^\]]*'notes'/.test(TRAINER));
checkTrue('collectSessionNotes viene chiamata',
  /AiContext\.collectSessionNotes\s*\(completed\)/.test(TRAINER));
checkTrue('e il risultato entra nel contesto inviato al server',
  /workoutContext\s*=\s*\{[^}]*sessionNotes/.test(TRAINER));
checkTrue('la card di trasparenza dichiara gli appunti',
  /Appunti di fine sessione/.test(TRAINER),
  'senza riscontro visibile non cè motivo di continuare a scriverli');

console.log('\n— casi limite —');
check('elenco vuoto', A.collectSessionNotes([]), []);
check('argomento non valido', A.collectSessionNotes(null), []);
check('riga senza data', A.collectSessionNotes([{ notes: 'x' }])[0].date, '');
check('riga senza piano collegato',
  A.collectSessionNotes([{ completed_at: '2026-08-24T10:00:00Z', notes: 'x' }])[0].name, null);
check('note non testuali ignorate',
  A.collectSessionNotes([{ completed_at: '2026-08-24T10:00:00Z', notes: 42 }]), []);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del contesto AI superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
