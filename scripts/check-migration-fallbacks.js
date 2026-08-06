#!/usr/bin/env node
/**
 * check-migration-fallbacks.js
 *
 * Controlla che ogni scrittura o lettura che usa una colonna introdotta da
 * una migrazione abbia un percorso di ripiego, e che i ripieghi NON
 * contengano a loro volta colonne di migrazione.
 *
 * PERCHÉ ESISTE
 * Questo errore si è presentato quattro volte, sempre uguale e sempre
 * scoperto dall'utente in produzione:
 *   - profilo:    il salvataggio falliva in blocco senza migrations/002
 *   - archivio:   la pagina restava vuota senza migrations/001
 *   - dashboard:  'source' finita nella lista di RIPIEGO -> falliva anche
 *                 quella, "Errore nel caricamento degli allenamenti"
 *   - creazione:  nessun ripiego -> "Could not find the 'source' column"
 *
 * Le migrazioni si eseguono a mano nel SQL Editor, quindi c'è sempre una
 * finestra in cui il codice nuovo gira su un database vecchio. In quella
 * finestra l'app deve degradare, non rompersi.
 *
 * Uso:  node scripts/check-migration-fallbacks.js
 * Esce con codice 1 se trova problemi.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// Colonne introdotte dalle migrazioni in migrations/
//
// TENERE ALLINEATO A migrations/: una colonna che manca da questa lista è
// invisibile al controllo, che continua a passare mostrando "tutto a posto".
// È già successo con 'humidity' (005), rimasta fuori per due PR: la
// scrittura in tcx-import.js aveva il ripiego, ma per fortuna, non perché
// il controllo lo verificasse.
const MIGRATION_COLUMNS = [
  'gps_track', 'max_heart_rate',      // 001
  'resting_heart_rate',               // 002 (max_heart_rate anche su profiles)
  'temperature', 'weather',           // 003
  'source',                           // 004
  'humidity'                          // 005
];

// Indizi che nelle vicinanze esiste un ripiego.
//
// SOLO IDENTIFICATORI DI CODICE, mai frasi in italiano: la prima versione
// di questo script cercava anche "riproviamo senza" e simili, e passava
// felicemente su un file in cui il ripiego era stato rimosso ma il COMMENTO
// che lo descriveva era rimasto. Un controllo che non riesce a vedere il
// bug per cui è stato scritto è peggio di nessun controllo.
// Sono espressioni regolari perché serve distinguere l'USO di un helper
// dalla sua DEFINIZIONE: in workout-editor.js la funzione
// isMissingColumnError è dichiarata poche righe sopra la scrittura, e una
// ricerca per sottostringa la contava come se fosse un ripiego attivo —
// mancando così proprio il bug segnalato dall'utente.
const FALLBACK_HINTS = [
  /(?<!function\s)isMissingColumnError\s*\(/,   // chiamata, non dichiarazione
  /COLS_LEGACY|WORKOUT_COLS|PROFILE_COLS_LEGACY|selectWorkouts|insertDroppingMissing/,
  /delete\s+\w+\.(source|temperature|weather|gps_track|max_heart_rate)/
];

// Rimuove commenti di riga e di blocco: gli indizi vanno cercati nel
// codice eseguito, non in ciò che il codice dichiara di fare.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const WINDOW = 40; // righe entro cui cercare il ripiego

let problems = 0;

for (const file of fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'))) {
  const full  = path.join(JS_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // Interessano solo le righe che assegnano la colonna in un oggetto
    // inviato al database (es. "source: 'manual',"), non i parser locali.
    const col = MIGRATION_COLUMNS.find(c => new RegExp('^\\s*' + c + '\\s*:').test(line));
    if (!col) return;

    // È davvero una scrittura verso Supabase? Cerchiamo insert/update/upsert
    // nelle vicinanze; altrimenti è un oggetto interno (es. il risultato di
    // un parser) e non ci riguarda.
    const around = stripComments(
      lines.slice(Math.max(0, i - WINDOW), i + WINDOW).join('\n')
    );
    const isDbWrite = /\.(insert|update|upsert)\s*\(/.test(around);
    if (!isDbWrite) return;

    const hasFallback = FALLBACK_HINTS.some(re => re.test(around));
    if (!hasFallback) {
      problems++;
      console.error(`  MANCA RIPIEGO  ${file}:${i + 1}  colonna "${col}"`);
    }
  });
}

// ─── Tabelle introdotte dalle migrazioni ─────────────────────────────
//
// La 006 aggiunge una TABELLA, non delle colonne, e il controllo qui
// sopra non la vedrebbe: cerca assegnazioni "colonna:" dentro una
// scrittura, mentre qui il problema si presenta anche in LETTURA, e con
// un codice d'errore diverso (PGRST205 / 42P01 invece di PGRST204 /
// 42703). isMissingColumnError() non lo riconosce, quindi senza la
// migrazione l'assenza della tabella arriverebbe all'utente come un
// errore vero.
//
// Regola: se un file nomina una tabella di migrazione, deve anche
// chiamare isMissingTableError.
const MIGRATION_TABLES = [
  'exercise_sets'                     // 006
];

for (const file of fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'))) {
  const src = stripComments(fs.readFileSync(path.join(JS_DIR, file), 'utf8'));

  for (const table of MIGRATION_TABLES) {
    // La tabella può comparire come stringa letterale in .from('...')
    // oppure attraverso una costante (var TABLE = 'exercise_sets').
    if (!new RegExp(`['"\`]${table}['"\`]`).test(src)) continue;

    // Come per le colonne: la CHIAMATA, non la dichiarazione. Una
    // ricerca per sottostringa conterebbe la definizione dell'helper
    // come se fosse un ripiego attivo.
    const hasGuard = /(?<!function\s)isMissingTableError\s*\(/.test(src);
    if (!hasGuard) {
      problems++;
      console.error(`  MANCA RIPIEGO  ${file}  tabella "${table}" senza isMissingTableError()`);
    }
  }
}

if (problems === 0) {
  console.log('  Tutte le scritture con colonne di migrazione hanno un ripiego.');
  console.log('  Tutti gli usi delle tabelle di migrazione hanno un ripiego.');
  process.exit(0);
}

console.error(`\n${problems} scrittura/e senza ripiego.`);
console.error('Senza migrazione eseguita, quella scrittura fallisce in blocco.');
process.exit(1);
