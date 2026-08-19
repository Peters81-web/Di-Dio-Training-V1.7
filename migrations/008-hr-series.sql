-- =====================================================================
-- MIGRAZIONE 008 — Tracciato cardiaco della sessione
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce il tempo reale in zona.
--
-- SICUREZZA:
--   * Puramente ADDITIVA e IDEMPOTENTE: aggiunge una colonna, non
--     modifica né elimina nulla.
--   * Nessuna modifica alle policy RLS: la colonna eredita quelle già
--     attive su workout_plans (user_id = auth.uid()).
--   * Se non viene eseguita l'app continua a funzionare: import e
--     letture scartano la sola colonna mancante e proseguono con la FC
--     media di sempre.
--
-- PERCHÉ SERVE:
--   L'interfaccia dichiara da sempre di avere "solo la FC media per
--   sessione, non il tracciato continuo", e che quindi un intervallato
--   Z2/Z5 risulta un Z3 costante. Non era vero dei DATI: era vero del
--   parser. Un TCX Garmin contiene un <HeartRateBpm> per ogni
--   <Trackpoint> — su una corsa reale di 52 minuti, 3153 campioni — e
--   l'import li attraversava per prendere le coordinate GPS, leggendo la
--   frequenza solo dalle 16 medie di lap.
--
--   La differenza non è di precisione, è di sostanza. Su quella corsa:
--
--     media dei lap        140 bpm  ->  "zona 2"
--     tracciato reale      45% in Z3, 37% Z2, 12% Z1, 5% Z4
--
--   Cioè l'app la riassumeva come fondo aerobico mentre quasi metà era
--   in zona medio — e quel giudizio finiva nel prompt dell'AI.
--
-- PERCHÉ LA SERIE E NON I TOTALI GIÀ CALCOLATI:
--   Tempo in zona e TRIMP dipendono da FC massima e a riposo, che stanno
--   nel profilo e possono cambiare. Salvando i totali, il giorno in cui
--   si corregge la FC massima tutto lo storico resterebbe calcolato con
--   il valore vecchio, senza che nulla lo segnali. Salvando la serie, si
--   ricalcola sempre con i parametri correnti.
-- =====================================================================


-- ─── Tracciato cardiaco ──────────────────────────────────────────────
-- Array JSON di coppie [secondiDallInizio, bpm]:
--   [[0,81],[6,84],[12,91], ...]
--
-- Sottocampionato dal client a un massimo di 500 punti, esattamente come
-- gps_track. Verificato sul file reale: a 500 punti l'errore sulla
-- distribuzione nelle zone è di 0,45 punti percentuali e il TRIMP passa
-- da 87,8 a 87,3. Il peso scende da ~90 KB a ~5 KB.
--
-- jsonb e non text: coerente con gps_track e interrogabile in futuro.

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS hr_series jsonb;

COMMENT ON COLUMN public.workout_plans.hr_series IS
  'Tracciato cardiaco sottocampionato: array JSON di coppie [secondi dall inizio, bpm], max 500 punti. NULL se il file non conteneva la frequenza per trackpoint.';


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Deve restituire esattamente una riga.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workout_plans'
  AND column_name  = 'hr_series';
