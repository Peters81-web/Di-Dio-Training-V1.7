#!/usr/bin/env node
/**
 * test-recovery-load.js
 *
 * Test in Node del peso che una sessione ha sul recupero
 * (sessionLoad in fase3-features.js).
 *
 * PERCHÉ ESISTE
 * Questo coefficiente decide quante ore di recupero vengono mostrate. Un
 * errore non produce eccezioni: produce numeri credibili e sbagliati, e
 * l'utente si allena su quelli.
 *
 * Il caso che ha motivato il cambiamento è reale. Una corsa di 52 minuti
 * con 12% Z1, 38% Z2, 45% Z3 e 5% Z4 aveva FC media 141, che cade in Z2:
 * il calcolo sulla media le assegnava il coefficiente del fondo lento
 * (0,7) e stimava 54 ore di recupero per le gambe. Pesando sul tracciato
 * il coefficiente sale a 0,85 e le ore a 66. Dodici ore di differenza per
 * la stessa identica sessione.
 *
 * Uso:  node scripts/test-recovery-load.js
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
// In Node 22 `navigator` è un global in sola lettura: si passa come
// parametro invece di assegnarlo. setInterval/setTimeout vengono
// neutralizzati perché fase3-features avvia il polling di supabaseClient
// al caricamento, e in un test terrebbe vivo il processo.
const fakeNavigator = { serviceWorker: undefined, onLine: true };
const noop = () => 0;

for (const f of ['hr-model.js', 'fase3-features.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  new Function('window', 'document', 'navigator', 'setInterval', 'clearInterval', 'setTimeout', src)(
    global.window, global.document, fakeNavigator, noop, noop, noop);
}
const H = global.window.HrModel;
const R = global.window.RecoveryModel._internals;

const HR = { maxHr: 180, restHr: 53, maxIsMeasured: true };

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }
function near(name, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log('  ok   ' + name + ' (' + Math.round(actual * 100) / 100 + ')'); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + expected + ' ±' + tol + '\n       avuto  ' + actual); }
}

function seg(start, seconds, bpm) {
  const out = [];
  for (let i = 0; i < seconds; i++) out.push([start + i, bpm]);
  return out;
}

// La corsa reale: 52 minuti, distribuzione 12/38/45/5.
const realRun = [].concat(
  seg(0, 387, 120), seg(387, 1178, 136), seg(1565, 1402, 149), seg(2967, 170, 160));

console.log('\n— la sessione reale: media contro tracciato —');
const avgBpm = Math.round(realRun.reduce((s, p) => s + p[1], 0) / realRun.length);
check('la FC media cade in Z2', H.zoneOf(avgBpm, HR.maxHr, HR.restHr), 2);

const withAvg = R.sessionLoad(
  { heart_rate_avg: avgBpm, actual_duration: 52, workout_plans: {} }, HR);
const withSeries = R.sessionLoad(
  { heart_rate_avg: avgBpm, actual_duration: 52, workout_plans: { hr_series: realRun } }, HR);

check('senza tracciato usa la media',  withAvg.fromSeries, false);
check('con tracciato lo dichiara',     withSeries.fromSeries, true);
checkTrue('il tracciato pesa di più',  withSeries.factor > withAvg.factor);

// 72 ore di riferimento per le gambe.
const oreAvg = 72 * withAvg.factor;
const oreSer = 72 * withSeries.factor;
near('ore stimate con la media',     oreAvg, 54, 3);
near('ore stimate col tracciato',    oreSer, 66, 3);
checkTrue('la differenza supera le 10 ore', oreSer - oreAvg > 10);

console.log('\n— la zona mostrata è quella dominante, non quella della media —');
check('dominante = Z3', withSeries.zone, 3);
check('dalla media   = Z2', withAvg.zone, 2);

console.log('\n— coerenza dei coefficienti —');
// Una sessione tutta in una zona deve dare esattamente il coefficiente
// di quella zona: se così non fosse, la media pesata sarebbe sbagliata.
[1, 2, 3, 4, 5].forEach(z => {
  const b = H.bounds(HR.maxHr, HR.restHr)[z - 1];
  const bpm = Math.round((b.lo + b.hi) / 2);
  const pure = R.sessionLoad(
    { heart_rate_avg: bpm, actual_duration: 45,
      workout_plans: { hr_series: seg(0, 1800, bpm) } }, HR);
  // durata 45 min = fattore 1, quindi il fattore finale è quello di zona
  near('tutto in Z' + z + ' -> coefficiente ' + R.ZONE_LOAD[z], pure.factor, R.ZONE_LOAD[z], 0.02);
});

console.log('\n— un intervallato non è un fondo lento —');
// Stessa FC media, distribuzioni opposte: 30 min tutti a 141 contro
// 15 min in Z1 e 15 in Z4. La media non li distingue, il tracciato sì.
const steady   = seg(0, 1800, 141);
const interval = [].concat(seg(0, 900, 120), seg(900, 900, 162));
const mSteady   = Math.round(steady.reduce((s, p) => s + p[1], 0) / steady.length);
const mInterval = Math.round(interval.reduce((s, p) => s + p[1], 0) / interval.length);
check('le due medie sono quasi uguali', Math.abs(mSteady - mInterval) <= 2, true);

const lSteady = R.sessionLoad(
  { heart_rate_avg: mSteady, actual_duration: 30, workout_plans: { hr_series: steady } }, HR);
const lInterval = R.sessionLoad(
  { heart_rate_avg: mInterval, actual_duration: 30, workout_plans: { hr_series: interval } }, HR);
checkTrue('ma l intervallato pesa di più', lInterval.factor > lSteady.factor);

console.log('\n— ripieghi —');
const noHr = R.sessionLoad({ heart_rate_avg: null, actual_duration: 45, workout_plans: {} }, HR);
check('senza FC coefficiente neutro', noHr.factor, 1);
check('e lo dichiara',                noHr.hasHr, false);

const noProfile = R.sessionLoad(
  { heart_rate_avg: 150, actual_duration: 45, workout_plans: { hr_series: realRun } }, null);
check('senza profilo FC nessuna zona', noProfile.zone, null);
check('e nessun tracciato usato',      noProfile.fromSeries, false);

const badSeries = R.sessionLoad(
  { heart_rate_avg: 141, actual_duration: 45, workout_plans: { hr_series: [[0, 130]] } }, HR);
check('serie di un solo punto ignorata', badSeries.fromSeries, false);

console.log('\n— il fattore resta entro limiti sensati —');
const veryLong = R.sessionLoad(
  { heart_rate_avg: 175, actual_duration: 600,
    workout_plans: { hr_series: seg(0, 36000, 175) } }, HR);
checkTrue('mai oltre 2', veryLong.factor <= 2);
const veryShort = R.sessionLoad(
  { heart_rate_avg: 118, actual_duration: 5,
    workout_plans: { hr_series: seg(0, 300, 118) } }, HR);
checkTrue('mai sotto 0,4', veryShort.factor >= 0.4);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del peso sul recupero superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
