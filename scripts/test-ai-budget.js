#!/usr/bin/env node
/**
 * test-ai-budget.js
 *
 * Verifica la catena dei limiti di tempo dell'AI Trainer e che il modello
 * resti configurabile da variabile d'ambiente.
 *
 * PERCHÉ ESISTE
 * I due valori vivono in file diversi — il budget del server in index.js,
 * il timeout del browser in public/js/ai-trainer.js — e devono restare in
 * un ordine preciso. Se il server superasse il client, sarebbe il browser
 * ad abortire per primo: l'utente vedrebbe un errore generico mentre la
 * funzione continua a generare un piano che nessuno riceverà, e il
 * messaggio "il modello ha superato i N secondi" non comparirebbe mai
 * perché quel ramo non verrebbe raggiunto.
 *
 * Nessuno dei due file segnala il problema da solo: si vede solo
 * confrontandoli, che è esattamente ciò che fa questo controllo.
 *
 * Il caso reale che ha motivato tutto: il server era fermo a 9,5 secondi
 * per il vecchio limite di Vercel Hobby, sparito con Fluid compute. Il
 * piano mensile poteva venire troncato senza che nulla lo dicesse.
 *
 * Uso:  node scripts/test-ai-budget.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const CLIENT = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ai-trainer.js'), 'utf8');
const VERCEL = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');

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

console.log('\n— i valori si trovano ancora dove ce li aspettiamo —');

const serverMatch = SERVER.match(/const AI_BUDGET_MS\s*=\s*Number\(process\.env\.AI_BUDGET_MS\)\s*\|\|\s*(\d+)/);
checkTrue('budget del server leggibile da index.js', !!serverMatch,
  serverMatch ? serverMatch[1] + ' ms' : 'const AI_BUDGET_MS non trovata — se è stata rinominata, aggiorna questo test');
if (!serverMatch) { console.error('\n  Impossibile proseguire.'); process.exit(1); }

// Il timeout del client: AbortController + setTimeout nel modulo dell'AI.
const clientMatch = CLIENT.match(/setTimeout\(\(\)\s*=>\s*controller\.abort\(\),\s*(\d+)\)/);
checkTrue('timeout del client leggibile da ai-trainer.js', !!clientMatch,
  clientMatch ? clientMatch[1] + ' ms' : 'setTimeout(... controller.abort()) non trovato');
if (!clientMatch) { console.error('\n  Impossibile proseguire.'); process.exit(1); }

const serverMs = Number(serverMatch[1]);
const clientMs = Number(clientMatch[1]);

console.log('\n— la catena dei limiti regge —');
checkTrue('il server sta sotto il client',
  serverMs < clientMs, serverMs + ' ms < ' + clientMs + ' ms');

// Un margine troppo sottile non lascia tempo alla risposta di tornare
// indietro: fra l'abort del server e quello del client devono starci la
// serializzazione e il viaggio di rete.
checkTrue('con almeno 2 secondi di margine',
  clientMs - serverMs >= 2000, 'margine ' + (clientMs - serverMs) + ' ms');

// Il limite della piattaforma con Fluid compute è 300 s: restare
// abbondantemente sotto è una scelta, non un vincolo — una richiesta che
// occupa la funzione per minuti non aiuta nessuno.
checkTrue('e sotto il limite della piattaforma', clientMs < 300000);

// Il vecchio valore. Se qualcuno lo rimettesse "per sicurezza", il piano
// mensile tornerebbe a troncarsi.
checkTrue('il budget non è tornato ai 9,5 secondi di prima',
  serverMs > 10000, serverMs + ' ms');

console.log('\n— il modello resta configurabile —');
checkTrue('AI_MODEL letto dall ambiente',
  /process\.env\.AI_MODEL/.test(SERVER));
checkTrue('con un valore predefinito',
  /process\.env\.AI_MODEL\s*\|\|\s*'[^']+'/.test(SERVER));
checkTrue('e la richiesta usa la costante, non una stringa fissa',
  /model:\s*AI_MODEL/.test(SERVER));
checkTrue('nessun modello cablato nella chiamata',
  !/model:\s*'[^']*(gpt|llama|claude)[^']*'/i.test(SERVER));

console.log('\n— vercel.json non deve dichiarare functions —');
// "functions" e "builds" sono mutuamente esclusivi: metterli insieme non
// produce un avviso, fa FALLIRE il build. Questo file usa "builds".
const vercel = JSON.parse(VERCEL);
checkTrue('usa ancora la configurazione builds', Array.isArray(vercel.builds));
check('e non ha functions accanto', vercel.functions === undefined, true);

console.log('\n— il messaggio di timeout dice quanto ha atteso —');
checkTrue('il testo cita il budget invece di un numero fisso',
  /AI_BUDGET_MS\s*\/\s*1000/.test(SERVER));

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del budget AI superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
