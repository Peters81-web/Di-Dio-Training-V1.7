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

// ─── La data scritta nel titolo ─────────────────────────────────────
//
// IL CASO REALE: il 23 agosto l'utente ha chiesto un piano "a partire dal
// 24". Il modello ha ubbidito e ha intitolato la prima sessione
// "24 Agosto – Corsa – Zone 2 + Core", ma il parser scartava la data e
// ripartiva da oggi: il piano è finito tutto sfasato di un giorno, e il
// 24 la dashboard mostrava la sessione intitolata "25 Agosto".
const { parsePlanDate, addDays, schedulePlanDates } = PlanDays;
const OGGI = '2026-08-23';

console.log('\n— la data si legge dal titolo —');
check('il titolo che ha causato il bug',
  parsePlanDate('24 Agosto – Corsa – Zone 2 + Core', OGGI), '2026-08-24');
check('con il numero del giorno davanti',
  parsePlanDate('Giorno 1 — 24/08/2026: Palestra', OGGI), '2026-08-24');
check('con il giorno della settimana',
  parsePlanDate('Lunedì 24 agosto – Corsa lenta', OGGI), '2026-08-24');
check('mese abbreviato', parsePlanDate('24 ago 2026 – Corsa', OGGI), '2026-08-24');
check('forma numerica senza anno', parsePlanDate('24/08 – Corsa', OGGI), '2026-08-24');
check('forma numerica con anno a due cifre',
  parsePlanDate('24/08/26 – Corsa', OGGI), '2026-08-24');
check('in grassetto', parsePlanDate('**24 Agosto – Corsa**', OGGI), '2026-08-24');

console.log('\n— e NON si legge dove non c è —');
check('titolo senza data', parsePlanDate('Corsa – Zone 2 + Core', OGGI), null);
check('formato vecchio senza data', parsePlanDate('Giorno 1: Palestra', OGGI), null);
check('una data che non esiste', parsePlanDate('31 Febbraio – Corsa', OGGI), null);
check('mese inventato', parsePlanDate('24 Piovoso – Corsa', OGGI), null);
check('argomento vuoto', parsePlanDate('', OGGI), null);

// Il rischio della forma numerica: "10/12" possono essere ripetizioni.
// Per questo si cerca solo nella TESTA del titolo, prima del trattino.
check('le ripetizioni dopo il trattino non diventano una data',
  parsePlanDate('24/08 – Push-up 10/12', OGGI), '2026-08-24');
check('e senza data in testa non si inventa nulla dalle ripetizioni',
  parsePlanDate('Palestra – Push-up 10/12', OGGI), null);
// "10 km" comincia per numero ma "km" non è un mese.
check('una distanza in testa non è una data',
  parsePlanDate('10 km facili', OGGI), null);

console.log('\n— l anno si deduce scegliendo la data più vicina —');
check('a fine dicembre, gennaio è l anno dopo',
  parsePlanDate('3 gennaio – Corsa', '2026-12-28'), '2027-01-03');
check('a inizio gennaio, dicembre è l anno prima',
  parsePlanDate('28 dicembre – Corsa', '2027-01-03'), '2026-12-28');
check('l anno scritto vince sulla deduzione',
  parsePlanDate('3 gennaio 2030 – Corsa', '2026-12-28'), '2030-01-03');

console.log('\n— la data sparisce dal nome —');
check('il titolo che ha causato il bug',
  cleanTitle('24 Agosto – Corsa – Zone 2 + Core'), 'Corsa – Zone 2 + Core');
check('formato nuovo completo',
  cleanTitle('Giorno 1 — 24/08/2026: Palestra – Forza'), 'Palestra – Forza');
check('con il giorno della settimana in mezzo',
  cleanTitle('Giorno 2: Lunedì 24 Agosto – Corsa'), 'Corsa');
check('una distanza in testa NON viene mangiata',
  cleanTitle('10 km facili'), '10 km facili');
check('un titolo senza prefissi resta intero',
  cleanTitle('Corsa – Zone 2 + Core'), 'Corsa – Zone 2 + Core');

console.log('\n— il piano vero, dal titolo al calendario —');
// I titoli esattamente come il modello li ha scritti il 23 agosto, dopo
// che l'utente aveva chiesto di partire dal 24. Il riposo è al quinto
// blocco e NON va tolto prima: occupa un giorno di calendario.
const TITOLI_VERI = [
  '24 Agosto – Corsa – Zone 2 + Core',
  '25 Agosto – Palestra – Forza a corpo libero',
  '26 Agosto – Corsa Fartlek (Zona 3)',
  '27 Agosto – Riposo attivo',
  '28 Agosto – Corsa a ritmo gara (Zona 3)',
  '29 Agosto – Ciclismo (Zona 1‑2)',
  '30 Agosto – Palestra – Full Body + Stretch'
];
check('le date del piano sono quelle chieste dall utente',
  schedulePlanDates(TITOLI_VERI, OGGI),
  ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
   '2026-08-28', '2026-08-29', '2026-08-30']);
