/**
 * plan-days.js
 *
 * Numera i giorni di un piano generato dall'AI Trainer: "Giorno 1",
 * "Giorno 2"... da mostrare sopra il titolo della scheda.
 *
 * PERCHÉ ESISTE COME MODULO A SÉ
 * Lo stesso numero serve in due posti che non si parlano: l'anteprima
 * prima del salvataggio (ai-trainer.js) e le schede in dashboard
 * (dashboard.js). Se la formula fosse scritta due volte, prima o poi le
 * due copie direbbero numeri diversi per la stessa sessione — che è
 * esattamente la confusione che questa etichetta dovrebbe togliere.
 * Stessa ragione per cui hr-model.js tiene una sola copia della formula
 * di Karvonen.
 *
 * DA DOVE VIENE IL NUMERO
 * Non è salvato da nessuna parte, e non serve una migrazione: si ricava
 * dalle date che ci sono già.
 *
 *   Giorno N = (scheduled_date − la data più antica dello stesso piano) + 1
 *
 * Funziona perché parseAIResponse in ai-trainer.js assegna una data per
 * OGNI blocco "### Giorno n" e fa avanzare il calendario di un giorno
 * anche sui giorni di riposo, che poi scarta. L'invariante è garantita
 * dal nostro parser, non dalla buona volontà del modello.
 *
 * Conseguenza voluta: i buchi restano. Un piano con riposo al quarto
 * giorno numera 1, 2, 3, 5, 6 — cioè come l'AI l'ha scritto. Numerare per
 * posizione darebbe 1, 2, 3, 4, 5 e chiamerebbe "Giorno 4" una sessione
 * che nel testo del piano è il Giorno 5.
 *
 * COME SI RICONOSCE UN PIANO
 * Dal created_at identico: le schede di un piano entrano con un solo
 * INSERT, quindi condividono il timestamp fino al microsecondo.
 *
 * LIMITE DICHIARATO: è una deduzione, non una chiave. Non esiste un
 * plan_id, e due piani salvati nello stesso identico microsecondo
 * verrebbero fusi in uno. Con un solo utente non può succedere; la
 * soluzione pulita sarebbe una colonna plan_group, che però costa una
 * migrazione e un ripiego in ogni lettura per un'etichetta.
 */
