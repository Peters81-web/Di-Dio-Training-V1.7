#!/usr/bin/env node
/**
 * test-dashboard-pending.js
 *
 * Verifica che la dashboard mostri solo gli allenamenti DA FARE, in
 * ordine crescente, e che togliendo le completate non si perda niente:
 * l'Archivio deve poter mostrare il tempo in zona al posto suo.
 *
 * PERCHÉ ESISTE
 * Due cose, entrambe scoperte guardando la pagina invece della query.
 *
 * 1. L'elenco teneva tutto insieme: sui dati veri 28 completate e 9 da
 *    fare, e delle 28 ben 27 erano attività importate da Garmin — cose
 *    già fatte in mezzo alle schede da svolgere.
 *
 * 2. L'ORDINE ERA ROVESCIATO, e il criterio SQL non c'entrava. Avevo
 *    aggiunto scheduled_date crescente alla query e dichiarato risolto il
 *    problema, ma groupWorkoutsByMonth riordina le card lato client per
 *    data DECRESCENTE, e quel riordino vince. Simulato sul piano vero
 *    dell'utente il risultato era:
 *
 *      Giorno 7 -> Giorno 6 -> Giorno 5 -> Giorno 3 -> Giorno 2 -> Giorno 1
 *
 *    cioè il piano si leggeva al contrario. Verificare la query non basta:
 *    conta l'ordine con cui le card finiscono nel DOM.
 *
 * Uso:  node scripts/test-dashboard-pending.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const DASH = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');
const ARC = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'archivio.js'), 'utf8');
const HR = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'hr-model.js'), 'utf8');
const ARC_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'html', 'archivio.html'), 'utf8');
const DASH_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'html', 'dashboard.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const HRZ_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'hr-zones.css'), 'utf8');
const DASH_CSS = fs.readFileSync(
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

// ─── L'ordine vero delle card ───────────────────────────────────────
//
// Si estrae il comparatore da dashboard.js e lo si esegue: verificare che
// la query abbia .order() non dice niente, perché il riordino lato client
// arriva DOPO e vince. È esattamente l'errore che ho commesso.
console.log('\n— l ordine con cui le card finiscono nella pagina —');

const cmpSrc = DASH.match(
  /group\.items\.sort\(\((a), (b)\) => \{([\s\S]*?)\n            \}\);/);
checkTrue('il comparatore è leggibile da dashboard.js', !!cmpSrc,
  cmpSrc ? '' : 'group.items.sort è stato spostato o riscritto: aggiorna questo test');
if (!cmpSrc) { console.error('\n  Impossibile proseguire.'); process.exit(1); }

const activityDateOf = new Function('w', `
  const raw = w.completed_at || w.scheduled_date || w.created_at;
  if (!raw) return null;
  const str = String(raw);
  const d = /^\\d{4}-\\d{2}-\\d{2}$/.test(str) ? new Date(str + 'T12:00:00') : new Date(str);
  return isNaN(d.getTime()) ? null : d;`);
const comparatore = new Function('activityDateOf',
  'return (a, b) => {' + cmpSrc[3] + '};')(activityDateOf);

// Il piano vero dell'utente: 24, 25, 26, (27 riposo), 28, 29, 30 agosto.
const PIANO = [
  { g: 'Giorno 1', scheduled_date: '2026-08-24' },
  { g: 'Giorno 2', scheduled_date: '2026-08-25' },
  { g: 'Giorno 3', scheduled_date: '2026-08-26' },
  { g: 'Giorno 5', scheduled_date: '2026-08-28' },
  { g: 'Giorno 6', scheduled_date: '2026-08-29' },
  { g: 'Giorno 7', scheduled_date: '2026-08-30' }
];

const ordinato = PIANO.slice().sort(comparatore).map(w => w.g);
check('il piano si legge dal primo giorno all ultimo', ordinato,
  ['Giorno 1', 'Giorno 2', 'Giorno 3', 'Giorno 5', 'Giorno 6', 'Giorno 7']);

// Il controllo che dà senso a tutto: se qualcuno rimettesse il verso
// decrescente, questa riga fallisce.
checkTrue('e NON al contrario, come faceva prima',
  ordinato[0] !== 'Giorno 7',
  'era Giorno 7 -> 6 -> 5 -> 3 -> 2 -> 1');

// Anche mescolando l'ingresso: l'ordine non deve dipendere da come
// arrivano le righe dal database.
const mescolato = [PIANO[4], PIANO[0], PIANO[5], PIANO[2], PIANO[1], PIANO[3]];
check('e non dipende dall ordine di arrivo',
  mescolato.slice().sort(comparatore).map(w => w.g), ordinato);

console.log('\n— le schede senza data restano in fondo —');
// In entrambi i versi: invertendo il confronto è facile ritrovarsele in
// cima senza accorgersene.
const conSenzaData = [
  { g: 'senza data', scheduled_date: null },
  { g: 'Giorno 1', scheduled_date: '2026-08-24' },
  { g: 'Giorno 2', scheduled_date: '2026-08-25' }
];
check('anche ordinando in crescente',
  conSenzaData.slice().sort(comparatore).map(w => w.g),
  ['Giorno 1', 'Giorno 2', 'senza data']);

console.log('\n— la dashboard mostra solo il da fare —');
checkTrue('esiste una sola definizione di "da fare"',
  /function pending\(\)\s*\{[\s\S]*?filter\(w => !w\.completed\)/.test(DASH));
checkTrue('e ogni disegno dell elenco ci passa',
  !/displayWorkouts\(workouts\)/.test(DASH),
  'un solo punto rimasto a passare l elenco completo basta a rimettere le completate in pagina');
checkTrue('anche i filtri di provenienza contano solo il da fare',
  !/renderSourceFilters\(workouts\)/.test(DASH));

// Il riquadro "Oggi" invece riceve l'elenco COMPLETO: una sessione già
// fatta va mostrata con la spunta, altrimenti la giornata sembra vuota
// proprio quando l'hai portata a termine.
checkTrue('ma il riquadro "Oggi" riceve tutto', /renderToday\(workouts\)/.test(DASH));

console.log('\n— completando, la scheda esce dall elenco ma resta in "Oggi" —');
checkTrue('non viene più tolta dall array locale',
  !/workouts = workouts\.filter\(w => w\.id !== formData\.workoutId\)/.test(DASH),
  'toglierla svuotava il riquadro "Oggi" invece di mostrarla come fatta');
checkTrue('viene marcata come completata',
  /fatta\.completed = true/.test(DASH));
checkTrue('e "Oggi" viene ridisegnato', /renderToday\(workouts\);/.test(DASH));

console.log('\n— le scadute si distinguono, senza sparire —');
checkTrue('esiste il segno "Non svolta"', /function overdueBadge\(/.test(DASH));
checkTrue('e compare prima del titolo',
  DASH.indexOf('overdueBadge(workout)') < DASH.indexOf('class="workout-title"'));
checkTrue('lo stile è definito', /\.overdue-badge\s*\{/.test(DASH_CSS));
// Non deve fare niente di automatico: la decisione resta all'utente.
checkTrue('non cancella né nasconde niente',
  !/overdue[\s\S]{0,200}(delete|remove|filter)/i.test(
    DASH.slice(DASH.indexOf('function overdueBadge('),
               DASH.indexOf('function overdueBadge(') + 900)));

console.log('\n— lo stato vuoto dice dove sono finite le completate —');
checkTrue('rimanda all Archivio', /Quelli completati sono nell'<a href="\/archivio">/.test(DASH));

// ─── Il costo nascosto della pulizia ────────────────────────────────
//
// Togliere le completate dalla dashboard rende irraggiungibile il
// riquadro "Tempo in zona" per quelle sessioni, perché si apriva dal
// dettaglio di quelle card. L'Archivio non chiedeva hr_series, quindi
// senza questo pezzo la pulizia sarebbe costata una funzione.
console.log('\n— l Archivio può mostrare il tempo in zona —');
checkTrue('chiede hr_series alla scheda collegata',
  /PLAN_COLS\s*=\s*\[[\s\S]*?'hr_series'/.test(ARC));
checkTrue('e disegna il riquadro', /zoneBreakdownHtml\(plan\.hr_series/.test(ARC));
checkTrue('caricando il profilo cardiaco', /HrModel\.loadProfile\(sc, currentUser\.id\)/.test(ARC));
checkTrue('hr-model.js è caricato dalla pagina', /\/js\/hr-model\.js/.test(ARC_HTML));
checkTrue('e prima di archivio.js',
  ARC_HTML.indexOf('/js/hr-model.js') < ARC_HTML.indexOf('/js/archivio.js'));

console.log('\n— il riquadro ha una sola implementazione —');
checkTrue('vive in hr-model.js', /function zoneBreakdownHtml\(/.test(HR));
checkTrue('ed è esportato', /zoneBreakdownHtml: zoneBreakdownHtml/.test(HR));
checkTrue('dashboard non ne tiene una copia',
  !/hrz-block/.test(DASH),
  'due copie significano due formule di Karvonen che col tempo divergono');
checkTrue('anche gli stili sono condivisi', /\.hrz-block\s*\{/.test(HRZ_CSS));
checkTrue('e non sono rimasti in quelli della dashboard', !/\.hrz-/.test(DASH_CSS));
checkTrue('il foglio è caricato da entrambe le pagine',
  /\/css\/hr-zones\.css/.test(ARC_HTML) && /\/css\/hr-zones\.css/.test(DASH_HTML));

console.log('\n— il ripiego dell Archivio non è più tutto-o-niente —');
// Era una lista "con mappa" e una "minima": bastava che mancasse UNA
// colonna per perdere anche tutte le altre, che invece c'erano. È il
// difetto che l'utente ha già pagato quattro volte in produzione.
checkTrue('le vecchie due liste sono sparite',
  !/COLS_WITH_MAP|COLS_LEGACY/.test(ARC));
checkTrue('si toglie una colonna alla volta',
  /plan\.filter\(function \(c\) \{ return c !== bad; \}\)/.test(ARC));
checkTrue('e solo quella che il database nomina',
  /missingColumnName\(res\.error\)/.test(ARC));
checkTrue('un errore che NON è "colonna mancante" resta visibile',
  /if \(!isMissingColumnError\(res\.error\)\) \{ handle\(res\); return; \}/.test(ARC),
  'permessi e rete devono restare visibili: mascherarli nasconde guasti veri');

console.log('\n— il service worker serve i file nuovi —');
checkTrue('hr-zones.css è nel precache', /'\/css\/hr-zones\.css'/.test(SW));
checkTrue('la versione della cache è stata alzata',
  Number((SW.match(/CACHE_NAME\s*=\s*'didio-v(\d+)'/) || [0, 0])[1]) >= 59);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli della dashboard superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