checkTrue('e il piano NON parte più dal giorno della generazione',
  schedulePlanDates(TITOLI_VERI, OGGI)[0] !== OGGI,
  'partiva dal 23, che è il bug segnalato dall utente');

console.log('\n— i tre comportamenti del cursore —');
check('piano senza date: parte da oggi e avanza, come prima',
  schedulePlanDates(['Giorno 1: Corsa', 'Giorno 2: Palestra', 'Giorno 3: Riposo',
                     'Giorno 4: Corsa'], OGGI),
  ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26']);
check('piano misto: riparte dall ultima data certa, non da oggi',
  schedulePlanDates(['1 settembre – Corsa', 'Giorno 2: Palestra',
                     'Giorno 3: Corsa'], OGGI),
  ['2026-09-01', '2026-09-02', '2026-09-03']);
check('un riposo in mezzo occupa il suo giorno',
  schedulePlanDates(['Giorno 1: Corsa', 'Giorno 2: Riposo', 'Giorno 3: Palestra'], OGGI),
  ['2026-08-23', '2026-08-24', '2026-08-25']);
check('un piano che scavalca il fine mese',
  schedulePlanDates(['30 agosto – Corsa', 'Giorno 2: Palestra', 'Giorno 3: Corsa'], OGGI),
  ['2026-08-30', '2026-08-31', '2026-09-01']);
check('elenco vuoto', schedulePlanDates([], OGGI), []);

// Le etichette "Giorno N" e le date devono raccontare la stessa storia.
const dateVere = schedulePlanDates(TITOLI_VERI, OGGI);
const senzaRiposo = dateVere
  .filter((_, i) => !/riposo/i.test(TITOLI_VERI[i]))
  .map(d => ({ created_at: 'x', scheduled_date: d }));
check('e la numerazione dei giorni salta il riposo',
  planDayNumbers(senzaRiposo), [1, 2, 3, 5, 6, 7]);

console.log('\n— il cursore delle date nel parser —');
checkTrue('il parser usa la funzione del modulo',
  /PlanDays\.schedulePlanDates\s*\(/.test(AI));
checkTrue('e calcola le date su TUTTI i blocchi, riposi compresi',
  /schedulePlanDates\(titles,/.test(AI),
  'filtrando i riposi prima, ogni sessione dopo slitterebbe indietro');
checkTrue('e non riparte più da un contatore ancorato a oggi',
  !/startDate\.setDate\(startDate\.getDate\(\) \+ 1\)/.test(AI),
  'era la riga che sfasava tutto il piano');
checkTrue('la data salvata è quella calcolata, non un offset su oggi',
  /scheduled_date:\s*dates\[idx\]/.test(AI));

check('addDays attraversa il fine mese', addDays('2026-08-31', 1), '2026-09-01');
check('addDays attraversa il fine anno', addDays('2026-12-31', 1), '2027-01-01');
check('addDays su un anno bisestile', addDays('2028-02-28', 1), '2028-02-29');
check('addDays su una data non valida', addDays('domani', 1), null);

console.log('\n— il prompt dice al modello che giorno è —');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
checkTrue('la data di oggi finisce nel prompt', /Oggi è \$\{oggiEsteso\}/.test(SERVER));
checkTrue('il formato del titolo chiede la data', /### Giorno N — GG\/MM\/AAAA/.test(SERVER));
checkTrue('anche per i giorni di riposo',
  (SERVER.match(/### Giorno N — GG\/MM\/AAAA/g) || []).length >= 2,
  'un riposo senza data spezzerebbe il conteggio dei giorni successivi');
checkTrue('e spiega che la data viene usata davvero',
  /l'applicazione ci programma sopra/.test(SERVER));

// ─── La struttura del piano, letta con tolleranza ───────────────────
//
// IL BUG: il parser pretendeva "### " per il titolo e "#### " per le
// sottosezioni. Qualunque altra forma dava ZERO schede IN SILENZIO — il
// piano si vedeva a schermo perché marked renderizza tutto, ma "Salva"
// rispondeva "Nessun allenamento da salvare" e l'utente non aveva modo
// di collegare le due cose. Misurato prima della correzione: delle sei
// forme che un modello scrive comunemente ne veniva letta UNA.
//
// Un formato rigido è ragionevole da CHIEDERE nel prompt; pretenderlo
// per LEGGERE è un'altra cosa.
console.log('\n— la struttura si legge in tutte le forme che il modello usa —');

const { parsePlanBlocks } = PlanDays;
const CORPO = '\n- 10 min\n';

const FORME = {
  '#### Riscaldamento (il formato chiesto)':
    '### Giorno 1 — 27/08/2026: Corsa\n#### Riscaldamento' + CORPO + '#### Fase Principale\n- 30 min\n',
  'sottosezioni in grassetto':
    '### Giorno 1 — 27/08/2026: Corsa\n**Riscaldamento**' + CORPO + '**Fase Principale**\n- 30 min\n',
  'sottosezioni con tre cancelletti':
    '### Giorno 1 — 27/08/2026: Corsa\n### Riscaldamento' + CORPO + '### Fase Principale\n- 30 min\n',
  'sottosezioni con i due punti':
    '### Giorno 1 — 27/08/2026: Corsa\nRiscaldamento:' + CORPO + 'Fase Principale:\n- 30 min\n',
  'titolo con due cancelletti':
    '## Giorno 1 — 27/08/2026: Corsa\n#### Riscaldamento' + CORPO + '#### Fase Principale\n- 30 min\n',
  'titolo in grassetto senza cancelletti':
    '**Giorno 1 — 27/08/2026: Corsa**\n#### Riscaldamento' + CORPO + '#### Fase Principale\n- 30 min\n'
};

Object.keys(FORME).forEach(function (nome) {
  const b = parsePlanBlocks(FORME[nome]);
  checkTrue(nome, b.length === 1 && !!b[0].mainPhase,
    b.length + ' blocchi, fase principale ' + (b[0] && b[0].mainPhase ? 'letta' : 'VUOTA'));
});

console.log('\n— e un giorno scritto senza sottosezioni non va perso —');
const libero = parsePlanBlocks('### Giorno 1 — 27/08/2026: Corsa\n30 min a 6:50/km in zona 2.\n');
check('il testo libero diventa la fase principale',
  libero[0].mainPhase, '30 min a 6:50/km in zona 2.');

console.log('\n— ma senza confondere il testo con le intestazioni —');
// "- 5 min di riscaldamento" DENTRO la fase principale non deve essere
// scambiato per l'inizio di una sezione, o spezzerebbe il blocco.
const insidia = parsePlanBlocks(
  '### Giorno 1 — 27/08/2026: Corsa\n#### Fase Principale\n' +
  '- 5 min di riscaldamento leggero prima delle ripetute\n- 8 x 400 m\n');
checkTrue('una riga che NOMINA una sezione non la apre',
  /8 x 400 m/.test(insidia[0].mainPhase) && /riscaldamento leggero/.test(insidia[0].mainPhase),
  JSON.stringify(insidia[0].mainPhase));
check('e il riscaldamento resta vuoto', insidia[0].warmup, '');

// IL CASO CHE SERVE DAVVERO IL LIMITE DI LUNGHEZZA.
// Quello sopra era protetto dall'ancora ^ — "- 5 min di riscaldamento"
// non COMINCIA per "riscaldamento". Una frase che invece comincia
// proprio così passerebbe l'ancora, e senza il tetto sui caratteri
// verrebbe scambiata per un'intestazione: la fase principale finirebbe
// dentro il riscaldamento. Verificato rompendo il codice: senza il
// limite questo controllo fallisce.
const prosa = parsePlanBlocks(
  '### Giorno 1 — 27/08/2026: Corsa\n#### Fase Principale\n' +
  'Riscaldamento e defaticamento sono obbligatori, non saltarli mai.\n- 8 x 400 m\n');
checkTrue('una FRASE che comincia col nome di una sezione non la apre',
  prosa[0].warmup === '' && /8 x 400 m/.test(prosa[0].mainPhase),
  'riscaldamento=' + JSON.stringify(prosa[0].warmup));

console.log('\n— l introduzione prima del primo giorno non diventa una scheda —');
const conIntro = parsePlanBlocks(
  'Ecco il tuo piano, calibrato sui tuoi ritmi.\n\n' +
  '### Giorno 1 — 27/08/2026: Corsa\n#### Fase Principale\n- 30 min\n');
check('un solo blocco', conIntro.length, 1);

console.log('\n— i riposi restano riconoscibili —');
const conRiposo = parsePlanBlocks('### Giorno 2 — 28/08/2026: Riposo attivo\nCamminata.\n');
check('il blocco e marcato come riposo', conRiposo[0].isRest, true);

console.log('\n— casi limite —');
check('testo vuoto', parsePlanBlocks(''), []);
check('null', parsePlanBlocks(null), []);
check('testo senza nessuna intestazione', parsePlanBlocks('solo prosa'), []);

console.log('\n— e il parser di ai-trainer usa questo, non il suo —');
checkTrue('parseAIResponse chiama parsePlanBlocks',
  /PlanDays\.parsePlanBlocks\(text\)/.test(AI));
checkTrue('lo split rigido sui tre cancelletti e sparito',
  !/text\.split\(\/\(\?=\^###/.test(AI),
  'era la riga che scartava cinque forme su sei');
checkTrue('e non c e piu un extractSection locale',
  !/function extractSection\(sectionName\)/.test(AI));

console.log('\n— e se non si capisce niente, lo dice SUBITO —');
// Prima il fallimento era muto: il piano compariva, e solo premendo
// Salva — magari minuti dopo — arrivava "Nessun allenamento da salvare".
checkTrue('avvisa quando non ha riconosciuto nessuna scheda',
  /if \(!generatedWorkouts\.length\)/.test(AI));
checkTrue('spiegando che il pulsante Salva non funzionera',
  /Il pulsante Salva non/.test(AI));
checkTrue('e senza nascondere il piano, che resta copiabile a mano',
  /elements\.aiResponse\.prepend\(avviso\)/.test(AI),
  'prepend, non innerHTML: il testo generato non va buttato');

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
