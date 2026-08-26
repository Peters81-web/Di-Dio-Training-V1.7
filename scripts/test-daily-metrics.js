#!/usr/bin/env node
/**
 * test-daily-metrics.js
 *
 * Test in Node della logica pura di public/js/daily-metrics.js.
 *
 * PERCHÉ ESISTE
 * Qui si sbaglia in modo silenzioso e plausibile. Tre trappole in
 * particolare:
 *
 *  1. IL VERSO. Nella variabilità cardiaca più alto è meglio; nella FC
 *     a riposo più basso è meglio. Invertirne uno produce un'interfaccia
 *     che dice "sei riposato" quando sei sfinito, senza errori.
 *  2. LA LINEA DI BASE. Va calcolata sui giorni PRECEDENTI: includere il
 *     giorno osservato significa misurarlo con un metro che ha
 *     contribuito a costruire, e lo scostamento tende a zero.
 *  3. IL PARSING DEL SONNO. "6:30" sono 390 minuti, non 6,30. Un errore
 *     qui falsa ogni confronto successivo.
 *
 * Uso:  node scripts/test-daily-metrics.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const fakeEl = () => ({
  id: '', textContent: '', innerHTML: '', className: '', style: {},
  appendChild() {}, addEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, remove() {}, setAttribute() {},
  getAttribute() { return null; }, classList: { add() {}, remove() {} },
  children: [], firstChild: null, insertBefore() {}
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
  path.join(__dirname, '..', 'public', 'js', 'daily-metrics.js'), 'utf8');
new Function('window', 'document', 'requestAnimationFrame', src)(
  global.window, global.document, global.requestAnimationFrame);

const D = global.window.DailyMetrics._internals;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + '\n       atteso ' + e + '\n       avuto  ' + a); }
}
function checkTrue(name, cond) { check(name, !!cond, true); }

console.log('\n— riconoscimento "tabella inesistente" —');
checkTrue('PGRST205', D.isMissingTableError({ code: 'PGRST205' }));
checkTrue('42P01',    D.isMissingTableError({ code: '42P01' }));
checkTrue('messaggio PostgREST', D.isMissingTableError({
  message: "Could not find the table 'public.daily_metrics' in the schema cache" }));
// Non deve mascherare guasti veri: sono dati sanitari, un problema di
// permessi deve restare visibile.
check('permesso negato NON è tabella mancante',
  D.isMissingTableError({ code: '42501', message: 'permission denied' }), false);
check('violazione RLS NON è tabella mancante',
  D.isMissingTableError({ code: '42501', message: 'violates row-level security policy' }), false);
check('vincolo violato NON è tabella mancante',
  D.isMissingTableError({ code: '23514', message: 'violates check constraint "daily_metrics_hrv_range"' }), false);
check('rete NON è tabella mancante',
  D.isMissingTableError({ message: 'Failed to fetch' }), false);

console.log('\n— linea di base —');
const rows = [
  { metric_date: '2026-08-18', hrv_rmssd: 40, resting_hr: 58, sleep_minutes: 380 },
  { metric_date: '2026-08-17', hrv_rmssd: 55, resting_hr: 52, sleep_minutes: 420 },
  { metric_date: '2026-08-16', hrv_rmssd: 57, resting_hr: 51, sleep_minutes: 400 },
  { metric_date: '2026-08-15', hrv_rmssd: 53, resting_hr: 53, sleep_minutes: 430 },
  { metric_date: '2026-08-14', hrv_rmssd: 60, resting_hr: 50, sleep_minutes: 410 },
  { metric_date: '2026-08-13', hrv_rmssd: 55, resting_hr: 52, sleep_minutes: 405 }
];
const base = D.baseline(rows, '2026-08-18');
// Media dei 5 giorni precedenti: (55+57+53+60+55)/5 = 56
check('media della variabilità esclude il giorno osservato', base.hrv_rmssd, 56);
check('media della FC a riposo', base.resting_hr, 51.6);   // (52+51+53+50+52)/5

// Il punto 2: includere il giorno osservato abbasserebbe la media e
// nasconderebbe il calo.
const baseWrong = D.baseline(rows, null);
checkTrue('includere il giorno osservato cambia la media',
  baseWrong.hrv_rmssd !== base.hrv_rmssd);
checkTrue('e la abbassa, nascondendo il calo', baseWrong.hrv_rmssd < base.hrv_rmssd);

// Con pochi campioni la media non si mostra: meglio nessun confronto
// che uno costruito su due giorni.
const few = D.baseline(rows.slice(0, 3), '2026-08-18');
check('meno di 5 campioni: nessuna linea di base', few.hrv_rmssd, null);
check('soglia dichiarata', D.BASELINE_MIN_SAMPLES, 5);

console.log('\n— scostamento —');
check('calo del 29%',  D.deviation(40, 56), -29);
check('nessuno scarto', D.deviation(56, 56), 0);
check('aumento',        D.deviation(62, 56), 11);
check('senza riferimento', D.deviation(40, null), null);
check('riferimento zero', D.deviation(40, 0), null);

console.log('\n— il VERSO delle due letture —');
// Variabilità: PIÙ ALTO è meglio.
check('variabilità bassa = allarme', D.readHrv(40, 56).level, 'low');
check('variabilità alta = bene',     D.readHrv(64, 56).level, 'high');
check('variabilità stabile',         D.readHrv(57, 56).level, 'normal');

// FC a riposo: PIÙ BASSO è meglio. È il verso opposto, ed è l'errore
// più facile da commettere leggendo questi numeri.
check('FC a riposo alta = allarme',  D.readRestingHr(58, 52).level, 'low');
check('FC a riposo bassa = bene',    D.readRestingHr(49, 52).level, 'high');
check('FC a riposo stabile',         D.readRestingHr(53, 52).level, 'normal');

checkTrue('i due versi sono davvero opposti',
  D.readHrv(40, 56).level === 'low' && D.readRestingHr(40, 56).level === 'high');

check('senza riferimento nessuna lettura', D.readHrv(40, null), null);

console.log('\n— sonno: formattazione e lettura —');
check('390 minuti',      D.fmtSleep(390), '6h 30m');
check('ore tonde',       D.fmtSleep(420), '7h');
check('meno di un ora',  D.fmtSleep(45),  '45m');
check('assente',         D.fmtSleep(null), null);

// Il punto 3: "6:30" sono 390 minuti, non 6,30.
check('"6:30" -> 390',   D.parseSleep('6:30'), 390);
check('"6h30" -> 390',   D.parseSleep('6h30'), 390);
check('"7:00" -> 420',   D.parseSleep('7:00'), 420);
check('"390" -> 390',    D.parseSleep('390'),  390);
check('"6" -> 6 minuti', D.parseSleep('6'),    6);
check('vuoto',           D.parseSleep(''),     null);
check('testo',           D.parseSleep('boh'),  null);
check('minuti impossibili', D.parseSleep('6:75'), null);
checkTrue('andata e ritorno',
  D.fmtSleep(D.parseSleep('6:30')) === '6h 30m');

console.log('\n— validazione prima del database —');
const ok = { hrv: 55, restingHr: 52, sleepMinutes: 420, sleepDeep: 70, sleepRem: 85, vo2max: 48 };
check('valori validi',        D.validate(ok, '7:00', '1:10', '1:25'), null);
check('variabilità fuori scala',
  D.validate(Object.assign({}, ok, { hrv: 900 }), '', '', ''),
  'La variabilità cardiaca deve stare fra 1 e 300 ms.');
check('FC a riposo fuori scala',
  D.validate(Object.assign({}, ok, { restingHr: 200 }), '', '', ''),
  'La FC a riposo deve stare fra 30 e 120 bpm.');

// Le fasi non possono superare il totale: è il vincolo che in
// migrations/007 impedisce un sonno più lungo della notte.
check('fasi oltre il totale',
  D.validate({ hrv: null, restingHr: null, sleepMinutes: 120, sleepDeep: 90, sleepRem: 90, vo2max: null }, '', '', ''),
  'Profondo e REM insieme superano il sonno totale.');

// Testo scritto ma non interpretabile: va segnalato, altrimenti il
// campo verrebbe salvato vuoto senza che nessuno lo dica.
checkTrue('sonno illeggibile segnalato',
  /^Sonno totale non riconosciuto\./.test(
    D.validate({ hrv: null, restingHr: null, sleepMinutes: null,
                 sleepDeep: null, sleepRem: null, vo2max: null },
               'boh', '', '') || ''),
  'il testo esatto cambia; quello che conta e che il campo venga nominato')
check('campi vuoti non sono un errore',
  D.validate({ hrv: null, restingHr: null, sleepMinutes: null, sleepDeep: null, sleepRem: null, vo2max: null }, '', '', ''),
  null);

// ─── I due guasti dello screenshot ──────────────────────────────────
//
// L'utente ha compilato la scheda del recupero, ha premuto Salva, non e'
// successo niente ed e' comparso un riquadro con dentro solo un'icona.
// Due cause indipendenti.
console.log('\n— il sonno scritto col punto —');

// PRIMA CAUSA: "5.42" per cinque ore e quarantadue veniva rifiutato.
// parseSleep accettava i due punti, la "h" e la "m", non il punto — che
// in italiano e' un modo altrettanto normale di scrivere un orario.
check('cinque ore e quarantadue col punto', D.parseSleep('5.42'), 342);
check('con la virgola',                     D.parseSleep('5,42'), 342);
check('un ora e dieci col punto',           D.parseSleep('1.10'), 70);
check('i due punti continuano a valere',    D.parseSleep('1:25'), 85);
check('e la h pure',                        D.parseSleep('5h42'), 342);
check('solo cifre restano minuti',          D.parseSleep('342'),  342);

// I minuti oltre 59 restano rifiutati con ogni separatore: e' quello che
// distingue "ore.minuti" da un numero decimale scritto per sbaglio.
check('minuti impossibili col punto',  D.parseSleep('5.60'), null);
check('minuti impossibili coi due punti', D.parseSleep('5:60'), null);
check('testo qualsiasi',               D.parseSleep('ciao'), null);
check('campo vuoto',                   D.parseSleep(''),     null);

// AMBIGUITA' DICHIARATA, non nascosta: "5.5" e' 5 ore e 5 minuti, non
// cinque ore e mezza. E' coerente con il formato che il campo dichiara.
check('"5.5" vale cinque e cinque, non cinque e mezza', D.parseSleep('5.5'), 305);

console.log('\n— e l etichetta lo dice —');
const DM = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'daily-metrics.js'), 'utf8');
checkTrue('il suggerimento sotto il campo nomina le forme accettate',
  /5:42, 5\.42 o 5h42/.test(DM),
  'senza, la forma col punto resterebbe da indovinare');
checkTrue('e il messaggio di errore pure',
  /Scrivi ore e minuti \(6:30, 6\.30, 6h30\)/.test(DM));

console.log('\n— il messaggio invisibile —');
// SECONDA CAUSA, e la piu' grave: il messaggio c'era ma non si leggeva.
// utils.js scriveva class="toast warning", mentre dashboard-enhanced.css
// stila .toast-warning col trattino e dichiara .toast { color: white }.
// Nessuno sfondo colorato, sfondo chiaro da styles.css, testo bianco:
// bianco su bianco. Riguardava OGNI messaggio di window.showToast su
// quella pagina, non solo questo.
const UTILS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'utils.js'), 'utf8');
const CSS_DASH = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'dashboard-enhanced.css'), 'utf8');
const CSS_BASE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

checkTrue('il toast porta entrambe le convenzioni',
  /toast\.className = `toast toast-\$\{type\} \$\{type\}`/.test(UTILS));

// Il controllo che conta: per ogni tipo, la classe che il JS scrive deve
// esistere in almeno un foglio di stile INSIEME a uno sfondo. Senza
// sfondo, il "color: white" di dashboard-enhanced lascia il testo
// invisibile.
['success', 'error', 'warning', 'info'].forEach(function (t) {
  const conTrattino = new RegExp('\\.toast-' + t + '\\s*\\{[^}]*background');
  const conPunto    = new RegExp('\\.toast\\.' + t + '\\s*\\{[^}]*background');
  checkTrue('lo sfondo di "' + t + '" viene applicato',
    conTrattino.test(CSS_DASH) || conPunto.test(CSS_BASE) || conPunto.test(CSS_DASH),
    'la classe scritta dal JS deve combaciare con quella stilata');
});

// E la prova diretta del bianco su bianco: se un foglio dichiara
// color:white su .toast, allora la classe di tipo DEVE portare uno
// sfondo, altrimenti il testo sparisce.
if (/\.toast\s*\{[^}]*color:\s*white/.test(CSS_DASH)) {
  checkTrue('con .toast{color:white} ogni tipo ha il suo sfondo',
    ['success', 'error', 'warning', 'info'].every(function (t) {
      return new RegExp('\\.toast-' + t + '\\s*\\{[^}]*background').test(CSS_DASH);
    }),
    'era esattamente il caso: testo bianco su sfondo chiaro');
}

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli delle metriche di recupero superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
