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
  function cleanTitle(raw) {
    return String(raw || '')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .replace(/^Giorno\s*\d+\s*[:.–—-]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  global.PlanDays = {
    planDayNumbers: planDayNumbers,
    planDayNumbersById: planDayNumbersById,
    cleanTitle: cleanTitle,
    _internals: { toUtcNoon: toUtcNoon, planKeyOf: planKeyOf, DAY_MS: DAY_MS, MAX_DAY: MAX_DAY }
  };
})(typeof window !== 'undefined' ? window : globalThis);

// Uso da Node per i controlli in scripts/.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).PlanDays;
}
