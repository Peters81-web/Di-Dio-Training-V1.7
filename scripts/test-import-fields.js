#!/usr/bin/env node
/**
 * test-import-fields.js
 *
 * Verifica i due campi aggiunti alla finestra di import: le note della
 * sessione e i dati del mattino (variabilità, VO2max, FC a riposo).
 *
 * PERCHÉ ESISTE
 *
 * 1. LE NOTE C'ERANO, MA SI NASCONDEVANO. notesBox usciva con
 *    "if (!riepilogo) return ''", e partsSummary restituisce una stringa
 *    vuota quando i blocchi caricati sono meno di due. Risultato:
 *    caricando UN file — il caso normale — il campo non veniva nemmeno
 *    disegnato. Il riquadro era nato per contenere il riepilogo dei
 *    blocchi multipli e si era portato dietro quella condizione, ma la
 *    nota non serve a riassumere i blocchi: è il campo che l'AI legge
 *    per calibrare i piani successivi.
 *
 * 2. I DATI DEL MATTINO VIVONO IN UNA RIGA CONDIVISA. daily_metrics ha
 *    un vincolo UNIQUE (user_id, metric_date): una riga per giorno, la
 *    stessa che scrive la striscia della dashboard. saveDay manda la
 *    riga INTERA, ed è giusto lì: nella striscia si vede tutta la
 *    giornata, e svuotare un campo vuol dire cancellare.
 *
 *    Dall'import il contesto è opposto: si compila quello che si ha
 *    sott'occhio, e un campo vuoto vuol dire "non lo so". Con saveDay,
 *    importare un'attività con la sola HRV avrebbe CANCELLATO il VO2max
 *    inserito quella mattina, in silenzio. Di qui mergeDay.
 *
 *    Quella funzione qui non viene cercata nel testo: viene ESEGUITA,
 *    con un finto client che registra il payload. È l'unico modo di
 *    dimostrare che un campo vuoto non entra nella scrittura.
 *
 * Uso:  node scripts/test-import-fields.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const p = (...a) => path.join(__dirname, '..', ...a);
const TCX  = fs.readFileSync(p('public', 'js', 'tcx-import.js'), 'utf8');
const DM   = fs.readFileSync(p('public', 'js', 'daily-metrics.js'), 'utf8');
const DASH = fs.readFileSync(p('public', 'html', 'dashboard.html'), 'utf8');
const STAT = fs.readFileSync(p('public', 'html', 'stats.html'), 'utf8');
const WORK = fs.readFileSync(p('public', 'html', 'workout.html'), 'utf8');

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
function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ── daily-metrics.js caricato per davvero, con un finto database ──────
//
// L'ultimo upsert finisce in `ultimo`, così si puo' guardare ESATTAMENTE
// quali colonne sono state spedite.
const registro = { ultimo: null, chiamate: 0 };
const finto = {
  from() { return this; },
  select() { return this; },
  eq()    { return this; },
  gte()   { return this; },
  order() { return this; },
  maybeSingle() { return Promise.resolve({ data: null, error: null }); },
  upsert(row) {
    registro.ultimo = row; registro.chiamate++;
    return Promise.resolve({ data: [row], error: null });
  },
  then(f) { return Promise.resolve({ data: [], error: null }).then(f); }
};

const sandbox = {
  window: { supabaseClient: finto },
  document: { getElementById: () => null, createElement: () => ({ style: {} }),
              head: { appendChild() {} }, addEventListener() {} },
  console: { warn() {}, error() {}, log() {} },
  setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, String, Number, isNaN
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(DM, sandbox, { filename: 'daily-metrics.js' });
const DailyMetrics = sandbox.window.DailyMetrics;

console.log('\n— daily-metrics espone cio che serve all import —');
checkTrue('mergeDay c e',        typeof DailyMetrics.mergeDay === 'function');
checkTrue('loadDay c e',         typeof DailyMetrics.loadDay === 'function');
checkTrue('validateFields c e',  typeof DailyMetrics.validateFields === 'function');
checkTrue('saveDay NON e esposto',
  typeof DailyMetrics.saveDay !== 'function',
  'manda la riga intera: dall import azzererebbe i campi non compilati');

console.log('\n— mergeDay: un campo vuoto NON cancella quello che c era —');
return_test();
function return_test() {}

(async function () {
  // Il caso che ha motivato tutto: compilo solo la variabilità.
  registro.ultimo = null;
  const esito = await DailyMetrics.mergeDay('u1', '2026-09-13',
    { hrv: 61, vo2max: null, restingHr: null });

  check('scrive un solo campo', esito.scritti, 1);
  check('e manda SOLO quello', Object.keys(registro.ultimo).sort(),
    ['hrv_rmssd', 'metric_date', 'source', 'updated_at', 'user_id']);
  checkTrue('vo2max non compare nel payload',
    !('vo2max' in registro.ultimo),
    'se comparisse come null, cancellerebbe il dato inserito al mattino');
  checkTrue('e nemmeno il sonno',
    !('sleep_minutes' in registro.ultimo),
    'la riga e condivisa con la striscia della dashboard');
  check('la data e quella chiesta', registro.ultimo.metric_date, '2026-09-13');
  check('marcata come inserita a mano', registro.ultimo.source, 'manual');

  // Tutti e tre compilati.
  registro.ultimo = null;
  const tre = await DailyMetrics.mergeDay('u1', '2026-09-13',
    { hrv: 61, vo2max: 48.5, restingHr: 47 });
  check('con tre valori ne scrive tre', tre.scritti, 3);
  check('hrv',       registro.ultimo.hrv_rmssd, 61);
  check('vo2max',    registro.ultimo.vo2max, 48.5);
  check('fc riposo', registro.ultimo.resting_hr, 47);

  // Lo zero e un valore, non un vuoto: non va scartato.
  registro.ultimo = null;
  const zero = await DailyMetrics.mergeDay('u1', '2026-09-13', { restingHr: 0 });
  check('lo zero viene scritto, non scartato', zero.scritti, 1);

  // Nessun campo: NESSUNA scrittura.
  registro.chiamate = 0;
  const vuoto = await DailyMetrics.mergeDay('u1', '2026-09-13',
    { hrv: null, vo2max: '', restingHr: undefined });
  check('senza niente da scrivere, non scrive', vuoto.scritti, 0);
  check('e non tocca il database', registro.chiamate, 0);

  console.log('\n— validateFields ferma i valori impossibili —');
  const v = (f) => DailyMetrics.validateFields(
    Object.assign({ hrv: null, restingHr: null, vo2max: null,
                    sleepMinutes: null, sleepDeep: null, sleepRem: null }, f), '', '', '');
  check('i tre vuoti vanno bene', v({}), null);
  check('valori plausibili pure',  v({ hrv: 61, vo2max: 48.5, restingHr: 47 }), null);
  checkTrue('hrv fuori scala respinta',       !!v({ hrv: 900 }));
  checkTrue('vo2max fuori scala respinto',    !!v({ vo2max: 250 }));
  checkTrue('fc a riposo fuori scala respinta', !!v({ restingHr: 5 }));

  // ── La finestra di import ───────────────────────────────────────
  const NOTE    = bodyOf(TCX, 'notesBox');
  const MATTINO = bodyOf(TCX, 'morningBox');
  const SAVE    = senzaCommenti(bodyOf(TCX, 'saveImport'));
  const GIORNO  = bodyOf(TCX, 'giornoScelto');

  console.log('\n— le note ci sono SEMPRE —');
  checkTrue('notesBox non esce piu a mani vuote',
    !/if \(!riepilogo\) return '';/.test(NOTE),
    'era questa riga a far sparire il campo con un file solo');
  checkTrue('il campo esiste anche senza riepilogo',
    /escapeAttr\(riepilogo \|\| ''\)/.test(NOTE));
  checkTrue('e ha un suggerimento su cosa scriverci',
    /placeholder=/.test(NOTE));
  checkTrue('compare in ENTRAMBI i percorsi, non solo "completa"',
    /\n\s*notesBox\(partsSummary\(parsed\)\) \+/.test(TCX),
    'prima era (completa ? notesBox(...) : \'\')');
  checkTrue('e l import come scheda nuova la salva davvero',
    /async function saveImport\(data, userId, sc, note\)/.test(TCX) &&
    /notes: note \|\| null/.test(SAVE),
    'senza, il campo ci sarebbe e il testo si perderebbe');

  console.log('\n— i dati del mattino —');
  checkTrue('il riquadro esiste',      MATTINO.length > 200, MATTINO.length + ' caratteri');
  checkTrue('e richiudibile',          /<details/.test(MATTINO));
  checkTrue('ha i tre campi',
    /id="tcxHrv"/.test(MATTINO) && /id="tcxVo2"/.test(MATTINO) && /id="tcxRhr"/.test(MATTINO));
  checkTrue('dichiara che i vuoti non azzerano',
    /non vengono azzerati/.test(MATTINO),
    'e la differenza rispetto alla striscia della dashboard');
  checkTrue('compare solo se daily-metrics e caricato',
    /window\.DailyMetrics \? morningBox\(\) : ''/.test(TCX),
    'senza, i campi ci sarebbero e non avrebbero dove scrivere');
  checkTrue('e sparisce se la tabella non esiste',
    /riga\.assente\) \{ morning\.remove\(\)/.test(TCX),
    'migrazione 007 non eseguita');

  console.log('\n— precompilazione e data —');
  checkTrue('legge il giorno prima di mostrare i campi',
    /DailyMetrics\.loadDay\(userId, giorno\)/.test(TCX));
  checkTrue('si richiude se il giorno ha gia dei dati',
    /morning\.open = !gia/.test(TCX));
  checkTrue('e si rilegge se cambi la data',
    /campoData\.addEventListener\('change', precompila\)/.test(TCX),
    'i valori appartengono a un giorno: correggendo la data non sono piu i suoi');
  checkTrue('la data usata e quella del campo, non oggi',
    /#tcxWhen/.test(GIORNO) && /parsed && parsed\.startIso/.test(GIORNO));

  console.log('\n— ordine delle scritture —');
  const SALVA = senzaCommenti(TCX.slice(TCX.indexOf("saveBtn.addEventListener('click'")));
  checkTrue('i valori si validano PRIMA di salvare l allenamento',
    SALVA.indexOf('validateFields') < SALVA.indexOf('completeExistingPlan'),
    'un vincolo violato dopo il salvataggio perderebbe il dato senza spiegare perche');
  checkTrue('i dati del mattino si scrivono DOPO',
    SALVA.indexOf('completeExistingPlan') < SALVA.indexOf('DailyMetrics.mergeDay'));
  // ATTENZIONE: qui il controllo ovvio NON basta.
  //
  // La prima versione cercava il messaggio "Allenamento salvato, ma i
  // dati del mattino no" dentro il catch. L'ho rotta infilando un
  // "throw e;" in cima al blocco — cioe' facendo fallire tutto l'import
  // per colpa di una tabella secondaria — e il controllo e' rimasto
  // VERDE: il messaggio c'era ancora, solo che non lo raggiungeva piu'
  // nessuno. Quindi si guarda il corpo del catch e si pretende che non
  // rilanci.
  const iCatch = SALVA.indexOf("console.warn('Dati del mattino non salvati.'");
  const corpoCatch = iCatch === -1 ? '' : SALVA.slice(SALVA.lastIndexOf('catch', iCatch), iCatch + 400);
  checkTrue('e un loro fallimento non fa perdere l allenamento',
    /Allenamento salvato, ma i dati del mattino no/.test(SALVA) &&
    !/\bthrow\b/.test(corpoCatch),
    'vivono in un altra tabella: non devono trascinarsi dietro l import');

  console.log('\n— daily-metrics.js e caricato dove serve —');
  // NOTA SULL'ORDINE, perche' il primo controllo che avevo scritto era
  // SBAGLIATO e segnalava un guasto che non c'era.
  //
  // Pretendevo daily-metrics.js PRIMA di tcx-import.js, come per
  // weather.js. Sulla dashboard non e' cosi', e il controllo falliva su
  // codice corretto. Ma weather e tcx-import sono un caso diverso: qui
  // tcx-import non cattura niente al caricamento — legge
  // window.DailyMetrics in sette punti, tutti dentro funzioni che
  // partono da un clic, quando entrambi i file sono gia' interpretati da
  // un pezzo. Quindi l'ordine e' indifferente, e imporlo avrebbe voluto
  // dire spostare uno script sulla dashboard per rispettare un vincolo
  // inventato — rischiando la dipendenza vera che quel punto ha
  // (fase3-features.js).
  //
  // Cio' che conta davvero e' che il file ci sia, e che tcx-import
  // continui a leggerlo pigramente.
  ['dashboard', 'stats', 'workout'].forEach(function (nome, i) {
    const html = [DASH, STAT, WORK][i];
    checkTrue(nome + '.html carica daily-metrics.js',
      /src="\/js\/daily-metrics\.js"/.test(html));
    checkTrue(nome + '.html carica anche tcx-import.js',
      /src="\/js\/tcx-import\.js"/.test(html));
  });
  checkTrue('e nessuna lettura avviene al caricamento del file',
    TCX.split('\n')
       .filter(l => l.indexOf('window.DailyMetrics') !== -1)
       .every(l => (l.match(/^ */)[0].length >= 6)),
    'dentro l IIFE il livello piu esterno e a 2 spazi: una lettura li sarebbe ' +
    'una cattura al caricamento, e renderebbe l ordine degli script ' +
    'improvvisamente importante');

  console.log('\n' + (fail === 0
    ? `  Tutti i ${pass} controlli dei campi dell import superati.`
    : `  ${fail} FALLITI su ${pass + fail}.`));
  process.exit(fail === 0 ? 0 : 1);
})();
