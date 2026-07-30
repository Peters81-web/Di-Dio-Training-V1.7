-- =====================================================================
-- MIGRAZIONE 001 — Traccia GPS e FC massima sulle attività importate
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce la mappa dei percorsi. Al contrario il codice proverebbe a
-- scrivere in colonne che non esistono ancora.
--
-- SICUREZZA:
--   * Puramente ADDITIVA: aggiunge colonne, non ne modifica né elimina.
--     I dati esistenti non vengono toccati in alcun modo.
--   * IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, quindi rieseguirla non
--     produce errori né effetti collaterali.
--   * Non richiede modifiche alle policy RLS: le colonne ereditano
--     quelle già attive su workout_plans (accesso alle sole righe
--     con user_id = auth.uid()).
--
-- PERCHÉ SERVE:
--   tcx-import.js legge già latitudine e longitudine di ogni punto del
--   file GPX per calcolare la distanza con la formula dell'emisenoverso,
--   e poi le scarta. Stessa sorte per la frequenza cardiaca massima, che
--   viene estratta dal TCX e mai salvata. Queste due colonne conservano
--   quei dati invece di buttarli.
-- =====================================================================


-- ─── 1. Traccia GPS ──────────────────────────────────────────────────
-- Array di coppie [latitudine, longitudine] in formato JSON:
--   [[45.46427, 9.18951], [45.46431, 9.18948], ...]
--
-- Il client sottocampiona a un massimo di 500 punti e arrotonda a 5
-- decimali (~1 metro di precisione): più che sufficiente per disegnare
-- il percorso, e tiene la riga sotto i ~12 KB invece dei ~70 KB che
-- occuperebbe un'ora di registrazione a 1 punto al secondo.
--
-- jsonb e non text: consente di interrogare la struttura in futuro
-- (per esempio jsonb_array_length per contare i punti).

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS gps_track jsonb;

COMMENT ON COLUMN public.workout_plans.gps_track IS
  'Traccia GPS sottocampionata: array JSON di coppie [lat, lon]. NULL se l''attività non ha dati di posizione (palestra, file TCX senza GPS).';


-- ─── 2. Frequenza cardiaca massima ───────────────────────────────────
-- Il TCX espone MaximumHeartRateBpm per ogni lap: tcx-import.js lo legge
-- già (variabile maxHr) ma non lo salva da nessuna parte. Affiancata alla
-- media, permette di mostrare il picco raggiunto nella sessione.

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS max_heart_rate integer;

COMMENT ON COLUMN public.workout_plans.max_heart_rate IS
  'Picco di frequenza cardiaca della sessione, in bpm. NULL se non disponibile nel file importato.';


-- ─── 3. Vincoli di sanità ────────────────────────────────────────────
-- Un valore fuori da questo intervallo indica un file corrotto o un
-- errore di parsing, non un atleta eccezionale. Meglio rifiutarlo subito
-- che ritrovarselo a falsare medie e grafici.
-- DROP + ADD per restare idempotenti (Postgres non ha ADD CONSTRAINT IF NOT EXISTS).

ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_max_heart_rate_range;

ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_max_heart_rate_range
  CHECK (max_heart_rate IS NULL OR (max_heart_rate BETWEEN 30 AND 250));


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Esegui anche questa: deve restituire esattamente due righe.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workout_plans'
  AND column_name IN ('gps_track', 'max_heart_rate')
ORDER BY column_name;
