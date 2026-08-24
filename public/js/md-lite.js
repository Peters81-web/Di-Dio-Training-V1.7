/**
 * md-lite.js
 *
 * Traduce in HTML il markdown che l'AI Trainer scrive dentro le fasi di
 * un allenamento.
 *
 * IL BUG CHE CHIUDE
 * Il dettaglio della scheda prendeva il testo salvato e lo infilava in
 * innerHTML passando solo da DOMPurify, che ripulisce l'HTML pericoloso
 * ma non traduce il markdown. Risultato visto dall'utente: una tabella di
 * esercizi mostrata come
 *
 *   | Esercizio | Serie | Ripetizioni | Recupero | |-----------|------...
 *
 * tutta su una riga sola — perché in HTML gli a-capo valgono come spazi —
 * con i trattini e gli asterischi in chiaro.
 *
 * PERCHÉ NON `marked`
 * La pagina AI Trainer usa marked da CDN e lì la stessa risposta si legge
 * bene. Aggiungerlo anche alla dashboard sarebbe una riga, ma in
 * dashboard.html DOMPurify è caricato con l'hash SRI verificato, e per
 * marked non è possibile calcolarne uno in questo ambiente, che i CDN non
 * li raggiunge. Un hash inventato è peggio di nessun hash. Questo modulo
 * copre i costrutti che il modello usa DAVVERO — contati sulle schede
 * salvate: elenchi in 10 su 10, grassetto in 6, tabelle in 2, nessun
 * blocco di codice e nessun elenco numerato — e in più è verificabile dai
 * controlli in Node, cosa che con una libreria nel browser non sarebbe.
 *
 * SICUREZZA
 * Il testo arriva dall'AI ed è pilotabile da ciò che l'utente scrive nel
 * prompt, quindi si scappa PRIMA tutto il contenuto e solo dopo si
 * inseriscono i tag generati qui dentro: nessun frammento del testo
 * originale può diventare markup. A valle resta comunque DOMPurify, che
 * il chiamante applica come prima — due strati invece di uno.
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Riconosce un tag HTML vero — non un minore qualsiasi, così
   * "FC < 140" non viene scambiato per markup.
   */
  var TAG_HTML = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;

  function looksLikeHtml(s) { return TAG_HTML.test(String(s == null ? '' : s)); }

  /**
   * Formattazione dentro una riga. L'ordine conta: il codice per primo,
   * poi il grassetto a due asterischi, e solo alla fine il corsivo a uno
   * — altrimenti il corsivo spezzerebbe a metà ogni "**testo**".
   *
   * Il corsivo con l'underscore singolo NON è supportato di proposito:
   * spezzerebbe parole come "push_up" o "max_heart_rate", che in un piano
   * di allenamento sono più probabili di un corsivo.
   */
  function inline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  // ─── Tabelle ────────────────────────────────────────────────────────

  // La riga di separazione: |---|---| oppure |:---|---:|. Deve avere sia
  // una pipe sia un trattino, altrimenti una riga di soli due punti o una
  // linea decorativa "-----" verrebbe scambiata per l'intestazione di una
  // tabella che non esiste.
  function isTableSep(line) {
    var s = String(line || '');
    return s.indexOf('|') !== -1 && s.indexOf('-') !== -1 &&
           /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s);
  }

  function splitRow(line) {
    return String(line).trim()
      .replace(/^\|/, '').replace(/\|$/, '')
      .split('|')
      .map(function (c) { return c.trim(); });
  }

  function alignOf(cell) {
    var s = String(cell || '').trim();
    var left = s.charAt(0) === ':';
    var right = s.charAt(s.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  function renderTable(head, aligns, rows) {
    function cells(list, tag) {
      return list.map(function (c, i) {
        var a = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '';
        return '<' + tag + a + '>' + inline(c) + '</' + tag + '>';
      }).join('');
    }

    var body = rows.map(function (r) {
      // Una riga con meno celle dell'intestazione non va scartata: il
      // modello le sbaglia, e perdere un esercizio è peggio che mostrarne
      // uno con una casella vuota.
      var padded = r.slice();
      while (padded.length < head.length) padded.push('');
      return '<tr>' + cells(padded.slice(0, head.length), 'td') + '</tr>';
    }).join('');

    // L'involucro con lo scorrimento orizzontale non è un vezzo: una
    // tabella di quattro colonne su un telefono, senza, allarga l'intera
    // finestra e manda in scorrimento laterale tutta la pagina.
    return '<div class="md-table-wrap"><table class="md-table">' +
           '<thead><tr>' + cells(head, 'th') + '</tr></thead>' +
           '<tbody>' + body + '</tbody></table></div>';
  }

  // ─── Elenchi ────────────────────────────────────────────────────────

  var BULLET = /^(\s*)[-*•]\s+(.*)$/;
  var ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;

  function bulletOf(line) {
    var m = BULLET.exec(line) || ORDERED.exec(line);
    if (!m) return null;
    return {
      indent: m[1].replace(/\t/g, '  ').length,
      text: m[2],
      ordered: !BULLET.test(line)
    };
  }

  /**
   * Costruisce un elenco, annidando quando l'indentazione cresce.
   * Il modello lo fa davvero:
   *   - 5 min di lavoro core:
   *     - 3 x 30 s plank
   */
  function renderList(items) {
    var html = '';
    var stack = [];

    items.forEach(function (it) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        html += '</li></' + stack.pop().tag + '>';
      }
      var tag = it.ordered ? 'ol' : 'ul';
      if (!stack.length || it.indent > stack[stack.length - 1].indent) {
        html += '<' + tag + '>';
        stack.push({ indent: it.indent, tag: tag });
      } else {
        html += '</li>';
      }
      html += '<li>' + inline(it.text);
    });

    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  // ─── Il ciclo principale ────────────────────────────────────────────

  /**
   * Traduce markdown in HTML. Scappa SEMPRE il testo di partenza: quello
   * che entra qui non può diventare markup, qualunque cosa contenga.
   * È la funzione da usare per il contenuto dell'AI.
   */
  function render(text) {
    var src = String(text == null ? '' : text);
    if (!src.trim()) return '';

    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // Titolo. Si parte da h4 per non entrare in conflitto con i titoli
      // di fase del modale, che sono già h4.
      var h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        var lvl = Math.min(6, h[1].length + 3);
        out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }

      // Tabella: intestazione + riga di separazione.
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(alignOf);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(renderTable(head, aligns, rows));
        continue;
      }

      // Elenco.
      if (bulletOf(line)) {
        var items = [];
        while (i < lines.length && bulletOf(lines[i])) {
          items.push(bulletOf(lines[i]));
          i++;
        }
        out.push(renderList(items));
        continue;
      }

      // Paragrafo: righe consecutive fino a una riga vuota o all'inizio
      // di un altro blocco. Le righe interne diventano <br>, che è quello
      // che il modello intende con l'a-capo — e il motivo per cui la
      // tabella si vedeva tutta su una riga sola.
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !bulletOf(lines[i]) && !/^\s*#{1,6}\s+/.test(lines[i]) &&
             !(lines[i].indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        para.push(inline(lines[i].trim()));
        i++;
      }
      if (para.length) out.push('<p>' + para.join('<br>') + '</p>');
    }

    return out.join('\n');
  }

  /**
   * Per il contenuto che NON viene dall'AI.
   *
   * Le schede scritte a mano non contengono markdown ma HTML: l'editor
   * salva direttamente innerHTML (app-core.js, getRichTextContent).
   * Scappandolo, l'utente vedrebbe i propri <p> e <strong> in chiaro —
   * una regressione al posto di una correzione. Quindi se il testo
   * contiene già un tag si restituisce com'era e se ne occupa DOMPurify,
   * esattamente come prima di questo modulo; se è testo semplice — i
   * riepiloghi importati da Garmin, o una scheda scritta senza
   * formattazione — si applica il markdown, che almeno gli a-capo li
   * rispetta.
   *
   * PERCHÉ NON UNA SOLA FUNZIONE CHE INDOVINA
   * La prima versione faceva così, e i controlli l'hanno bocciata: un
   * "<script>" scritto dall'AI faceva scattare il riconoscimento e
   * passava intatto, appoggiandosi al solo DOMPurify invece che ai due
   * strati promessi. Peggio ancora, bastava un tag qualsiasi in una fase
   * perché quella fase perdesse del tutto la tabella. La provenienza il
   * chiamante la conosce: meglio che decida lui, invece di far tirare a
   * indovinare a un'espressione regolare.
   */
  function renderUnlessHtml(text) {
    var src = String(text == null ? '' : text);
    if (looksLikeHtml(src)) return src;
    return render(src);
  }

  global.MdLite = {
    render: render,
    renderUnlessHtml: renderUnlessHtml,
    _internals: {
      escapeHtml: escapeHtml, inline: inline, looksLikeHtml: looksLikeHtml,
      isTableSep: isTableSep, splitRow: splitRow, alignOf: alignOf
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

// Uso da Node per i controlli in scripts/.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).MdLite;
}