(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  // Oltre questo un numero non è più un'informazione ma un sintomo:
  // significa che due schede con lo stesso created_at hanno date lontane
  // un anno, quindi la deduzione "stesso piano" ha preso un abbaglio.
  // Meglio nessuna etichetta che "Giorno 843".
  var MAX_DAY = 366;

  /**
   * 'YYYY-MM-DD' -> millisecondi a mezzogiorno UTC.
   *
   * Mezzogiorno e UTC insieme, non per pignoleria: costruendo la data
   * nel fuso locale, una differenza fra due giorni a cavallo del
   * cambio dell'ora legale non fa 24 ore ma 23 o 25, e l'arrotondamento
   * sposta di uno tutti i giorni successivi. Con Date.UTC il fuso non
   * entra proprio nel calcolo.
   */
  function toUtcNoon(ymd) {
    if (typeof ymd !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return null;
    var t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return Number.isNaN(t) ? null : t;
  }

  // ─── La data scritta nel titolo ──────────────────────────────────────
  //
  // IL BUG CHE CHIUDE
  // L'utente ha chiesto all'AI un piano "a partire dal 24 agosto", il
  // modello ha ubbidito e ha intitolato la prima sessione "24 Agosto".
  // Il parser però scartava quella data e ripartiva dal giorno della
  // generazione, il 23: tutto il piano è finito sfasato di un giorno, e
  // il 24 la dashboard mostrava la sessione intitolata "25 Agosto".
  //
  // La data la decide l'utente, non l'orologio del server. Qui si legge
  // quella che il modello ha scritto; il conteggio progressivo resta solo
  // come ripiego, per i piani senza date.

  var MESI = {
    gennaio: 1, gen: 1,  febbraio: 2, feb: 2,  marzo: 3, mar: 3,
    aprile: 4,  apr: 4,  maggio: 5,   mag: 5,  giugno: 6, giu: 6,
    luglio: 7,  lug: 7,  agosto: 8,   ago: 8,  settembre: 9, set: 9, sett: 9,
    ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12
  };

  // I giorni della settimana, che il modello mette volentieri davanti
  // alla data.
  //
  // NIENTE \b QUI. In JavaScript senza il flag /u il confine di parola è
  // ASCII, quindi dopo la "ì" di "Lunedì" NON c'è nessun confine e la
  // ricerca fallisce: /^luned[ìi]\b/ non trova "Lunedì 24 Agosto".
  // Verificato, non dedotto. È la stessa trappola degli apostrofi
  // italiani che aveva già rotto l'estrazione delle stringhe in
  // scripts/check-migration-fallbacks.js. Il lookahead negativo fa il
  // lavoro che ci si aspetterebbe da \b.
  var GIORNI_SETTIMANA =
    /(^|\s)(luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?![a-zà-ù])[\s,]*/gi;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Costruisce 'YYYY-MM-DD' rifiutando le date che non esistono.
   * Il controllo di ritorno scarta il 31 febbraio, che altrimenti
   * Date.UTC trasformerebbe silenziosamente in marzo.
   */
  function isoDate(year, month, day) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    var d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day) return null;
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  /**
   * Quando il titolo dice "24 Agosto" senza anno, l'anno va dedotto.
   * Si sceglie quello che rende la data più vicina a oggi: un piano
   * scritto il 28 dicembre che parla del "3 gennaio" intende l'anno
   * dopo, non dieci mesi prima.
   */
  function inferYear(month, day, todayIso) {
    var today = toUtcNoon(todayIso) || Date.now();
    var year = new Date(today).getUTCFullYear();
    var best = null, bestGap = Infinity;
    [year - 1, year, year + 1].forEach(function (y) {
      var iso = isoDate(y, month, day);
      if (!iso) return;
      var gap = Math.abs(toUtcNoon(iso) - today);
      if (gap < bestGap) { bestGap = gap; best = iso; }
    });
    return best;
  }

  /**
   * Legge la data di un titolo di blocco del piano.
   *
   * Riconosce "24 Agosto", "24 ago 2026", "24/08", "24/08/2026",
   * eventualmente preceduti da "Giorno 1:" o dal nome del giorno della
   * settimana, che è come il modello scrive davvero.
   *
   * DUE REGOLE DIVERSE PER I DUE FORMATI, di proposito:
   *  - il mese scritto a parole è inequivocabile, quindi lo si cerca in
   *    tutto il titolo;
   *  - "10/12" invece potrebbe essere un numero di ripetizioni, quindi la
   *    forma numerica si cerca SOLO nella testa del titolo, cioè prima
   *    del primo trattino o due punti. In "24/08 – Push-up 10/12" prende
   *    il 24 agosto e non le ripetizioni.
   *
   * @param {string} title    il titolo del blocco, senza i cancelletti
   * @param {string} todayIso 'YYYY-MM-DD' di oggi, per dedurre l'anno
   * @returns {string|null} 'YYYY-MM-DD', oppure null se non c'è una data
   */
  function parsePlanDate(title, todayIso) {
    var s = String(title || '')
      .replace(/\*\*/g, '')
      .replace(/^\s*Giorno\s*\d+\s*/i, ' ')
      .replace(GIORNI_SETTIMANA, ' ')
      // Senza questo, la testa del titolo di "Giorno 1 — 24/08/2026:
      // Palestra" è vuota: tolto "Giorno 1" resta il trattino in prima
      // posizione, e lo split sulla punteggiatura taglia PRIMA della data.
      .replace(/^[\s:.,–—-]+/, '');

    // Mese a parole: cercabile ovunque, non si confonde con altro.
    var m = /(\d{1,2})\s*(?:°|º)?\s+([a-zà-ù]{3,10})\.?\s*(\d{4})?/i.exec(s);
    if (m) {
      var mese = MESI[m[2].toLowerCase()];
      if (mese) {
        return m[3] ? isoDate(Number(m[3]), mese, Number(m[1]))
                    : inferYear(mese, Number(m[1]), todayIso);
      }
    }

    // Forma numerica: solo nella testa del titolo.
    var head = s.split(/[–—:|]|\s-\s/)[0];
    var n = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/.exec(head);
    if (n) {
      var giorno = Number(n[1]), mm = Number(n[2]);
      if (n[3]) {
        var y = Number(n[3]);
        return isoDate(y < 100 ? 2000 + y : y, mm, giorno);
      }
      return inferYear(mm, giorno, todayIso);
    }

    return null;
  }

  /** 'YYYY-MM-DD' + n giorni, sempre in UTC. */
  function addDays(ymd, n) {
    var t = toUtcNoon(ymd);
    if (t === null) return null;
    var d = new Date(t + n * DAY_MS);
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /**
   * Assegna una data a ogni blocco del piano, nell'ordine in cui il
   * modello li ha scritti.
   *
   * Il cursore si ANCORA a ogni data trovata nel titolo e avanza da solo
   * soltanto nei blocchi che non ne hanno una. Ne seguono tre
   * comportamenti, tutti voluti:
   *   - piano tutto datato  -> segue le sue date, anche se il modello
   *                            salta un giorno o ne ripete uno;
   *   - piano senza date    -> parte da oggi e avanza di uno, cioè
   *                            esattamente come faceva prima;
   *   - piano misto         -> riparte dall'ultima data certa, non da
   *                            oggi, che è l'errore che ha causato lo
   *                            sfasamento di un giorno.
   *
   * I blocchi di riposo NON vanno filtrati prima di chiamare questa
   * funzione: occupano un giorno di calendario, e toglierli qui farebbe
   * scalare in avanti tutti quelli dopo.
   *
   * @param {string[]} titles   i titoli dei blocchi, senza cancelletti
   * @param {string} todayIso   'YYYY-MM-DD' di oggi
   * @returns {string[]} date 'YYYY-MM-DD', una per titolo
   */
  function schedulePlanDates(titles, todayIso) {
    var list = Array.isArray(titles) ? titles : [];
    var cursor = null;

    return list.map(function (title) {
      var written = parsePlanDate(title, todayIso);
      if (written) cursor = written;
      else if (cursor === null) cursor = todayIso;
      else cursor = addDays(cursor, 1) || todayIso;
      return cursor;
    });
  }

  /**
   * Chiave del piano di appartenenza. created_at quando c'è (schede già
   * salvate); una chiave unica quando manca, che è il caso
   * dell'anteprima: lì le schede non sono ancora nel database, ma sono
   * per costruzione tutte dello stesso piano.
   */
  function planKeyOf(item) {
    return item && item.created_at ? String(item.created_at) : '__nuovo__';
  }

  /**
   * Numera un elenco di allenamenti dello stesso tipo (tutti generati
   * dall'AI: filtrare i manuali e gli importati è compito del chiamante,
   * perché "Giorno 1" su una corsa importata da Garmin non vuol dire
   * niente).
   *
   * @param {Array} items  oggetti con scheduled_date e, se salvati, created_at
   * @returns {Array} numeri paralleli a items; null dove il numero non è
   *                  ricavabile o non è utile mostrarlo.
   */
  function planDayNumbers(items) {
    var list = Array.isArray(items) ? items : [];

    // Primo passaggio: per ogni piano, la data più antica e quante
    // schede contiene.
    var first = Object.create(null);
    var count = Object.create(null);

    list.forEach(function (item) {
      var t = toUtcNoon(item && item.scheduled_date);
      if (t === null) return;
      var k = planKeyOf(item);
      count[k] = (count[k] || 0) + 1;
      if (first[k] === undefined || t < first[k]) first[k] = t;
    });

    // Secondo passaggio: la differenza in giorni dalla prima.
    return list.map(function (item) {
      var t = toUtcNoon(item && item.scheduled_date);
      if (t === null) return null;

      var k = planKeyOf(item);

      // Una scheda sola non è un piano: "Giorno 1" su una sessione
      // isolata è rumore, non orientamento.
      if (count[k] < 2) return null;

      var n = Math.round((t - first[k]) / DAY_MS) + 1;
      if (n < 1 || n > MAX_DAY) return null;
      return n;
    });
  }

  /**
   * Come planDayNumbers, ma restituisce una mappa id -> numero. Comoda
   * in dashboard, dove le schede vengono costruite una alla volta e in
   * gruppi separati: il numero va calcolato sull'elenco COMPLETO, non
   * su quello filtrato, altrimenti un filtro cambierebbe i numeri.
   */
  function planDayNumbersById(items) {
    var list = Array.isArray(items) ? items : [];
    var numbers = planDayNumbers(list);
    var byId = Object.create(null);
    list.forEach(function (item, i) {
      if (item && item.id != null && numbers[i] !== null) byId[item.id] = numbers[i];
    });
    return byId;
  }

  /**
   * Ripulisce il titolo di un blocco "### ..." del piano.
   *
   * Sta qui e non in ai-trainer.js per due ragioni: è l'altra faccia
   * della stessa riga di testo ("### Giorno 1: **Corsa**"), e ai-trainer
   * gira dentro un DOMContentLoaded, quindi da lì niente è raggiungibile
   * dai controlli senza aprire un browser.
   *
   * IL BUG CHE CHIUDE: il grassetto markdown non veniva tolto e finiva
   * nel nome salvato. Nel database ci sono schede che si chiamano
   * letteralmente "**Camminata post-lavoro**", asterischi compresi,
   * perché il modello a volte scrive "### **Titolo**".
   *
   * Il numero del giorno viene tolto dal titolo ma NON perso: si ricava
   * dalle date con planDayNumbers e si mostra come etichetta separata
   * sopra il titolo. Il separatore può essere due punti o un trattino,
   * perché il modello usa entrambi.
   */
  // Prefissi da togliere dalla testa del titolo, applicati a giro finché
  // il titolo non cambia più: il modello li combina in ogni ordine
  // ("Giorno 1: Lunedì 24 Agosto – Corsa", "24/08 — Giorno 1: Corsa").
  var PREFISSI = [
    /^\s*Giorno\s*\d+\s*/i,
    // Stesso motivo di GIORNI_SETTIMANA: niente \b dopo una lettera
    // accentata.
    /^\s*(luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?![a-zà-ù])[\s,]*/i,
    // Data a parole: il mese deve essere un mese vero, altrimenti
    // "10 ripetute" perderebbe il numero.
    new RegExp('^\\s*\\d{1,2}\\s*(?:°|º)?\\s+(' +
               Object.keys(MESI).join('|') + ')\\.?\\s*(\\d{4})?\\s*', 'i'),
    /^\s*\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\s*/,
    /^\s*[:.,–—-]\s*/
  ];

  function cleanTitle(raw) {
    var s = String(raw || '').replace(/\*\*/g, '').replace(/__/g, '');

    for (var giro = 0; giro < 8; giro++) {
      var prima = s;
      PREFISSI.forEach(function (re) { s = s.replace(re, ' '); });
      if (s === prima) break;
    }

    s = s.replace(/\s+/g, ' ').trim();

    // Se togliendo i prefissi non resta niente, il titolo ERA solo una
    // data: meglio restituire vuoto e lasciare che il chiamante ricada
    // sul titolo originale, che almeno dice qualcosa.
    return s;
  }

  global.PlanDays = {
    planDayNumbers: planDayNumbers,
    planDayNumbersById: planDayNumbersById,
    cleanTitle: cleanTitle,
    parsePlanDate: parsePlanDate,
    schedulePlanDates: schedulePlanDates,
    addDays: addDays,
    _internals: {
      toUtcNoon: toUtcNoon, planKeyOf: planKeyOf, isoDate: isoDate,
      inferYear: inferYear, DAY_MS: DAY_MS, MAX_DAY: MAX_DAY, MESI: MESI
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

// Uso da Node per i controlli in scripts/.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).PlanDays;
}
