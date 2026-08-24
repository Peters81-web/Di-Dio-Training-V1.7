#!/usr/bin/env node
/**
 * test-md-lite.js
 *
 * Verifica il renderer markdown usato nel dettaglio dell'allenamento.
 *
 * PERCHÉ ESISTE
 * Il bug segnalato dall'utente con uno screenshot: aprendo una scheda, la
 * tabella degli esercizi si vedeva come
 *
 *   | Esercizio | Serie | Ripetizioni | Recupero | |-----------|-----...
 *
 * tutta su una riga sola, con trattini e asterischi in chiaro. Il testo
 * andava dritto in innerHTML passando solo da DOMPurify, che ripulisce
 * l'HTML pericoloso ma non traduce il markdown; e in HTML gli a-capo
 * valgono come spazi, quindi la tabella collassava.
 *
 * I casi qui sotto NON sono inventati: il contenuto delle prime prove è
 * copiato parola per parola dalla scheda "25 Agosto – Palestra – Forza a
 * corpo libero", presa dal database.
 *
 * Uso:  node scripts/test-md-lite.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const MdLite = require(path.join(__dirname, '..', 'public', 'js', 'md-lite.js'));
const { render } = MdLite;

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

// ─── Il contenuto vero, dal database ────────────────────────────────
const FASE_VERA = [
  '| Esercizio | Serie | Ripetizioni | Recupero |',
  '|-----------|-------|-------------|----------|',
  '| Push‑up con palla (balance board) | 4 | 12 | 45 s |',
  '| Pull‑up con barra trazioni (maniglie) | 4 | 8 | 60 s |',
  '| Bulgarian split squat (con manubrio 10 kg) | 3 | 10 | 45 s |',
  '| Plank con sollevamento gamba | 3 | 30 s per lato | 30 s |',
  '| Deadlift con manubri 12 kg | 3 | 12 | 60 s |',
  '| Russian twist con manubrio 8 kg | 3 | 20 | 30 s |'
].join('\n');

const RISCALDAMENTO_VERO =
  '- 5 min corda a 60 Hz (saltelli sul posto)  \n' +
  '- 5 min mobilità: 10 x squat senza peso, 10 x affondi (alternati)';

console.log('\n— la fase principale che si vedeva come |-----| —');
const tab = render(FASE_VERA);
checkTrue('diventa una vera tabella', /<table class="md-table">/.test(tab));
checkTrue('con le intestazioni al posto giusto',
  /<thead><tr><th>Esercizio<\/th><th>Serie<\/th><th>Ripetizioni<\/th><th>Recupero<\/th><\/tr><\/thead>/.test(tab));
check('e tutte e sei le righe di esercizi',
  (tab.match(/<tr>/g) || []).length, 7); // 6 esercizi + intestazione
checkTrue('la riga di separazione non diventa un esercizio',
  !/-----/.test(tab), 'era la riga che finiva in pagina in chiaro');
checkTrue('nessuna pipe sopravvive nel testo', !/\|/.test(tab));
checkTrue('c è l involucro che permette lo scorrimento su telefono',
  /<div class="md-table-wrap">/.test(tab),
  'senza, quattro colonne allargano tutta la pagina');
checkTrue('un esercizio con i suoi numeri è integro',
  /<td>Deadlift con manubri 12 kg<\/td><td>3<\/td><td>12<\/td><td>60 s<\/td>/.test(tab));

console.log('\n— il riscaldamento vero —');
const risc = render(RISCALDAMENTO_VERO);
check('due voci di elenco', (risc.match(/<li>/g) || []).length, 2);
checkTrue('e nessun trattino rimasto in testa',
  !/<li>-/.test(risc));

console.log('\n— gli a-capo non spariscono più —');
// La causa vera di "tutto su una riga": in HTML l'a-capo vale come uno
// spazio, quindi un testo su tre righe usciva su una sola.
check('tre righe di seguito diventano un paragrafo con le interruzioni',
  render('prima riga\nseconda riga\nterza riga'),
  '<p>prima riga<br>seconda riga<br>terza riga</p>');
check('una riga vuota separa due paragrafi',
  render('uno\n\ndue'), '<p>uno</p>\n<p>due</p>');

console.log('\n— formattazione dentro la riga —');
check('grassetto', render('**Camminata** veloce'),
  '<p><strong>Camminata</strong> veloce</p>');
check('grassetto con underscore', render('__Forte__'), '<p><strong>Forte</strong></p>');
check('corsivo', render('*piano*'), '<p><em>piano</em></p>');
check('codice', render('usa `hr_series`'), '<p>usa <code>hr_series</code></p>');
// Il corsivo con underscore singolo NON è supportato di proposito.
check('gli underscore dentro le parole restano intatti',
  render('max_heart_rate e push_up'), '<p>max_heart_rate e push_up</p>');
check('il grassetto non viene spezzato dal corsivo',
  render('**due asterischi**'), '<p><strong>due asterischi</strong></p>');

console.log('\n— elenchi annidati, come li scrive il modello —');
const nested = render('- 5 min di lavoro core:\n  - 3 x 30 s plank\n  - 3 x 15 s side plank\n- 10 min corsa');
checkTrue('l elenco interno è dentro quello esterno',
  /<ul><li>5 min di lavoro core:<ul><li>3 x 30 s plank<\/li><li>3 x 15 s side plank<\/li><\/ul><\/li><li>10 min corsa<\/li><\/ul>/.test(nested),
  nested);
check('gli asterischi valgono come trattini',
  render('* uno\n* due'), '<ul><li>uno</li><li>due</li></ul>');

console.log('\n— sicurezza: il testo non può diventare markup —');
// Il contenuto arriva dall'AI ed è pilotabile da ciò che l'utente scrive
// nel prompt.
checkTrue('uno script nel testo viene scappato',
  render('ciao <script>alert(1)</script>').indexOf('<script>') === -1,
  render('ciao <script>alert(1)</script>'));
checkTrue('anche dentro una cella di tabella',
  render('| a |\n|---|\n| <img src=x onerror=alert(1)> |').indexOf('<img') === -1);
check('le virgolette non spezzano un attributo',
  render('dice "ciao"'), '<p>dice &quot;ciao&quot;</p>');
check('la e commerciale viene scappata una volta sola',
  render('Forza & Core'), '<p>Forza &amp; Core</p>');

console.log('\n— le schede scritte a mano non vengono toccate —');
// L'editor manuale salva innerHTML (app-core.js, getRichTextContent):
// scappandolo, l'utente vedrebbe i propri tag in chiaro. È una
// regressione al posto di una correzione, quindi per il contenuto NON
// dell'AI l'HTML passa intatto e se ne occupa DOMPurify come prima.
const { renderUnlessHtml } = MdLite;
check('un contenuto già HTML passa intatto',
  renderUnlessHtml('<p>Scritto <strong>a mano</strong></p>'),
  '<p>Scritto <strong>a mano</strong></p>');
check('anche un solo tag basta a riconoscerlo',
  renderUnlessHtml('riga uno<br>riga due'), 'riga uno<br>riga due');
// Ma un minore qualsiasi NON è un tag: quel testo resta markdown.
check('"FC < 140" non viene scambiato per HTML',
  renderUnlessHtml('FC < 140 bpm'), '<p>FC &lt; 140 bpm</p>');
check('e un riepilogo Garmin, che è testo semplice, guadagna gli a-capo',
  renderUnlessHtml('Importato da Garmin: 39 min\n383 kcal'),
  '<p>Importato da Garmin: 39 min<br>383 kcal</p>');

// LA DIFFERENZA CHE CONTA: render() non si fida mai, nemmeno di un tag.
// La prima versione aveva una sola funzione che indovinava, e un
// "<script>" dall'AI le bastava per passare intatto.
checkTrue('render() invece scappa i tag anche quando sembrano HTML',
  render('<p>ciao</p>').indexOf('&lt;p&gt;') !== -1,
  render('<p>ciao</p>'));

console.log('\n— casi limite —');
check('testo vuoto', render(''), '');
check('solo spazi', render('   \n  '), '');
check('null', render(null), '');
check('undefined', render(undefined), '');
check('una tabella senza righe di dati',
  render('| a | b |\n|---|---|').replace(/<tbody><\/tbody>/, '<tbody>OK</tbody>').includes('OK'), true);
checkTrue('una riga di tabella con meno celle non perde l esercizio',
  /<td>Corsa<\/td><td><\/td>/.test(render('| a | b |\n|---|---|\n| Corsa |')),
  'il modello sbaglia il conteggio delle celle e perdere una riga è peggio');
checkTrue('una linea di trattini da sola non diventa una tabella',
  !/<table/.test(render('testo\n-----\naltro testo')));
check('allineamento a destra',
  /text-align:right/.test(render('| a |\n|---:|\n| 1 |')), true);

console.log('\n— il collegamento con la dashboard —');
const DASH = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');
const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'html', 'dashboard.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

checkTrue('il dettaglio traduce il markdown', /MdLite\.render\s*\(/.test(DASH));
checkTrue('e lo fa PRIMA di DOMPurify, non dopo',
  /sanitize\(toHtml\(phase\.content\)\)/.test(DASH),
  'invertendoli, la ripulitura lavorerebbe sul markdown e non sull HTML');
checkTrue('md-lite.js è caricato in dashboard.html', /\/js\/md-lite\.js/.test(HTML));
checkTrue('e prima di dashboard.js',
  HTML.indexOf('/js/md-lite.js') < HTML.indexOf('/js/dashboard.js'));
checkTrue('è nel precache del service worker', /'\/js\/md-lite\.js'/.test(SW));
checkTrue('la versione della cache è stata alzata',
  Number((SW.match(/CACHE_NAME\s*=\s*'didio-v(\d+)'/) || [0, 0])[1]) >= 56);

console.log('\n' + (fail === 0
  ? `  Tutti i ${pass} controlli del markdown superati.`
  : `  ${fail} FALLITI su ${pass + fail}.`));
process.exit(fail === 0 ? 0 : 1);
