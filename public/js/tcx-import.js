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

    const m = mapSport(sport);
    return {
      activityType: m.type,
      activityLabel: m.label,
      startIso: startIso,
      durationMin: Math.max(1, Math.round(totalSec / 60)),
      distanceKm: totalMeters ? Math.round(totalMeters / 100) / 10 : null, // 1 decimale
      calories: totalCal ? Math.round(totalCal) : null,
      avgHr: hrTime ? Math.round(hrWeighted / hrTime) : null,
      maxHr: maxHr || null
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

    let dist = 0, hrSum = 0, hrCount = 0;
    let firstTime = null, lastTime = null, prevLat = null, prevLon = null;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const lat = parseFloat(p.getAttribute('lat'));
      const lon = parseFloat(p.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        if (prevLat !== null) dist += haversine(prevLat, prevLon, lat, lon);
        prevLat = lat; prevLon = lon;
      }
      const tEl = p.getElementsByTagNameNS('*', 'time')[0];
      if (tEl) { const tt = new Date(tEl.textContent.trim()); if (!isNaN(tt.getTime())) { if (!firstTime) firstTime = tt; lastTime = tt; } }
      const hrEl = p.getElementsByTagNameNS('*', 'hr')[0];
      if (hrEl) { const hv = parseFloat(hrEl.textContent) || 0; if (hv > 0) { hrSum += hv; hrCount++; } }
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
      maxHr: null
    };
  }

  // Rileva il formato dal contenuto e usa il parser giusto
  function parseActivity(text) {
    return /<gpx[\s>]/i.test(text) ? parseGpx(text) : parseTcx(text);
  }

  // ── Salvataggio su Supabase ───────────────────────────────────
  async function saveImport(data, userId, sc) {
    const dateLabel = new Date(data.startIso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    const name = data.activityLabel + ' — ' + dateLabel;
    const summaryParts = [];
    if (data.distanceKm) summaryParts.push(data.distanceKm + ' km');
    summaryParts.push(data.durationMin + ' min');
    if (data.calories) summaryParts.push(data.calories + ' kcal');
    if (data.avgHr) summaryParts.push('FC ' + data.avgHr + ' bpm');
    const summary = 'Importato da Garmin (TCX): ' + summaryParts.join(' · ');
    const dateOnly = data.startIso.slice(0, 10);

    // 1) crea scheda completata
    const planRes = await sc.from('workout_plans').insert({
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
    }).select('id').single();

    if (planRes.error) throw planRes.error;

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
.tcx-dlg{background:#fff;border-radius:18px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.35);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}
.tcx-ov.is-open .tcx-dlg{transform:none}
.tcx-head{display:flex;align-items:center;gap:12px;padding:18px 22px;background:linear-gradient(135deg,#1e3a5f,#e0524d);color:#fff}
.tcx-head i{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.tcx-head h3{margin:0;font-size:1.05rem;font-weight:700}
.tcx-head small{opacity:.85;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.tcx-body{padding:22px}
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
.tcx-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;background:#f9fafb;border-top:1px solid #e5e7eb}
.tcx-btn{padding:10px 18px;border-radius:10px;font-size:.92rem;font-weight:600;cursor:pointer;border:1.5px solid transparent;font-family:inherit}
.tcx-btn--sec{background:#fff;border-color:#e5e7eb;color:#4b5563}
.tcx-btn--sec:hover{background:#f3f4f6}
.tcx-btn--pri{background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff}
.tcx-btn--pri:hover{opacity:.92}
.tcx-btn--pri:disabled{opacity:.6;cursor:not-allowed}`;
    document.head.appendChild(s);
  }

  function metric(label, value) {
    return '<div class="tcx-metric"><div class="l">' + label + '</div><div class="v">' + value + '</div></div>';
  }

  // ── Entry point ───────────────────────────────────────────────
  // onDone: callback chiamato dopo un import riuscito (per refresh)
  // preloadedText: contenuto file già disponibile (es. condivisione Android) →
  //                salta la drop-zone e mostra subito l'anteprima.
  window.openTcxImport = function (onDone, preloadedText) {
    ensureStyles();
    const sc = window.supabaseClient;
    if (!sc) { if (window.showToast) window.showToast('Supabase non disponibile.', 'error'); return; }

    let parsed = null;
    let userId = null;

    const ov = document.createElement('div');
    ov.className = 'tcx-ov';
    ov.innerHTML =
      '<div class="tcx-dlg" role="dialog" aria-modal="true">' +
        '<div class="tcx-head"><i class="fas fa-file-import"></i><div><small>Importa da Garmin</small><h3>Carica attività (TCX)</h3></div></div>' +
        '<div class="tcx-body">' +
          '<div class="tcx-drop" id="tcxDrop">' +
            '<i class="fas fa-cloud-arrow-up"></i>' +
            '<div><b>Scegli un file .TCX o .GPX</b><br>esportato da Garmin Connect</div>' +
          '</div>' +
          '<input type="file" id="tcxFile" accept=".tcx,.gpx,application/xml,text/xml,application/gpx+xml" style="display:none">' +
          '<div class="tcx-preview" id="tcxPreview"></div>' +
        '</div>' +
        '<div class="tcx-foot">' +
          '<button class="tcx-btn tcx-btn--sec" id="tcxCancel">Annulla</button>' +
          '<button class="tcx-btn tcx-btn--pri" id="tcxSave" disabled>Importa</button>' +
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

    async function processText(text) {
      try {
        parsed = parseActivity(text);
      } catch (err) {
        if (window.showToast) window.showToast(err.message || 'File non valido.', 'error');
        return;
      }
      const sess = await sc.auth.getSession();
      userId = sess.data && sess.data.session ? sess.data.session.user.id : null;
      if (!userId) { if (window.showToast) window.showToast('Sessione scaduta, rifai login.', 'error'); return; }

      const dup = await isDuplicate(parsed.startIso, userId, sc);
      const dateStr = new Date(parsed.startIso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      preview.innerHTML =
        '<div class="tcx-pv-title"><i class="fas fa-check-circle"></i>' + parsed.activityLabel + ' — ' + dateStr + '</div>' +
        '<div class="tcx-metrics">' +
          metric('Durata', parsed.durationMin + ' min') +
          metric('Distanza', parsed.distanceKm != null ? parsed.distanceKm + ' km' : '—') +
          metric('Calorie', parsed.calories != null ? parsed.calories + ' kcal' : '—') +
          metric('FC media', parsed.avgHr != null ? parsed.avgHr + ' bpm' : '—') +
        '</div>' +
        (dup ? '<div class="tcx-warn"><i class="fas fa-triangle-exclamation"></i> Sembra che questa attività sia già stata importata (stessa data e ora). Importandola di nuovo creerai un duplicato.</div>' : '');
      preview.classList.add('show');
      drop.style.display = 'none';
      saveBtn.disabled = false;
    }

    drop.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () { processText(String(reader.result)); };
      reader.readAsText(f);
    });

    // Se arriva un file già pronto (condivisione Android), parsalo subito
    if (preloadedText) processText(preloadedText);

    saveBtn.addEventListener('click', async function () {
      if (!parsed || !userId) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Importo...';
      try {
        await saveImport(parsed, userId, sc);
        if (window.showToast) window.showToast('Attività importata con successo!', 'success');
        close();
        if (typeof onDone === 'function') onDone();
      } catch (err) {
        console.error('Errore import TCX:', err);
        if (window.showToast) window.showToast('Errore import: ' + (err.message || 'riprova'), 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Importa';
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
})();
