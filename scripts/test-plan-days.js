#!/usr/bin/env node
/**
 * test-plan-days.js
 *
 * Verifica la numerazione dei giorni di un piano dell'AI e l'ordinamento
 * delle schede in dashboard.
 *
 * PERCHÉ ESISTE
 * Il bug segnalato dall'utente: "quando genero le schede con l'IA e le
 * salvo non mette in ordine". La causa non era il numero mancante ma
 * l'ordinamento: le schede di un piano entrano con un solo INSERT e hanno
 * created_at IDENTICO al microsecondo — verificato sui dati veri, cinque
 * righe tutte a 2026-08-23 14:35:25.032541+00. A parità di chiave
 * Postgres non garantisce nessun ordine, quindi le stesse schede
 * potevano uscire diverse da un caricamento all'altro.
 *
 * Il caso che questi controlli difendono davvero è il GIORNO DI RIPOSO.
 * Il parser scarta i blocchi di riposo ma fa comunque avanzare il
 * calendario, quindi le date hanno un buco. Numerare per posizione
 * darebbe 1, 2, 3, 4, 5 e chiamerebbe "Giorno 4" la sessione che il piano
 * chiama Giorno 5; numerare per differenza di date dà 1, 2, 3, 5, 6, cioè
 * come l'AI l'ha scritto. È una differenza che si vede solo con un piano
 * che ha un riposo in mezzo, ed è il primo caso qui sotto.
 *
 * Uso:  node scripts/test-plan-days.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const PlanDays = require(path.join(__dirname, '..', 'public', 'js', 'plan-days.js'));
const { planDayNumbers, planDayNumbersById } = PlanDays;

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

// Il piano vero salvato dall'utente il 23 agosto 2026. Il 26 manca perché
// era riposo: il parser lo scarta ma la data avanza lo stesso.
const T = '2026-08-23 14:35:25.032541+00';
const PIANO_VERO = [
  { id: 'a', created_at: T, scheduled_date: '2026-08-23' },
  { id: 'b', created_at: T, scheduled_date: '2026-08-24' },
  { id: 'c', created_at: T, scheduled_date: '2026-08-25' },
  { id: 'd', created_at: T, scheduled_date: '2026-08-27' },
  { id: 'e', created_at: T, scheduled_date: '2026-08-28' }
];

console.log('\n— il piano vero dell utente, con il riposo in mezzo —');
check('la numerazione salta il giorno di riposo',
  planDayNumbers(PIANO_VERO), [1, 2, 3, 5, 6]);

// Il controllo che dà senso a tutto il modulo: se qualcuno "semplificasse"
// usando l'indice, questa riga fallirebbe.
checkTrue('e NON è la posizione nell elenco',
  JSON.stringify(planDayNumbers(PIANO_VERO)) !== JSON.stringify([1, 2, 3, 4, 5]),
  'per posizione direbbe Giorno 4 dove il piano dice Giorno 5');

console.log('\n— l ordine di partenza non cambia i numeri —');
// Il caso reale: il database le restituisce mescolate, ed è proprio
// quello il bug. I numeri devono dipendere dalle date, non dall'ordine
// in cui arrivano.
const MESCOLATO = [PIANO_VERO[3], PIANO_VERO[0], PIANO_VERO[4], PIANO_VERO[2], PIANO_VERO[1]];
check('numeri corretti anche su un elenco disordinato',
  planDayNumbers(MESCOLATO), [5, 1, 6, 3, 2]);

console.log('\n— piani diversi non si contaminano —');
const T2 = '2026-06-07 19:45:09.075985+00';
const DUE_PIANI = [
  { id: 'x', created_at: T2, scheduled_date: '2026-06-07' },
  { id: 'y', created_at: T2, scheduled_date: '2026-06-09' },
  { id: 'a', created_at: T,  scheduled_date: '2026-08-23' },
  { id: 'b', created_at: T,  scheduled_date: '2026-08-24' }
];
check('ogni piano riparte da 1', planDayNumbers(DUE_PIANI), [1, 3, 1, 2]);

console.log('\n— quando NON si mostra l etichetta —');
check('una scheda sola non è un piano',
  planDayNumbers([{ id: 'solo', created_at: T, scheduled_date: '2026-08-23' }]), [null]);
check('senza data non si può numerare',
  planDayNumbers([
    { id: 'p', created_at: T, scheduled_date: null },
    { id: 'q', created_at: T, scheduled_date: '2026-08-24' },
    { id: 'r', created_at: T, scheduled_date: '2026-08-25' }
  ]), [null, 1, 2]);
check('una data malformata non produce NaN',
  planDayNumbers([
    { id: 'p', created_at: T, scheduled_date: 'domani' },
    { id: 'q', created_at: T, scheduled_date: '2026-08-24' },
    { id: 'r', created_at: T, scheduled_date: '2026-08-25' }
  ]), [null, 1, 2]);
check('elenco vuoto', planDayNumbers([]), []);
check('argomento non valido', planDayNumbers(null), []);

// Se la deduzione "stesso created_at = stesso piano" prendesse un
// abbaglio, il numero diventerebbe assurdo. Meglio niente che "Giorno 843".
check('un intervallo assurdo non viene numerato',
  planDayNumbers([
    { id: 'p', created_at: T, scheduled_date: '2024-01-01' },
    { id: 'q', created_at: T, scheduled_date: '2026-08-24' }
  ]), [1, null]);

console.log('\n— il cambio dell ora legale non sposta i giorni —');
// In Europa l'ora legale finisce il 25 ottobre 2026. Costruendo le date
// nel fuso locale, la differenza fra il 24 e il 26 non farebbe 48 ore ma
// 49, e l'arrotondamento sposterebbe di uno tutti i giorni seguenti.
check('a cavallo del cambio i giorni restano consecutivi',
  planDayNumbers([
    { id: 'p', created_at: T, scheduled_date: '2026-10-24' },
    { id: 'q', created_at: T, scheduled_date: '2026-10-25' },
    { id: 'r', created_at: T, scheduled_date: '2026-10-26' },
    { id: 's', created_at: T, scheduled_date: '2026-10-27' }
  ]), [1, 2, 3, 4]);

console.log('\n— l anteprima, dove le schede non hanno ancora created_at —');
// Prima del salvataggio non c'è timestamp: sono comunque tutte dello
// stesso piano e devono numerarsi lo stesso.
check('senza created_at valgono come un unico piano',
  planDayNumbers([
    { scheduled_date: '2026-08-23' },
    { scheduled_date: '2026-08-24' },
    { scheduled_date: '2026-08-26' }
  ]), [1, 2, 4]);

console.log('\n— la mappa per id usata in dashboard —');
check('id -> numero', planDayNumbersById(PIANO_VERO),
  { a: 1, b: 2, c: 3, d: 5, e: 6 });
check('gli id senza numero non entrano nella mappa',
  planDayNumbersById([{ id: 'solo', created_at: T, scheduled_date: '2026-08-23' }]), {});

// ─── I due file che devono restare d'accordo ────────────────────────
//
// La formula sta in plan-days.js, ma il numero compare in due posti che
// non si parlano. Se uno dei due tornasse a contare le posizioni, i
// controlli qui sopra passerebbero lo stesso: si vede solo guardando i
// file.
const DASH = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');
const AI = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ai-trainer.js'), 'utf8');
const SW = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

console.log('\n— dashboard e anteprima usano la stessa formula —');
checkTrue('dashboard chiama PlanDays', /PlanDays\.planDayNumbersById\s*\(/.test(DASH));
checkTrue('l anteprima chiama PlanDays', /PlanDays\.planDayNumbers\s*\(/.test(AI));
checkTrue('l anteprima non numera più per posizione',
  !/preview-item-number">\$\{i \+ 1\}/.test(AI));

console.log('\n— l ordinamento ha un secondo criterio —');
// Il bug vero. Senza questa riga le schede escono in ordine casuale.
checkTrue('dashboard ordina anche per scheduled_date',
  /\.order\(\s*['"]scheduled_date['"]\s*,\s*\{\s*ascending:\s*true/.test(DASH));
checkTrue('e resta dopo created_at',
  DASH.indexOf("order('created_at'") < DASH.indexOf("order('scheduled_date'"),
  'invertendoli i piani non sarebbero più raggruppati per salvataggio');

console.log('\n— l etichetta è solo per i piani dell AI —');
checkTrue('si numerano solo le schede con provenienza ai',
  /sourceOf\(w\)\s*===\s*'ai'/.test(DASH),
  '"Giorno 1" su una corsa importata da Garmin non vuol dire niente');
checkTrue('l etichetta sta PRIMA del titolo',
  DASH.indexOf('dayBadge(workout)') < DASH.indexOf('class="workout-title"'));

console.log('\n— il grassetto markdown non finisce nel nome —');
// Nel database ci sono schede chiamate "**Camminata post-lavoro**".
const { cleanTitle } = PlanDays;
check('gli asterischi vengono tolti',
  cleanTitle('**Camminata post-lavoro**'), 'Camminata post-lavoro');
check('con il numero del giorno davanti',
  cleanTitle('Giorno 1: **Corsa – Tempo Run**'), 'Corsa – Tempo Run');
check('anche con il trattino come separatore',
  cleanTitle('Giorno 2 – Palestra'), 'Palestra');
check('un titolo già pulito non viene toccato',
  cleanTitle('Corsa – Tempo Run'), 'Corsa – Tempo Run');
check('un titolo tutto grassetto con numero',
  cleanTitle('**Giorno 3: Long Run**'), 'Long Run');
check('un titolo vuoto non diventa "undefined"', cleanTitle(null), '');

checkTrue('ai-trainer usa la versione del modulo, non una copia',
  /window\.PlanDays\s*&&\s*window\.PlanDays\.cleanTitle/.test(AI));
checkTrue('e non ha più il vecchio replace nel nome',
  !/name:\s*firstLine\.replace/.test(AI));

console.log('\n— il service worker serve i file nuovi —');
checkTrue('plan-days.js è nel precache', /'\/js\/plan-days\.js'/.test(SW));
checkTrue('la versione della cache è stata alzata',
  /CACHE_NAME\s*=\s*'didio-v(\d+)'/.test(SW) &&
  Number(SW.match(/CACHE_NAME\s*=\s*'didio-v(\d+)'/)[1]) >= 54,
  'senza il bump il browser continua a servire il JavaScript vecchio');

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli sui giorni del piano superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
