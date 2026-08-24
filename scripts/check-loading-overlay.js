#!/usr/bin/env node
/**
 * check-loading-overlay.js
 *
 * Cerca le domande all'utente poste mentre lo spinner di caricamento è
 * ancora acceso.
 *
 * PERCHÉ ESISTE
 * Bug trovato dall'utente completando l'allenamento del 24 agosto: la
 * pagina restava in "Caricamento...", la finestra sotto era illeggibile e
 * non si poteva più fare nulla se non ricaricare.
 *
 * La catena era questa, in handleCompleteWorkoutSubmit:
 *
 *   showLoading();                        // spinner acceso
 *   ...salvataggio nel database...
 *   await window.showConfirm({ ... });    // <-- domanda all'utente
 *   ...
 *   finally { hideLoading(); }            // <-- non arriva mai qui
 *
 * .loading-overlay copre tutto lo schermo con un blur e intercetta i
 * clic: la domanda finiva sotto, nessuno poteva rispondere, la promessa
 * della conferma non si risolveva, e il finally che avrebbe spento lo
 * spinner non veniva mai raggiunto. Un blocco senza uscita.
 *
 * È una classe di guasto che nessun controllo di sintassi vede e che
 * nessuna prova sui dati coglie: si vede solo guardando l'ORDINE delle
 * chiamate dentro una funzione.
 *
 * REGOLA: fra showLoading() e hideLoading(), nella stessa funzione, non
 * si può aspettare una risposta dell'utente. Lo spinner dichiara "sto
 * lavorando"; se si aspetta una persona, il lavoro è finito e lo spinner
 * va tolto prima.
 *
 * Uso:  node scripts/check-loading-overlay.js
 * Esce con codice 1 se trova problemi.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');

// Cose che aspettano una risposta umana.
const ATTESE_UMANE = /\b(showConfirm|window\.confirm|window\.prompt|window\.alert)\s*\(/;

const ACCENDE = /\bshowLoading\s*\(/;
const SPEGNE  = /\bhideLoading\s*\(/;

/**
 * Inizio di funzione, per non confondere due funzioni diverse.
 *
 * Serve davvero: la prima versione di questo controllo guardava solo
 * "showLoading prima, showConfirm dopo" nello stesso FILE, e segnalava
 * planner.js — dove showLoading sta in loadActivePrograms e showConfirm
 * in confirmDeleteProgram, due funzioni distinte, ognuna a posto. Un
 * controllo che grida al lupo viene disattivato, e allora tanto vale non
 * averlo.
 */
const INIZIO_FUNZIONE = /(\bfunction\b|=>)[^\n]*\{\s*$/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

let problems = 0;

for (const file of fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'))) {
  const lines = stripComments(
    fs.readFileSync(path.join(JS_DIR, file), 'utf8')
  ).split('\n');

  lines.forEach((line, i) => {
    if (!ATTESE_UMANE.test(line)) return;

    // Si risale all'inizio della funzione che contiene questa riga, e si
    // guarda solo lì dentro.
    let start = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (INIZIO_FUNZIONE.test(lines[j])) { start = j; break; }
    }

    // Dentro la funzione: lo spinner è acceso a questo punto?
    let acceso = null;
    for (let j = start; j < i; j++) {
      if (ACCENDE.test(lines[j])) acceso = j + 1;
      if (SPEGNE.test(lines[j]))  acceso = null;
    }

    if (acceso !== null) {
      problems++;
      console.error(
        `  SPINNER APERTO  ${file}:${i + 1}  domanda all'utente con lo ` +
        `spinner ancora acceso (showLoading a riga ${acceso})`);
      console.error(
        `                  chiama hideLoading() PRIMA della domanda: ` +
        `sotto l'overlay i pulsanti non sono cliccabili e la pagina si blocca.`);
    }
  });
}

if (problems === 0) {
  console.log('  Nessuna domanda all\'utente posta con lo spinner acceso.');
  process.exit(0);
}

console.error(`\n${problems} punto/i in cui la pagina può bloccarsi.`);
process.exit(1);
