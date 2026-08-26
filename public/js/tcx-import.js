/**
 * tcx-import.js
 * Import di un'attività da file TCX (esportato da Garmin Connect).
 *
 * Flusso: l'utente sceglie un .tcx → parse → anteprima → conferma →
 * crea una scheda workout_plans (completata) + un record
 * completed_workouts. L'attività compare poi in Statistiche, Archivio
 * e calendario come un normale allenamento completato.
 *
 * Self-contained: inietta il proprio modal + CSS. Nessuna dipendenza
 * dai fogli di stile della pagina. Esposto come window.openTcxImport(onDone).
 */
(function () {
  'use strict';

  // Riconosce l'errore "colonna inesistente" di PostgREST, per distinguerlo
  // da errori veri (rete, permessi, vincoli) che NON vanno mascherati.
  function isMissingColumnError(err) {
    if (!err) return false;
    if (err.code === 'PGRST204' || err.code === '42703') return true;
    const m = String(err.message || '').toLowerCase();
    return m.includes('could not find') && m.includes('column');
  }


  /**
   * INSERT che rimuove UNA ALLA VOLTA solo le colonne che il database
   * dichiara di non conoscere.
   *
   * Prima il ripiego era tutto-o-niente: se mancava una sola colonna (per
   * esempio 'source' della migrazione 004) si reinseriva il solo basePlan,
   * buttando via ANCHE gps_track e temperature, che esistevano. Risultato:
   * la traccia non veniva mai salvata e la mappa non compariva, nemmeno
   * cancellando e reimportando l'attività.
   */
  async function insertDroppingMissing(sc, base, optional) {
    let extra = Object.assign({}, optional);
    const dropped = [];

    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await sc.from('workout_plans')
        .insert(Object.assign({}, base, extra))
        .select('id').single();

      if (!res.error) return { res: res, dropped: dropped };
      if (!isMissingColumnError(res.error)) return { res: res, dropped: dropped };

      const bad = missingColumnName(res.error);
      // Nome non estraibile: meglio restituire l'errore vero che togliere
      // colonne alla cieca.
      if (!bad || !(bad in extra)) return { res: res, dropped: dropped };

      delete extra[bad];
      dropped.push(bad);
      console.warn('Import: colonna "' + bad + '" non presente nel database, ' +
                   'eseguire le migrazioni in migrations/. Importo senza.');
    }
    return { res: { error: new Error('Troppi tentativi di ripiego') }, dropped: dropped };
  }

  function missingColumnName(err) {
    const msg = String((err && err.message) || '');
    let m = msg.match(/could not find the '([^']+)' column/i);
    if (m) return m[1];
    m = msg.match(/column\s+(?:[\w.]*\.)?"?([\w]+)"?\s+does not exist/i);
    return m ? m[1] : null;
  }

  // ── Parsing TCX ───────────────────────────────────────────────
  function getText(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  }

  function mapSport(sport) {
    const s = (sport || '').toLowerCase();
    if (s.indexOf('run') >= 0)  return { type: 'running',  label: 'Corsa' };
    if (s.indexOf('bik') >= 0 || s.indexOf('cycl') >= 0) return { type: 'cycling', label: 'Ciclismo' };
    if (s.indexOf('walk') >= 0 || s.indexOf('hik') >= 0) return { type: 'walking', label: 'Camminata' };
    if (s.indexOf('swim') >= 0) return { type: 'nuoto', label: 'Nuoto' };
    return { type: 'gym', label: 'Altro' };
  }

  // Momento della giornata dall'ora locale (utile per chi si allena 2x/giorno)
  function periodOfDay(hour) {
    if (hour < 6)  return 'notte';
    if (hour < 12) return 'mattina';
    if (hour < 18) return 'pomeriggio';
    return 'sera';
  }

  // ── Traccia GPS ───────────────────────────────────────────────
  // Un'ora di registrazione a 1 punto/secondo fa 3600 coppie: ~70 KB per
  // riga, sprecati perché su una mappa larga qualche centinaio di pixel
  // quei punti finiscono comunque sovrapposti. Sottocampioniamo a 500
  // punti tenendo sempre il primo e l'ultimo (partenza e arrivo devono
  // restare esatti) e arrotondiamo a 5 decimali, cioè circa un metro.
  var MAX_TRACK_POINTS = 500;

  function buildTrack(coords) {
    if (!coords || coords.length === 0) return null;
    var round = function (v) { return Math.round(v * 1e5) / 1e5; };

    if (coords.length <= MAX_TRACK_POINTS) {
      return coords.map(function (c) { return [round(c[0]), round(c[1])]; });
    }

    var step = (coords.length - 1) / (MAX_TRACK_POINTS - 1);
    var out  = [];
    for (var i = 0; i < MAX_TRACK_POINTS; i++) {
      var c = coords[Math.round(i * step)];
      out.push([round(c[0]), round(c[1])]);
    }
    // l'ultimo campionato può non essere l'ultimo reale: forziamolo
    var last = coords[coords.length - 1];
    out[out.length - 1] = [round(last[0]), round(last[1])];
    return out;
  }

  /**
   * Costruisce il tracciato cardiaco da campioni { t: Date, hr: number }.
   *
   * Formato: array di coppie [secondiDallInizio, bpm], sottocampionato a
   * MAX_TRACK_POINTS come la traccia GPS. Verificato sul file reale di
   * una corsa da 52 minuti: da 3153 punti a 500 l'errore sulla
   * distribuzione nelle zone è 0,45 punti percentuali e il TRIMP passa
   * da 87,8 a 87,3, con il peso che scende da ~90 KB a ~5 KB.
   *
   * Si salva la SERIE e non i totali già calcolati perché tempo in zona
   * e TRIMP dipendono da FC massima e a riposo: quelle stanno nel
   * profilo e possono cambiare, e i totali resterebbero congelati sui
   * valori vecchi senza che nulla lo segnali.
   */
  function buildHrSeries(samples) {
    if (!samples || samples.length < 2) return null;

    var base = samples[0].t;
    var pts  = samples.map(function (s) {
      return [Math.max(0, Math.round((s.t - base) / 1000)), Math.round(s.hr)];
    });

    if (pts.length <= MAX_TRACK_POINTS) return pts;

    var step = (pts.length - 1) / (MAX_TRACK_POINTS - 1);
    var out  = [];
    for (var i = 0; i < MAX_TRACK_POINTS; i++) out.push(pts[Math.round(i * step)]);
    // L'ultimo campionato può non essere l'ultimo reale, e sull'ultimo
    // punto si chiude il conto della durata: forziamolo.
    out[out.length - 1] = pts[pts.length - 1];
    return out;
  }

  // ── Fusione di più registrazioni in una sessione sola ──────────
  //
  // PERCHÉ ESISTE
  // Una scheda può corrispondere a più registrazioni separate: l'utente
  // suddivide il lavoro e l'orologio salva tre attività distinte —
  // corsa, pesi, camminata — per una sola sessione pianificata. Caricando
  // un file per volta si perderebbero gli altri due.
  //
  // LE PAUSE NON FALSANO I NUMERI, ed è la cosa che andava verificata
  // prima di scrivere questa funzione: hr-model.js, sia in timeInZones
  // sia in trimp, tratta un intervallo fra due campioni con
  //     if (!(d > 0) || d > 60) d = 1;
  // quindi i venti minuti fra la corsa e i pesi contano 1 secondo, non
  // venti minuti. Senza quel limite, unire le serie avrebbe gonfiato il
  // tempo in zona e il carico senza che nulla lo segnalasse.

  /** Somma ignorando i valori assenti; null se non ce n'è nessuno. */
  function sumOrNull(list, key) {
    var tot = null;
    list.forEach(function (a) {
      var v = a[key];
      if (typeof v === 'number' && !isNaN(v)) tot = (tot === null ? 0 : tot) + v;
    });
    return tot;
  }

  /** Ritmo "m:ss" al chilometro, o null se non calcolabile. */
  function paceOf(durationMin, distanceKm) {
    if (!(distanceKm > 0) || !(durationMin > 0)) return null;
    var sec = Math.round((durationMin * 60) / distanceKm);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** Sottocampiona coppie [secondi, bpm] già costruite, a max punti. */
  function downsamplePairs(pts, max) {
    var lim = max || MAX_TRACK_POINTS;
    if (!Array.isArray(pts) || pts.length <= lim) return pts || [];
    var step = (pts.length - 1) / (lim - 1);
    var out = [];
    for (var i = 0; i < lim; i++) out.push(pts[Math.round(i * step)]);
    // L'ultimo campionato può non essere l'ultimo reale, e su quello si
    // chiude il conto della durata del blocco: forziamolo.
    out[out.length - 1] = pts[pts.length - 1];
    return out;
  }

  /**
   * Unisce più attività parsate in una sola.
   *
   * Con un solo elemento restituisce quello, senza toccarlo: la strada a
   * file singolo resta identica a prima.
   *
   * LA MAPPA TIENE UNA SOLA TRACCIA, quella del blocco più lungo.
   * Attaccandole di seguito, route-map.js — che disegna UNA polilinea —
   * traccerebbe una riga dritta dalla fine della corsa all'inizio della
   * camminata: un tratto mai percorso e indistinguibile dagli altri.
   * Meglio un percorso vero e incompleto che uno completo e falso.
   */
  function mergeActivities(list) {
    var acts = (list || []).filter(Boolean);
    if (acts.length === 0) return null;
    if (acts.length === 1) return acts[0];

    // In ordine cronologico: l'offset del tracciato cardiaco si calcola
    // dal primo, e il riepilogo va letto nell'ordine in cui è successo.
    var ord = acts.slice().sort(function (a, b) {
      return new Date(a.startIso) - new Date(b.startIso);
    });

    var t0 = new Date(ord[0].startIso).getTime();

    // FC media pesata sulla DURATA dei blocchi, non media delle medie:
    // venti minuti a 150 e cinque a 110 non fanno 130.
    var hrNum = 0, hrDen = 0;
    ord.forEach(function (a) {
      if (typeof a.avgHr === 'number' && a.durationMin > 0) {
        hrNum += a.avgHr * a.durationMin;
        hrDen += a.durationMin;
      }
    });

    // Il blocco con la traccia più lunga in distanza. A parità (o senza
    // distanza) vince quello con più punti registrati.
    var conTraccia = ord.filter(function (a) {
      return Array.isArray(a.track) && a.track.length > 1;
    });
    var principale = null;
    conTraccia.forEach(function (a) {
      if (!principale) { principale = a; return; }
      var da = a.distanceKm || 0, dp = principale.distanceKm || 0;
      if (da > dp || (da === dp && a.track.length > principale.track.length)) principale = a;
    });

    // Tracciato cardiaco: ogni serie riportata all'origine comune.
    //
    // IL SOTTOCAMPIONAMENTO È PER BLOCCO, non sulla serie unita.
    //
    // NON perché l'altra strada sbagli: l'ho misurata, e su corsa la
    // mattina più palestra la sera (12 ore di distanza) dà 4495 secondi
    // di tempo in zona contro i 4501 di questa, sui 4500 attesi. Sei
    // secondi di differenza. Il motivo per cui regge è che il
    // sottocampionamento sceglie per INDICE, e gli indici sono fitti
    // dentro i blocchi: il passo interno resta di 12 secondi anche
    // spalmando 500 punti su 12 ore.
    //
    // Si fa per blocco perché quella proprietà è una coincidenza su cui
    // non conviene poggiare. Per blocco il passo interno dipende solo
    // dalla durata del blocco, e la pausa resta un salto isolato — che è
    // ciò che hr-model si aspetta di trovare e sa già trattare.
    var conSerie = ord.filter(function (a) { return Array.isArray(a.hrSeries); });
    var quota = conSerie.length
      ? Math.max(2, Math.floor(MAX_TRACK_POINTS / conSerie.length))
      : 0;

    var serie = [];
    conSerie.forEach(function (a) {
      var off = Math.round((new Date(a.startIso).getTime() - t0) / 1000);
      downsamplePairs(a.hrSeries, quota).forEach(function (p) {
        serie.push([Math.max(0, off + Number(p[0])), Number(p[1])]);
      });
    });
    serie.sort(function (a, b) { return a[0] - b[0]; });

    var maxHr = null;
    ord.forEach(function (a) {
      if (typeof a.maxHr === 'number' && (maxHr === null || a.maxHr > maxHr)) maxHr = a.maxHr;
    });

    // Meteo e temperatura dal blocco che porta la traccia: è quello di
    // cui conosciamo il luogo. Altrimenti dal primo che ne ha.
    var meteoDa = principale || ord.find(function (a) {
      return a.temperature !== null && a.temperature !== undefined;
    }) || ord[0];

    return {
      activityType:  (principale || ord[0]).activityType,
      activityLabel: ord.map(function (a) { return a.activityLabel; })
                        .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
                        .join(' + '),
      startIso:    ord[0].startIso,
      durationMin: sumOrNull(ord, 'durationMin') || 1,
      distanceKm:  sumOrNull(ord, 'distanceKm'),
      calories:    sumOrNull(ord, 'calories'),
      avgHr:       hrDen ? Math.round(hrNum / hrDen) : null,
      maxHr:       maxHr,
      temperature: meteoDa.temperature,
      weather:     meteoDa.weather,
      weatherLabel: meteoDa.weatherLabel,
      humidity:    meteoDa.humidity,
      track:       principale ? principale.track : null,
      hrSeries:    serie.length > 1 ? serie : null,
      // I singoli blocchi restano disponibili per il riepilogo: unendo
      // attività diverse il ritmo medio non descrive nessuna delle due,
      // e il dettaglio non deve andare perso.
      parts: ord
    };
  }

  /**
   * Riepilogo testuale dei blocchi, una riga per registrazione.
   *
   * Va a finire nel campo note del completamento, che da poco arriva
   * anche al prompt dell'AI: è lì che il dettaglio per blocco resta
   * leggibile, mentre i totali della sessione lo appiattiscono.
   */
  function partsSummary(data) {
    var parts = data && data.parts;
    if (!Array.isArray(parts) || parts.length < 2) return '';

    return parts.map(function (a) {
      var bits = [a.activityLabel, a.durationMin + "'"];
      if (a.distanceKm) bits.push(a.distanceKm + ' km');
      var p = paceOf(a.durationMin, a.distanceKm);
      if (p) bits.push(p + '/km');
      if (a.avgHr) bits.push('FC ' + a.avgHr);
      return bits.join(' · ');
    }).join('\n');
  }

  function parseTcx(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Il file non è un TCX valido.');
    }
    const activities = doc.getElementsByTagName('Activity');
    if (!activities.length) throw new Error('Nessuna attività trovata nel file TCX.');

    const activity = activities[0];
    const sport = activity.getAttribute('Sport') || 'Other';
    const idEl = activity.getElementsByTagName('Id')[0];
    const startIso = idEl ? idEl.textContent.trim() : null;
    if (!startIso) throw new Error('Data di inizio non trovata nel file.');

    const laps = activity.getElementsByTagName('Lap');
    let totalSec = 0, totalMeters = 0, totalCal = 0, hrWeighted = 0, hrTime = 0, maxHr = 0;

    for (let i = 0; i < laps.length; i++) {
      const lap = laps[i];
      const t = parseFloat(getText(lap, 'TotalTimeSeconds')) || 0;
      const d = parseFloat(getText(lap, 'DistanceMeters')) || 0;
      const c = parseFloat(getText(lap, 'Calories')) || 0;
      totalSec += t; totalMeters += d; totalCal += c;

      const avgEl = lap.getElementsByTagName('AverageHeartRateBpm')[0];
      if (avgEl) {
        const v = parseFloat(getText(avgEl, 'Value')) || 0;
        if (v > 0) { const w = t || 1; hrWeighted += v * w; hrTime += w; }
      }
      const maxEl = lap.getElementsByTagName('MaximumHeartRateBpm')[0];
      if (maxEl) { const mv = parseFloat(getText(maxEl, 'Value')) || 0; if (mv > maxHr) maxHr = mv; }
    }

    // Trackpoint: coordinate e frequenza cardiaca, letti nello stesso
    // passaggio.
    //
    // Prima si iterava solo <Position>, e la frequenza si prendeva dalle
    // medie di lap: su questo file 16 medie invece di 3153 campioni. La
    // media di lap dice "140 bpm, zona 2"; il tracciato dice 45% in zona
    // 3. Non era un dettaglio di precisione, era la zona sbagliata.
    //
    // Si iterano i Trackpoint e non più le Position perché servono
    // insieme: un punto può avere la frequenza senza avere il GPS (corsa
    // sul tapis roulant) o viceversa.
    const tps    = activity.getElementsByTagName('Trackpoint');
    const coords = [];
    const hrSamples = [];

    for (let i = 0; i < tps.length; i++) {
      const tp = tps[i];

      const pos = tp.getElementsByTagName('Position')[0];
      if (pos) {
        const la = parseFloat(getText(pos, 'LatitudeDegrees'));
        const lo = parseFloat(getText(pos, 'LongitudeDegrees'));
        if (!isNaN(la) && !isNaN(lo)) coords.push([la, lo]);
      }

      // <HeartRateBpm><Value>142</Value></HeartRateBpm>. Da non
      // confondere con <AverageHeartRateBpm> e <MaximumHeartRateBpm>,
      // che stanno sul lap e hanno nomi diversi.
      const hrEl = tp.getElementsByTagName('HeartRateBpm')[0];
      const tEl  = tp.getElementsByTagName('Time')[0];
      if (hrEl && tEl) {
        const hv = parseFloat(getText(hrEl, 'Value'));
        const tv = new Date(tEl.textContent.trim());
        if (hv > 0 && !isNaN(tv.getTime())) hrSamples.push({ t: tv.getTime(), hr: hv });
      }
    }

    // Temperatura: il TCX non ha un campo standard (a differenza del GPX,
    // dove Garmin usa <gpxtpx:atemp>). Alcuni dispositivi la scrivono
    // comunque in un'estensione: la cerchiamo per nome, e se non c'è
    // resta null — si può sempre inserire a mano.
    let tSum = 0, tCount = 0;
    ['atemp', 'Temperature', 'temp'].forEach(function (tag) {
      const els = activity.getElementsByTagNameNS('*', tag);
      for (let i = 0; i < els.length; i++) {
        const v = parseFloat(els[i].textContent);
        if (!isNaN(v) && v > -60 && v < 60) { tSum += v; tCount++; }
      }
    });

    const m = mapSport(sport);
    return {
      activityType: m.type,
      activityLabel: m.label,
      startIso: startIso,
      durationMin: Math.max(1, Math.round(totalSec / 60)),
      distanceKm: totalMeters ? Math.round(totalMeters / 100) / 10 : null, // 1 decimale
      calories: totalCal ? Math.round(totalCal) : null,
      // Con il tracciato disponibile media e massimo si ricavano da
      // quello, che è più fedele delle medie di lap: il lap le calcola
      // sul proprio intervallo, e la media pesata dei lap non coincide
      // con la media dei campioni quando gli intervalli sono irregolari.
      // Senza tracciato si ripiega sui lap, come si è sempre fatto.
      avgHr: hrSamples.length
        ? Math.round(hrSamples.reduce(function (s, x) { return s + x.hr; }, 0) / hrSamples.length)
        : (hrTime ? Math.round(hrWeighted / hrTime) : null),
      maxHr: hrSamples.length
        ? Math.round(hrSamples.reduce(function (m, x) { return x.hr > m ? x.hr : m; }, 0))
        : (maxHr || null),
      temperature: tCount ? Math.round((tSum / tCount) * 10) / 10 : null,
      track: buildTrack(coords),
      hrSeries: buildHrSeries(hrSamples)
    };
  }

  // ── Parsing GPX ───────────────────────────────────────────────
  // GPX non ha calorie né un campo distanza: la distanza si calcola
  // dai punti GPS (Haversine), la durata dai timestamp, la FC dalle
  // estensioni gpxtpx:hr.
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = function (x) { return x * Math.PI / 180; };
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a)); // metri
  }

  function parseGpx(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Il file non è un GPX valido.');
    }
    const pts = doc.getElementsByTagNameNS('*', 'trkpt');
    if (!pts.length) throw new Error('Nessun punto traccia trovato nel GPX.');

    let sport = 'Other';
    const typeEl = doc.getElementsByTagNameNS('*', 'type')[0];
    if (typeEl && typeEl.textContent) sport = typeEl.textContent.trim();

    let dist = 0, hrSum = 0, hrCount = 0, tempSum = 0, tempCount = 0;
    let firstTime = null, lastTime = null, prevLat = null, prevLon = null;
    const coords = []; // le stesse coordinate usate per la distanza, ora conservate
    const hrSamples = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const lat = parseFloat(p.getAttribute('lat'));
      const lon = parseFloat(p.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        if (prevLat !== null) dist += haversine(prevLat, prevLon, lat, lon);
        prevLat = lat; prevLon = lon;
        coords.push([lat, lon]);
      }
      const tEl = p.getElementsByTagNameNS('*', 'time')[0];
      let ptTime = null;
      if (tEl) {
        const tt = new Date(tEl.textContent.trim());
        if (!isNaN(tt.getTime())) { ptTime = tt; if (!firstTime) firstTime = tt; lastTime = tt; }
      }
      const hrEl = p.getElementsByTagNameNS('*', 'hr')[0];
      if (hrEl) {
        const hv = parseFloat(hrEl.textContent) || 0;
        if (hv > 0) {
          hrSum += hv; hrCount++;
          // Il valore veniva letto e poi buttato nella media: qui si
          // conserva, così il GPX dà il tempo reale in zona come il TCX.
          if (ptTime) hrSamples.push({ t: ptTime.getTime(), hr: hv });
        }
      }

      // Temperatura: Garmin la scrive come <gpxtpx:atemp> dentro
      // TrackPointExtension, accanto a <gpxtpx:hr>. Stessa lettura
      // indipendente dal namespace usata sopra per la frequenza cardiaca.
      const tempEl = p.getElementsByTagNameNS('*', 'atemp')[0];
      if (tempEl) {
        const tv = parseFloat(tempEl.textContent);
        // 0 è una temperatura legittima: si filtra solo su NaN e valori assurdi
        if (!isNaN(tv) && tv > -60 && tv < 60) { tempSum += tv; tempCount++; }
      }
    }

    const durationMin = (firstTime && lastTime)
      ? Math.max(1, Math.round((lastTime.getTime() - firstTime.getTime()) / 60000))
      : 1;
    const m = mapSport(sport);
    return {
      activityType: m.type,
      activityLabel: m.label,
      startIso: firstTime ? firstTime.toISOString() : new Date().toISOString(),
      durationMin: durationMin,
      distanceKm: dist ? Math.round(dist / 100) / 10 : null,
      calories: null, // il GPX non contiene calorie
      avgHr: hrCount ? Math.round(hrSum / hrCount) : null,
      // Il GPX non ha un massimo dichiarato: con i campioni si ricava,
      // senza resta null come prima.
      maxHr: hrSamples.length
        ? Math.round(hrSamples.reduce(function (m, x) { return x.hr > m ? x.hr : m; }, 0))
        : null,
      temperature: tempCount ? Math.round((tempSum / tempCount) * 10) / 10 : null,
      track: buildTrack(coords),
      hrSeries: buildHrSeries(hrSamples)
    };
  }

  // Rileva il formato dal contenuto e usa il parser giusto
  function parseActivity(text) {
    return /<gpx[\s>]/i.test(text) ? parseGpx(text) : parseTcx(text);
  }

  // ── Stima calorie ─────────────────────────────────────────────
  // Il TCX porta le calorie calcolate dall'orologio; il GPX non ha alcun
  // campo calorie, quindi per quei file l'unica strada è stimarle.
  //
  // Con la frequenza cardiaca usiamo la formula di Keytel (2005), che
  // lega il dispendio proprio alla FC ed è la piu attendibile fra quelle
  // applicabili a questi dati. Senza FC ripieghiamo sui MET, che tengono
  // conto solo del tipo di attività e della durata.
  //
  // Restano stime: vengono marcate come tali nel riepilogo.
  var MET = {
    running: 9.8, cycling: 7.5, nuoto: 7.0, walking: 3.5,
    gym: 5.0, yoga: 2.5, mobility: 2.5
  };

  function estimateCalories(data, profile) {
    var weight = profile && profile.weight  > 0 ? profile.weight : null;
    var age    = profile && profile.age     > 0 ? profile.age    : null;
    var min    = data.durationMin || 0;
    if (!weight || min <= 0) return null;

    var kcalMin;
    if (data.avgHr > 0 && age) {
      var female = String(profile.gender || '').toLowerCase().indexOf('femmin') === 0;
      kcalMin = female
        ? (-20.4022 + 0.4472 * data.avgHr - 0.1263 * weight + 0.0740 * age) / 4.184
        : (-55.0969 + 0.6309 * data.avgHr + 0.1988 * weight + 0.2017 * age) / 4.184;
    } else {
      var met = MET[data.activityType] || 5.0;
      kcalMin = met * 3.5 * weight / 200;
    }

    if (!(kcalMin > 0)) return null;
    return Math.round(kcalMin * min);
  }

  // Dati del profilo necessari alla stima. Se qualcosa manca torniamo
  // null: la stima viene semplicemente saltata, l'import prosegue.
  async function loadProfileForCalories(userId, sc) {
    try {
      var res = await Promise.all([
        sc.from('profiles').select('birthdate, gender').eq('id', userId).single(),
        sc.from('body_measurements').select('weight').eq('user_id', userId)
          .not('weight', 'is', null).order('date', { ascending: false }).limit(1)
      ]);
      var p = res[0].error ? {} : (res[0].data || {});
      var w = res[1].error ? null : ((res[1].data || [])[0] || {}).weight;

      var age = null;
      if (p.birthdate) {
        var bd = new Date(String(p.birthdate).slice(0, 10));
        if (!isNaN(bd.getTime())) {
          var t = new Date();
          age = t.getFullYear() - bd.getFullYear();
          var m = t.getMonth() - bd.getMonth();
          if (m < 0 || (m === 0 && t.getDate() < bd.getDate())) age--;
        }
      }
      return { weight: w, age: age, gender: p.gender };
    } catch (e) {
      return null;
    }
  }

  // ── Salvataggio su Supabase ───────────────────────────────────
  async function saveImport(data, userId, sc) {
    const d = new Date(data.startIso);
    const dateLabel = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeLabel = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    // Nome con orario + momento giornata: distingue 2 allenamenti nello stesso giorno
    const name = data.activityLabel + ' — ' + dateLabel + ' · ' + timeLabel + ' (' + periodOfDay(d.getHours()) + ')';
    // Calorie: se il file non le contiene (sempre, nel caso del GPX) le
    // stimiamo dal profilo. Vengono etichettate come stimate, per non
    // farle passare per un dato misurato.
    let caloriesEstimated = false;
    if (!data.calories) {
      const profile = await loadProfileForCalories(userId, sc);
      const est = estimateCalories(data, profile);
      if (est) { data.calories = est; caloriesEstimated = true; }
    }

    const summaryParts = [];
    if (data.distanceKm) summaryParts.push(data.distanceKm + ' km');
    summaryParts.push(data.durationMin + ' min');
    if (data.calories) summaryParts.push(data.calories + ' kcal' + (caloriesEstimated ? ' (stimate)' : ''));
    if (data.avgHr) summaryParts.push('FC ' + data.avgHr + ' bpm');
    if (data.temperature !== null && data.temperature !== undefined) {
      summaryParts.push(data.temperature + ' °C');
    }
    if (data.weatherLabel) summaryParts.push(data.weatherLabel);
    if (data.humidity !== null && data.humidity !== undefined) {
      summaryParts.push('umidità ' + data.humidity + '%');
    }
    const summary = 'Importato da Garmin: ' + summaryParts.join(' · ');
    const dateOnly = data.startIso.slice(0, 10);

    // 1) crea scheda completata
    const basePlan = {
      user_id: userId,
      name: name,
      objective: 'Attività importata da Garmin',
      main_phase: summary,
      activity_type: data.activityType,
      total_duration: data.durationMin,
      difficulty: 'intermedio',
      completed: true,
      completed_at: data.startIso,
      scheduled_date: dateOnly,
      average_heart_rate: data.avgHr
    };

    // max_heart_rate e gps_track vengono dalla migrazione 001, temperature
    // dalla 003. Se una delle due non è stata eseguita l'INSERT fallirebbe
    // in blocco, quindi al primo errore riproviamo senza: meglio importare
    // l'attività senza questi extra che non importarla affatto.
    // Colonne opzionali, ciascuna da una migrazione diversa.
    const optional = {
      max_heart_rate: data.maxHr,      // 001
      gps_track:      data.track,      // 001
      temperature:    data.temperature,// 003
      weather:        data.weather || null, // 003, dal servizio meteo
      humidity:       data.humidity,        // 005, dal servizio meteo
      source:         'garmin',        // 004
      hr_series:      data.hrSeries    // 008, tracciato cardiaco
    };

    const ins = await insertDroppingMissing(sc, basePlan, optional);
    const planRes = ins.res;

    if (planRes.error) throw planRes.error;

    // Se la traccia c'era ma non è stata salvata, l'utente deve saperlo:
    // altrimenti cerca la mappa, non la trova e non ha modo di capire perché.
    if (data.track && ins.dropped.includes('gps_track') && window.showToast) {
      window.showToast('Attività importata, ma la traccia GPS non è stata salvata: ' +
                       'manca una colonna nel database (vedi migrations/).', 'warning', 7000);
    }

    // 2) crea record completamento
    const compRes = await sc.from('completed_workouts').insert({
      user_id: userId,
      workout_id: planRes.data.id,
      completed_at: data.startIso,
      actual_duration: data.durationMin,
      calories_burned: data.calories,
      distance: data.distanceKm,
      heart_rate_avg: data.avgHr
    });

    if (compRes.error) {
      // rollback best-effort della scheda creata
      await sc.from('workout_plans').delete().eq('id', planRes.data.id);
      throw compRes.error;
    }
  }

  /**
   * Come insertDroppingMissing, ma per un UPDATE.
   *
   * Serve al completamento di una scheda già esistente: tocca gps_track e
   * max_heart_rate (001), temperature e weather (003), humidity (005),
   * hr_series (008). Senza ripiego, una sola migrazione non eseguita farebbe
   * fallire l'INTERO aggiornamento e l'allenamento non risulterebbe svolto —
   * il file letto correttamente e il risultato perso.
   */
  async function updateDroppingMissing(sc, planId, userId, base, optional) {
    let extra = Object.assign({}, optional);
    const dropped = [];

    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await sc.from('workout_plans')
        .update(Object.assign({}, base, extra))
        .eq('id', planId)
        .eq('user_id', userId);

      if (!res.error) return { res: res, dropped: dropped };
      if (!isMissingColumnError(res.error)) return { res: res, dropped: dropped };

      const bad = missingColumnName(res.error);
      if (!bad || !(bad in extra)) return { res: res, dropped: dropped };

      delete extra[bad];
      dropped.push(bad);
      console.warn('Completamento da file: colonna "' + bad + '" non presente ' +
                   'nel database, eseguire le migrazioni in migrations/. Salvo senza.');
    }
    return { res: { error: new Error('Troppi tentativi di ripiego') }, dropped: dropped };
  }

  /**
   * Completa una scheda GIÀ ESISTENTE con i dati letti da un file Garmin.
   *
   * PERCHÉ NON BASTAVA saveImport
   * Quella crea una scheda NUOVA. Importando il file della corsa che avevi
   * pianificato ti ritrovavi con due voci: la scheda pianificata mai
   * completata e l'attività Garmin. È il motivo per cui in archivio c'erano
   * 27 attività importate accanto alle schede dell'AI, e per cui alcune
   * schede risultavano "da fare" pur essendo state svolte.
   *
   * LA DATA LA DECIDE IL FILE, non il calendario.
   * Se anticipi a oggi l'allenamento previsto per domani, la scheda si
   * sposta a oggi: nel TCX la data sta in <Activity><Id> ed è obbligatoria,
   * quindi è un fatto registrato dall'orologio, non una stima. L'utente può
   * comunque correggerla a mano prima di confermare — da qui il parametro
   * whenIso, che ha la precedenza su quella del file.
   */
  async function completeExistingPlan(data, userId, sc, target, whenIso, note) {
    const iso = whenIso || data.startIso;
    const dateOnly = iso.slice(0, 10);

    // Lo stato di partenza, per rimettere le cose com'erano se la seconda
    // scrittura fallisce. Senza, un errore a metà lascerebbe la scheda
    // segnata come svolta ma senza il record del completamento: sparirebbe
    // dalla dashboard e non comparirebbe nell'archivio.
    const prevRes = await sc.from('workout_plans')
      .select('completed, completed_at, scheduled_date')
      .eq('id', target.planId).eq('user_id', userId).single();
    const prev = prevRes.error ? null : prevRes.data;

    const base = {
      completed: true,
      completed_at: iso,
      scheduled_date: dateOnly,
      average_heart_rate: data.avgHr
    };
    const optional = {
      max_heart_rate: data.maxHr,       // 001
      gps_track:      data.track,       // 001
      temperature:    data.temperature, // 003
      weather:        data.weather || null, // 003
      humidity:       data.humidity,    // 005
      hr_series:      data.hrSeries     // 008
    };

    const upd = await updateDroppingMissing(sc, target.planId, userId, base, optional);
    if (upd.res.error) throw upd.res.error;

    // Se la traccia c'era ma non è stata salvata, l'utente deve saperlo:
    // altrimenti cerca la mappa, non la trova e non capisce perché.
    if (data.track && upd.dropped.indexOf('gps_track') !== -1 && window.showToast) {
      window.showToast('Allenamento completato, ma la traccia GPS non è stata ' +
                       'salvata: manca una colonna nel database (vedi migrations/).',
                       'warning', 7000);
    }

    const compRes = await sc.from('completed_workouts').insert({
      user_id: userId,
      workout_id: target.planId,
      completed_at: iso,
      actual_duration: data.durationMin,
      calories_burned: data.calories,
      distance: data.distanceKm,
      heart_rate_avg: data.avgHr,
      // Il riepilogo per blocco quando le registrazioni erano piu' di
      // una. E' l'unico posto in cui il dettaglio dentro la sessione
      // sopravvive: i totali lo appiattiscono, e da qui arriva all'AI.
      notes: (note && note.trim()) || partsSummary(data) || null
    });

    if (compRes.error) {
      if (prev) {
        await sc.from('workout_plans')
          .update({ completed: prev.completed,
                    completed_at: prev.completed_at,
                    scheduled_date: prev.scheduled_date })
          .eq('id', target.planId).eq('user_id', userId);
      }
      throw compRes.error;
    }

    return { movedFrom: prev ? prev.scheduled_date : null, movedTo: dateOnly };
  }

  async function isDuplicate(startIso, userId, sc) {
    const res = await sc.from('completed_workouts')
      .select('id').eq('user_id', userId).eq('completed_at', startIso).limit(1);
    return !res.error && res.data && res.data.length > 0;
  }

  // ── UI: modal + stile (self-contained) ────────────────────────
  function ensureStyles() {
    if (document.getElementById('tcx-import-styles')) return;
    const s = document.createElement('style');
    s.id = 'tcx-import-styles';
    s.textContent = `
.tcx-ov{position:fixed;inset:0;z-index:3200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .2s}
.tcx-ov.is-open{opacity:1}
.tcx-dlg{background:#fff;border-radius:18px;max-width:440px;width:100%;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);box-shadow:0 24px 60px rgba(15,23,42,.35);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}
.tcx-ov.is-open .tcx-dlg{transform:none}
.tcx-head{display:flex;align-items:center;gap:12px;padding:18px 22px;background:linear-gradient(135deg,#1e3a5f,#e0524d);color:#fff;flex-shrink:0}
.tcx-head i{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.tcx-head h3{margin:0;font-size:1.05rem;font-weight:700}
.tcx-head small{opacity:.85;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.tcx-body{padding:22px;overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0}
.tcx-drop{border:2px dashed #cdd5e3;border-radius:12px;padding:26px 16px;text-align:center;color:#6b7280;cursor:pointer;transition:border-color .15s,background .15s}
.tcx-drop:hover{border-color:#4361ee;background:#f7f9ff}
.tcx-drop i{font-size:1.8rem;color:#4361ee;margin-bottom:8px;display:block}
.tcx-drop b{color:#1a1a2e}
.tcx-preview{display:none}
.tcx-preview.show{display:block}
.tcx-pv-title{font-size:1.05rem;font-weight:700;color:#1a1a2e;margin:0 0 12px;display:flex;align-items:center;gap:8px}
.tcx-pv-title i{color:#4361ee}
.tcx-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tcx-metric{background:#f7f8fa;border-radius:10px;padding:10px 12px}
.tcx-metric .l{font-size:.7rem;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.tcx-metric .v{font-size:1.1rem;font-weight:700;color:#1a1a2e;margin-top:2px}
.tcx-warn{margin-top:12px;padding:10px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:.82rem;color:#92400e}
.tcx-date{margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px}
.tcx-date label{display:flex;align-items:center;gap:.4rem;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin-bottom:6px}
.tcx-date input{width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.9rem;font-family:inherit;color:#1e293b;background:#fff}
.tcx-date input:focus{outline:2px solid #4361ee;outline-offset:1px;border-color:#4361ee}
.tcx-date-note{margin:6px 0 0;font-size:.76rem;line-height:1.45;color:#64748b}
.tcx-blocks{margin-top:12px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px}
.tcx-blocks-h{margin:0 0 8px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#1e40af}
.tcx-blocks ul{list-style:none;margin:0;padding:0}
.tcx-blocks li{display:flex;align-items:center;gap:.5rem;padding:5px 0;border-top:1px solid #dbeafe;font-size:.82rem}
.tcx-blocks li:first-child{border-top:none}
.tcx-blk-t{font-variant-numeric:tabular-nums;color:#64748b;flex-shrink:0}
.tcx-blk-n{font-weight:600;color:#1e293b;flex-shrink:0}
.tcx-blk-d{color:#475569;flex:1;min-width:0}
.tcx-blk-x{border:none;background:none;color:#94a3b8;font-size:1.15rem;line-height:1;cursor:pointer;padding:0 4px;flex-shrink:0}
.tcx-blk-x:hover{color:#dc2626}
.tcx-notes{margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px}
.tcx-notes label{display:flex;align-items:center;gap:.4rem;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin-bottom:6px}
.tcx-notes textarea{width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.85rem;font-family:inherit;line-height:1.5;color:#1e293b;background:#fff;resize:vertical}
.tcx-notes textarea:focus{outline:2px solid #4361ee;outline-offset:1px;border-color:#4361ee}
.tcx-date-note b{color:#1e293b}
.tcx-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;flex-shrink:0}
.tcx-btn{padding:10px 18px;border-radius:10px;font-size:.92rem;font-weight:600;cursor:pointer;border:1.5px solid transparent;font-family:inherit}
.tcx-btn--sec{background:#fff;border-color:#e5e7eb;color:#4b5563}
.tcx-btn--sec:hover{background:#f3f4f6}
.tcx-btn--pri{background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff}
.tcx-btn--pri:hover{opacity:.92}
.tcx-btn--pri:disabled{opacity:.6;cursor:not-allowed}`;
    document.head.appendChild(s);
  }

  // data-metric permette di aggiornare un singolo riquadro quando il dato
  // arriva dopo (il meteo viene recuperato in modo asincrono).
  function metric(label, value) {
    return '<div class="tcx-metric" data-metric="' + label + '">' +
             '<div class="l">' + label + '</div>' +
             '<div class="v">' + value + '</div>' +
           '</div>';
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 'YYYY-MM-DDTHH:MM' nel fuso locale, per <input type="datetime-local">. */
  function toLocalInput(iso) {
    // new Date(null) NON è invalida: vale 0, cioè il 1º gennaio 1970. Senza
    // questa riga un valore assente riempiva il campo con quella data, e
    // confermando la si sarebbe salvata. Trovato da un controllo, non
    // ragionandoci.
    if (iso === null || iso === undefined || iso === '') return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * Il riquadro della data, mostrato solo quando si completa una scheda
   * esistente.
   *
   * LA DATA DEL FILE VINCE SU QUELLA PIANIFICATA. Se anticipi a oggi
   * l'allenamento previsto per domani, è oggi che l'hai fatto: nel TCX la
   * data sta in <Activity><Id> ed è obbligatoria, quindi è un fatto
   * registrato dall'orologio.
   *
   * Ma resta modificabile: un orologio con la data sbagliata, un file
   * vecchio ricaricato, un fuso orario storto. Il campo è precompilato con
   * la data del file, e quello che c'è dentro al momento della conferma è
   * ciò che viene salvato.
   */
  function dateBox(fileIso, scheduledDate) {
    const fileDay = String(fileIso).slice(0, 10);
    const spostata = scheduledDate && scheduledDate !== fileDay;
    const fmt = d => new Date(d + 'T12:00:00')
      .toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

    return '<div class="tcx-date">' +
      '<label for="tcxWhen"><i class="fas fa-calendar-day" aria-hidden="true"></i> ' +
        'Data e ora dell\'allenamento</label>' +
      '<input type="datetime-local" id="tcxWhen" value="' +
        escapeAttr(toLocalInput(fileIso)) + '">' +
      (spostata
        ? '<p class="tcx-date-note">La scheda era in programma per <b>' +
          escapeAttr(fmt(scheduledDate)) + '</b>. Il file dice <b>' +
          escapeAttr(fmt(fileDay)) + '</b>: confermando, la scheda si sposta ' +
          'a quel giorno. Se non è corretto, cambia il campo qui sopra.</p>'
        : '<p class="tcx-date-note">Presa dal file. Modificala se l\'orologio ' +
          'aveva la data sbagliata.</p>') +
    '</div>';
  }

  /**
   * L'elenco dei blocchi caricati, con il pulsante per toglierne uno.
   *
   * Con un blocco solo non compare: sarebbe una riga che ripete i totali
   * mostrati appena sopra.
   */
  function blocksList(blocchi) {
    if (!Array.isArray(blocchi) || blocchi.length < 2) return '';

    // IN ORDINE DI OROLOGIO, non di caricamento.
    //
    // Caricando prima il blocco delle 06:55 e poi quello delle 06:29,
    // l'elenco li mostrava in quell'ordine mentre il riepilogo nelle note
    // — che passa da mergeActivities, che ordina — li mostrava al
    // contrario. Due elenchi della stessa sessione che si contraddicono
    // nella stessa finestra.
    //
    // L'indice per la rimozione resta quello ORIGINALE: è la posizione in
    // blocchi[] che splice deve togliere, e ordinando senza portarselo
    // dietro si cancellerebbe il blocco sbagliato.
    const righe = blocchi
      .map(function (a, i) { return { a: a, i: i }; })
      .sort(function (x, y) { return new Date(x.a.startIso) - new Date(y.a.startIso); })
      .map(function (e) {
        const a = e.a;
        const ora = new Date(a.startIso)
          .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const bits = [a.durationMin + " min"];
        if (a.distanceKm) bits.push(a.distanceKm + ' km');
        if (a.avgHr) bits.push('FC ' + a.avgHr);
        return '<li><span class="tcx-blk-t">' + escapeAttr(ora) + '</span>' +
               '<span class="tcx-blk-n">' + escapeAttr(a.activityLabel) + '</span>' +
               '<span class="tcx-blk-d">' + escapeAttr(bits.join(' · ')) + '</span>' +
               '<button type="button" class="tcx-blk-x" data-rimuovi="' + e.i +
               '" aria-label="Togli questo blocco" title="Togli">&times;</button></li>';
      }).join('');

    return '<div class="tcx-blocks"><p class="tcx-blocks-h">' +
           blocchi.length + ' registrazioni unite in questa sessione</p>' +
           '<ul>' + righe + '</ul></div>';
  }

  /**
   * Il riepilogo per blocco, precompilato e modificabile.
   *
   * Unendo attività diverse alcuni numeri perdono senso — il ritmo medio
   * fra una corsa e una camminata non descrive nessuna delle due — ma il
   * dettaglio non deve andare perso. Finisce nelle note del
   * completamento, che da poco arrivano anche al prompt dell'AI: è lì che
   * il dettaglio per blocco resta leggibile.
   *
   * Precompilato e non imposto: resta testo dell'utente, che può
   * riscriverlo come preferisce prima di confermare.
   */
  function notesBox(riepilogo) {
    if (!riepilogo) return '';
    return '<div class="tcx-notes">' +
      '<label for="tcxNotes"><i class="fas fa-pen-to-square" aria-hidden="true"></i> ' +
        'Note della sessione</label>' +
      '<textarea id="tcxNotes" rows="4">' + escapeAttr(riepilogo) + '</textarea>' +
      '<p class="tcx-date-note">Scritto dall\'app dai file caricati. ' +
        'Modificalo come preferisci: finisce nelle note dell\'allenamento e ' +
        'arriva all\'AI quando genera i prossimi piani.</p>' +
    '</div>';
  }

  // ── Entry point ───────────────────────────────────────────────
  // onDone: callback chiamato dopo un import riuscito (per refresh)
  // preloadedText: contenuto file già disponibile (es. condivisione Android) →
  //                salta la drop-zone e mostra subito l'anteprima.
  // target: { planId, planName, scheduledDate } → invece di creare una
  //         scheda nuova, COMPLETA quella indicata. Senza, comportamento
  //         di sempre.
  window.openTcxImport = function (onDone, preloadedText, target) {
    ensureStyles();
    const sc = window.supabaseClient;
    if (!sc) { if (window.showToast) window.showToast('Supabase non disponibile.', 'error'); return; }

    let parsed = null;
    let userId = null;
    const completa = !!(target && target.planId);
    // I blocchi caricati finora. Una scheda puo' corrispondere a piu'
    // registrazioni separate — corsa, pesi, camminata per una sola
    // sessione pianificata — e caricandone una per volta le altre
    // andrebbero perse. Solo quando si completa una scheda esistente:
    // l'import classico crea una scheda per attivita', quindi li' la
    // fusione non avrebbe senso.
    const blocchi = [];

    const ov = document.createElement('div');
    ov.className = 'tcx-ov';
    ov.innerHTML =
      '<div class="tcx-dlg" role="dialog" aria-modal="true">' +
        (completa
          ? '<div class="tcx-head"><i class="fas fa-file-import"></i><div><small>Completa da file Garmin</small><h3>' +
            escapeAttr(target.planName || 'Allenamento') + '</h3></div></div>'
          : '<div class="tcx-head"><i class="fas fa-file-import"></i><div><small>Importa da Garmin</small><h3>Carica attività (TCX)</h3></div></div>') +
        '<div class="tcx-body">' +
          '<div class="tcx-drop" id="tcxDrop">' +
            '<i class="fas fa-cloud-arrow-up"></i>' +
            '<div><b>Scegli un file .TCX o .GPX</b><br>esportato da Garmin Connect</div>' +
          '</div>' +
          '<input type="file" id="tcxFile"' + (completa ? ' multiple' : '') +
          ' accept=".tcx,.gpx,application/xml,text/xml,application/gpx+xml" style="display:none">' +
          '<div class="tcx-preview" id="tcxPreview"></div>' +
        '</div>' +
        '<div class="tcx-foot">' +
          '<button class="tcx-btn tcx-btn--sec" id="tcxCancel">Annulla</button>' +
          '<button class="tcx-btn tcx-btn--pri" id="tcxSave" disabled>' +
            (completa ? 'Completa' : 'Importa') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('is-open'); });

    const fileInput = ov.querySelector('#tcxFile');
    const drop = ov.querySelector('#tcxDrop');
    const preview = ov.querySelector('#tcxPreview');
    const saveBtn = ov.querySelector('#tcxSave');

    function close() {
      ov.classList.remove('is-open');
      setTimeout(function () { if (ov.parentNode) ov.remove(); }, 200);
    }
    ov.querySelector('#tcxCancel').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    async function processText(testi) {
      const nuovi = [];
      for (const t of (Array.isArray(testi) ? testi : [testi])) {
        try {
          nuovi.push(parseActivity(t));
        } catch (err) {
          if (window.showToast) window.showToast(err.message || 'File non valido.', 'error');
        }
      }
      if (!nuovi.length) return;

      // In modalita' "completa" i blocchi si ACCUMULANO: si possono
      // aggiungere in piu' riprese, perche' l'utente potrebbe esportarli
      // dal Garmin uno alla volta. Nell'import classico ogni attivita' e'
      // una scheda a se', quindi l'ultimo file scelto sostituisce il
      // precedente come e' sempre stato.
      if (completa) nuovi.forEach(function (a) { blocchi.push(a); });
      else { blocchi.length = 0; blocchi.push(nuovi[nuovi.length - 1]); }

      await redraw();
    }

    /**
     * Ridisegna l'anteprima da quello che c'e' nei blocchi.
     *
     * Separata dal caricamento perche' serve anche quando si TOGLIE un
     * blocco: chiamando processText con un elenco vuoto, quella uscirebbe
     * subito senza aggiornare nulla, e la riga rimossa resterebbe in
     * pagina come se ci fosse ancora.
     */
    async function redraw() {
      if (!blocchi.length) return;
      parsed = mergeActivities(blocchi);

      const sess = await sc.auth.getSession();
      userId = sess.data && sess.data.session ? sess.data.session.user.id : null;
      if (!userId) { if (window.showToast) window.showToast('Sessione scaduta, rifai login.', 'error'); return; }

      const dup = await isDuplicate(parsed.startIso, userId, sc);
      const dateStr = new Date(parsed.startIso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      // Punti GPS letti dal file. Serve a distinguere subito "il file non
      // contiene coordinate" da "l'app non le salva": senza questo dato si
      // scopre che la mappa manca solo dopo aver importato, e non si capisce
      // di chi sia la colpa.
      const gpsPoints = Array.isArray(parsed.track) ? parsed.track.length : 0;

      preview.innerHTML =
        '<div class="tcx-pv-title"><i class="fas fa-check-circle"></i>' + parsed.activityLabel + ' — ' + dateStr + '</div>' +
        '<div class="tcx-metrics">' +
          metric('Durata', parsed.durationMin + ' min') +
          metric('Distanza', parsed.distanceKm != null ? parsed.distanceKm + ' km' : '—') +
          metric('Calorie', parsed.calories != null ? parsed.calories + ' kcal' : '—') +
          metric('FC media', parsed.avgHr != null ? parsed.avgHr + ' bpm' : '—') +
          metric('Temperatura', parsed.temperature != null ? parsed.temperature + ' °C' : '—') +
          metric('Punti GPS', gpsPoints > 0 ? gpsPoints + ' punti' : '—') +
          metric('Condizioni', gpsPoints > 0 ? '<i class="fas fa-spinner fa-spin"></i> cerco...' : '—') +
          metric('Umidità', gpsPoints > 0 ? '<i class="fas fa-spinner fa-spin"></i>' : '—') +
        '</div>' +
        (gpsPoints === 0
          ? '<div class="tcx-warn"><i class="fas fa-map-location-dot"></i> Il file non contiene coordinate GPS: la mappa del percorso non sarà disponibile. Se l\'attività è stata registrata all\'aperto, prova a esportarla da Garmin Connect in formato <strong>GPX</strong> invece che TCX.</div>'
          : '') +
        (dup ? '<div class="tcx-warn"><i class="fas fa-triangle-exclamation"></i> Sembra che questa attività sia già stata importata (stessa data e ora). Importandola di nuovo creerai un duplicato.</div>' : '') +
        (completa ? blocksList(blocchi) : '') +
        (completa ? dateBox(parsed.startIso, target.scheduledDate) : '') +
        (completa ? notesBox(partsSummary(parsed)) : '');
      preview.classList.add('show');
      // In modalita' "completa" la zona di scelta resta visibile: si
      // aggiunge un altro blocco senza ricominciare da capo.
      drop.style.display = completa ? '' : 'none';
      saveBtn.disabled = false;

      if (completa) {
        preview.querySelectorAll('[data-rimuovi]').forEach(function (b) {
          b.addEventListener('click', function () {
            blocchi.splice(Number(b.dataset.rimuovi), 1);
            if (!blocchi.length) {
              parsed = null;
              preview.classList.remove('show');
              preview.innerHTML = '';
              saveBtn.disabled = true;
              return;
            }
            redraw();
          });
        });
      }

      // Meteo: serve una posizione, quindi solo per le attività con traccia.
      // Il recupero è asincrono e NON blocca il salvataggio: se il servizio
      // non risponde si importa comunque, il meteo resta vuoto e si può
      // sempre inserire a mano dall'Archivio.
      if (gpsPoints > 0 && window.VortexWeather) {
        const start = parsed.track[0];
        window.VortexWeather.fetch(start[0], start[1], parsed.startIso)
          .then(function (w) {
            if (!w) return;
            // Il file ha la precedenza sul servizio: se l'orologio ha
            // registrato la temperatura, quella è la misura sul posto.
            if (parsed.temperature === null || parsed.temperature === undefined) {
              parsed.temperature = w.temperature;
            }
            parsed.weather = w.weather;
            parsed.weatherLabel = w.label;
            parsed.humidity = w.humidity;
            updateWeatherInPreview(w);
          });
      }
    }

    // Aggiorna i due riquadri meteo nell'anteprima quando la risposta arriva
    function updateWeatherInPreview(w) {
      const tEl = preview.querySelector('[data-metric="Temperatura"] .v');
      if (tEl && parsed.temperature !== null && parsed.temperature !== undefined) {
        tEl.textContent = parsed.temperature + ' °C';
      }
      const cEl = preview.querySelector('[data-metric="Condizioni"] .v');
      if (cEl && w.label) {
        cEl.innerHTML = '<i class="fas ' + w.icon + '"></i> ' + w.label;
      }
      const hEl = preview.querySelector('[data-metric="Umidità"] .v');
      if (hEl) {
        hEl.textContent = (w.humidity !== null && w.humidity !== undefined)
          ? w.humidity + '%' : '—';
      }
    }

    drop.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      const files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      // Il campo si svuota: senza, riscegliendo lo STESSO file l'evento
      // change non scatta e sembra che l'app non risponda.
      Promise.all(files.map(function (f) {
        return new Promise(function (res) {
          const reader = new FileReader();
          reader.onload = function () { res(String(reader.result)); };
          reader.onerror = function () { res(null); };
          reader.readAsText(f);
        });
      })).then(function (testi) {
        fileInput.value = '';
        processText(testi.filter(Boolean));
      });
    });

    // Se arriva un file già pronto (condivisione Android), parsalo subito
    if (preloadedText) processText([preloadedText]);

    saveBtn.addEventListener('click', async function () {
      if (!parsed || !userId) return;
      const etichetta = completa ? 'Completa' : 'Importa';
      saveBtn.disabled = true;
      saveBtn.textContent = completa ? 'Salvo...' : 'Importo...';
      try {
        if (completa) {
          // Il campo della data ha la precedenza sul file: è lì che
          // l'utente corregge un orologio con la data sbagliata.
          const campo = ov.querySelector('#tcxWhen');
          let quando = parsed.startIso;
          if (campo && campo.value) {
            const d = new Date(campo.value);
            // Una data illeggibile non deve diventare "Invalid Date" nel
            // database: in quel caso vince quella del file.
            if (!isNaN(d.getTime())) quando = d.toISOString();
          }

          const campoNote = ov.querySelector('#tcxNotes');
          const note = campoNote ? campoNote.value.trim() : '';

          const esito = await completeExistingPlan(parsed, userId, sc, target, quando, note);
          if (window.showToast) {
            window.showToast(
              esito.movedFrom && esito.movedFrom !== esito.movedTo
                ? 'Allenamento completato e spostato al ' +
                  new Date(esito.movedTo + 'T12:00:00').toLocaleDateString('it-IT')
                : 'Allenamento completato dal file!', 'success');
          }
        } else {
          await saveImport(parsed, userId, sc);
          if (window.showToast) window.showToast('Attività importata con successo!', 'success');
        }
        close();
        if (typeof onDone === 'function') onDone();
      } catch (err) {
        console.error('Errore import TCX:', err);
        if (window.showToast) window.showToast('Errore: ' + (err.message || 'riprova'), 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = etichetta;
      }
    });
  };

  // Apre l'import a partire dal file condiviso (Android Share Target).
  // Il service worker salva il file in cache 'shared-file' → qui lo leggiamo.
  window.openTcxImportFromShare = async function (onDone) {
    try {
      const cache = await caches.open('shared-file');
      const res = await cache.match('/__shared_activity');
      if (!res) return false;
      const text = await res.text();
      await cache.delete('/__shared_activity'); // consuma il file
      window.openTcxImport(onDone, text);
      return true;
    } catch (e) {
      console.warn('Share import error:', e);
      return false;
    }
  };

  // Esportate per i test in Node (scripts/test-hr-series.js). parseTcx e
  // parseGpx non sono qui perché dipendono da DOMParser, che in Node non
  // esiste: quello che si può verificare senza browser è la costruzione
  // del tracciato, ed è anche la parte dove un errore passerebbe
  // inosservato.
  window.TcxImport = {
    _internals: {
      buildHrSeries: buildHrSeries,
      buildTrack: buildTrack,
      toLocalInput: toLocalInput,
      dateBox: dateBox,
      mergeActivities: mergeActivities,
      partsSummary: partsSummary,
      blocksList: blocksList,
      paceOf: paceOf,
      downsamplePairs: downsamplePairs,
      MAX_TRACK_POINTS: MAX_TRACK_POINTS
    }
  };
})();
