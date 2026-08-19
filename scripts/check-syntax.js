#!/usr/bin/env node
/**
 * check-syntax.js
 *
 * Verifica che ogni file JavaScript servito al browser sia interpretabile.
 *
 * PERCHÉ ESISTE
 * public/js/reports.js conteneva "const data = ..." dentro una funzione il
 * cui PARAMETRO si chiamava già data. È un SyntaxError, e un SyntaxError non
 * rompe una funzione: impedisce l'interpretazione dell'INTERO file. La pagina
 * Report era quindi completamente ferma — nessun grafico, nessun filtro,
 * nessun pulsante — dalla PR #23 fino a oggi, senza che nulla lo segnalasse.
 *
 * Nessuno dei controlli esistenti poteva accorgersene: check-migration-
 * fallbacks.js legge i file come testo, e i test in Node caricano solo i
 * moduli che gli servono. Il browser lo scrive in console, ma solo se
 * qualcuno apre quella pagina con la console aperta.
 *
 * Il controllo è volutamente grezzo: non è un linter, non giudica lo stile.
 * Chiede una sola cosa, quella che se manca rende il file inerte.
 *
 * NOTA SUI MODULI: node --check interpreta come script CommonJS, quindi un
 * eventuale file con import/export ES si segnalerebbe come errore. Oggi non
 * ce ne sono (il progetto è JavaScript classico, senza build). Se un domani
 * se ne aggiungesse uno, va elencato in ES_MODULES qui sotto.
 *
 * Uso:  node scripts/check-syntax.js
 * Esce con codice 1 al primo file non interpretabile.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// File da controllare: tutto ciò che il browser scarica ed esegue, più il
// server. Il service worker è compreso: un errore lì disattiva la cache
// offline per tutti.
const TARGETS = [
  'index.js',
  'public/sw.js',
  ...fs.readdirSync(path.join(ROOT, 'public', 'js'))
      .filter(f => f.endsWith('.js'))
      .map(f => path.join('public', 'js', f))
];

// Moduli ES, che node --check non sa interpretare come script.
const ES_MODULES = [];

let problems = 0;

for (const rel of TARGETS) {
  if (ES_MODULES.includes(rel)) continue;

  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)],
                 { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    problems++;
    const msg = String(err.stderr || '').split('\n')
      .filter(l => l.trim() && !l.startsWith('    at ') && !l.startsWith('Node.js v'))
      .slice(0, 4).join('\n      ');
    console.error(`  NON INTERPRETABILE  ${rel}\n      ${msg}`);
  }
}

if (problems === 0) {
  console.log(`  Tutti i ${TARGETS.length} file JavaScript sono interpretabili.`);
  process.exit(0);
}

console.error(`\n${problems} file non interpretabile/i.`);
console.error('Un SyntaxError disattiva il file INTERO, non la singola funzione: ' +
              'la pagina che lo carica resta senza JavaScript.');
process.exit(1);
