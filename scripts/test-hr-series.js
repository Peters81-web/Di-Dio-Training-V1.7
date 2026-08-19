#!/usr/bin/env node
/**
 * test-hr-series.js
 *
 * Test in Node del tracciato cardiaco: costruzione della serie
 * (tcx-import.js) e calcolo di tempo in zona e TRIMP (hr-model.js).
 *
 * PERCHÉ ESISTE
 * Da questi numeri dipendono la zona mostrata nel dettaglio, il carico
 * di allenamento e quello che l'AI legge per calibrare i piani. Su una
 * corsa reale la media di sessione diceva "140 bpm, zona 2" mentre il
 * tracciato diceva 45% in zona 3: se il calcolo qui sbaglia, sbaglia
 * nella stessa direzione, in modo plausibile e invisibile.
 *
 * Tre trappole coperte in particolare:
 *  1. LE PAUSE. Un buco di venti minuti nel tracciato non va attribuito
 *     alla zona in cui ci si trovava quando è iniziato, o una sosta al
 *     bar diventa mezz'ora di fondo aerobico.
 *  2. IL SOTTOCAMPIONAMENTO. Ridurre a 500 punti non deve spostare la
 *     distribuzione: se lo facesse, il risparmio di spazio si pagherebbe
 *     in numeri sbagliati.
 *  3. L'ULTIMO PUNTO. Deve restare l'ultimo reale, perché su di lui si
 *     chiude il conto della durata.
 *
 * Uso:  node scripts/test-hr-series.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const fakeEl = () => ({
  id: '', textContent: '', innerHTML: '', style: {}, appendChild() {},
  addEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, remove() {}, classList: { add() {}, remove() {} }
});
global.document = {
  getElementById: () => null, createElement: fakeEl,
  head: { appendChild() {} }, body: { appendChild() {}, contains: () => false },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
};
global.window = {};
global.requestAnimationFrame = (f) => f();
global.caches = undefined;

for (const f of ['hr-model.js', 'tcx-import.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  new Function('window', 'document', 'requestAnimationFrame', src)(
    global.window, global.document, global.requestAnimationFrame);
}
const H = global.window.HrModel;
const T = global.window.TcxImport._internals;

// Profilo reale dell'utente: FC max 180, riposo 53.
// Zone con Karvonen: Z1 117-129, Z2 129-142, Z3 142-155, Z4 155-167, Z5 167+
const MAX = 180, REST = 53;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }
function near(name, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log('  ok   ' + name + ' (' + actual + ')'); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + expected + ' ±' + tol + '\n       avuto  ' + actual); }
}

/** Serie sintetica: n secondi a una certa frequenza, uno al secondo. */
function seg(startSec, seconds, bpm) {
  const out = [];
  for (let i = 0; i < seconds; i++) out.push([startSec + i, bpm]);
  return out;
}

console.log('\n— confini delle zone (coerenza con Karvonen) —');
const b = H.bounds(MAX, REST);
check('Z2 parte a 129', b[1].lo, 129);
check('Z3 parte a 142', b[2].lo, 142);
check('Z4 parte a 155', b[3].lo, 155);

console.log('\n— tempo in zona —');
// 10 minuti a 135 (Z2) + 10 minuti a 148 (Z3) + 5 minuti a 160 (Z4)
const mixed = [].concat(seg(0, 600, 135), seg(600, 600, 148), seg(1200, 300, 160));
const tz = H.timeInZones(mixed, MAX, REST);
check('durata totale in secondi', tz.total, mixed.length - 1);
near('Z2 circa 600 s', tz.secs[2], 600, 2);
near('Z3 circa 600 s', tz.secs[3], 600, 2);
near('Z4 circa 300 s', tz.secs[4], 300, 2);
check('niente in Z1', tz.secs[1], 0);
check('niente in Z5', tz.secs[5], 0);
near('percentuale Z2', tz.pct[2], 40, 1);
near('percentuale Z3', tz.pct[3], 40, 1);
near('percentuale Z4', tz.pct[4], 20, 1);

// IL PUNTO: la media di questa sessione è ~144 bpm, che cade in Z3, e
// riassumerla così cancella completamente i 5 minuti in Z4 e i 10 in Z2.
const avg = Math.round(mixed.reduce((s, p) => s + p[1], 0) / mixed.length);
check('la media cade in Z3', H.zoneOf(avg, MAX, REST), 3);
checkTrue('ma il tracciato mostra tre zone diverse',
  tz.pct[2] > 0 && tz.pct[3] > 0 && tz.pct[4] > 0);

console.log('\n— le pause non gonfiano la zona —');
// 10 minuti a 135, poi un buco di mezz'ora, poi altri 10 minuti.
const withGap = [].concat(seg(0, 600, 135), seg(2400, 600, 135));
const tzGap = H.timeInZones(withGap, MAX, REST);
// Senza la protezione, il salto di 1800 s finirebbe tutto in Z2.
near('il buco vale 1 secondo, non 1800', tzGap.total, 1199, 2);
checkTrue('la durata resta quella reale, non il tempo di calendario',
  tzGap.total < 1300);

console.log('\n— sottocampionamento a 500 punti —');
// Serie realistica: 52 minuti a 1 campione/secondo, come il file vero.
const long = [].concat(
  seg(0, 400, 120),    // Z1
  seg(400, 1200, 136), // Z2
  seg(1600, 1400, 149),// Z3
  seg(3000, 152, 160)  // Z4
);
const samples = long.map(p => ({ t: p[0] * 1000, hr: p[1] }));
const down = T.buildHrSeries(samples);

check('serie ridotta al tetto', down.length, T.MAX_TRACK_POINTS);
check('parte da zero', down[0][0], 0);
check('ultimo punto conservato',
  down[down.length - 1][0], long[long.length - 1][0]);

const full = H.timeInZones(long, MAX, REST);
const red  = H.timeInZones(down, MAX, REST);
let maxErr = 0;
for (let z = 1; z <= 5; z++) maxErr = Math.max(maxErr, Math.abs(full.pct[z] - red.pct[z]));
near('errore massimo sulle percentuali', maxErr, 0, 2);
near('durata quasi identica', red.total, full.total, 10);

console.log('\n— TRIMP —');
const easy = H.trimp(seg(0, 1800, 125), MAX, REST);   // 30 min facili
const hard = H.trimp(seg(0, 1800, 165), MAX, REST);   // 30 min duri
checkTrue('trenta minuti duri pesano più di trenta facili', hard > easy);
checkTrue('e molto di più, non di poco', hard > easy * 2);

const short30 = H.trimp(seg(0, 1800, 145), MAX, REST);
const long60  = H.trimp(seg(0, 3600, 145), MAX, REST);
near('a parità di intensità il doppio del tempo vale il doppio',
  long60 / short30, 2, 0.05);

const t1 = H.trimp(down, MAX, REST);
const t2 = H.trimp(long, MAX, REST);
near('il sottocampionamento non sposta il TRIMP', t1, t2, 2);

console.log('\n— casi degeneri —');
check('serie assente',        H.timeInZones(null, MAX, REST), null);
check('un solo punto',        H.timeInZones([[0, 130]], MAX, REST), null);
check('senza FC massima',     H.timeInZones(mixed, 0, REST), null);
check('TRIMP senza serie',    H.trimp(null, MAX, REST), null);
check('costruzione con un solo campione', T.buildHrSeries([{ t: 0, hr: 130 }]), null);
check('costruzione senza campioni',       T.buildHrSeries([]), null);

// Serie corta: non deve essere toccata.
const tiny = T.buildHrSeries([{ t: 0, hr: 120 }, { t: 1000, hr: 130 }, { t: 2000, hr: 140 }]);
check('serie corta conservata intera', tiny.length, 3);
check('secondi relativi al primo campione', tiny[0][0], 0);
check('secondo campione a 1 s', tiny[1][0], 1);

console.log('\n— senza FC a riposo si usa la percentuale della massima —');
const noRest = H.timeInZones(mixed, MAX, null);
checkTrue('il calcolo funziona comunque', noRest !== null);

// È il problema documentato in migrations/002: senza FC a riposo i
// CONFINI si abbassano (Z2 parte a 108 invece che a 129), quindi la
// stessa frequenza cade in una zona PIÙ ALTA e l'allenamento sembra più
// intenso di quanto sia. Non è un dettaglio: è il motivo per cui è stato
// introdotto Karvonen.
check('senza riposo il confine di Z2 è più basso',
  [H.hrAt(0.6, MAX, null), H.hrAt(0.6, MAX, REST)], [108, 129]);
checkTrue('quindi 140 bpm risulta in una zona più alta',
  H.zoneOf(140, MAX, null) > H.zoneOf(140, MAX, REST));
check('con Karvonen 140 bpm è Z2', H.zoneOf(140, MAX, REST), 2);
check('senza riposo diventa Z3',   H.zoneOf(140, MAX, null), 3);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del tracciato cardiaco superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
