-- =====================================================================
-- MIGRAZIONE 003 — Temperatura e condizioni meteo dell'allenamento
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce temperatura e meteo.
--
-- SICUREZZA:
--   * Puramente ADDITIVA e IDEMPOTENTE, come la 001 e la 002: aggiunge
--     colonne, non modifica né elimina nulla.
--   * Nessuna modifica alle policy RLS: le colonne ereditano quelle già
--     attive su workout_plans (user_id = auth.uid()).
--
-- PERCHÉ SU workout_plans:
--   completed_workouts è la fonte di verità dei completamenti, ma
--   workout_plans porta già i dati denormalizzati letti da dashboard e
--   archivio (average_heart_rate, max_heart_rate, gps_track). Mettere
--   qui temperatura e meteo evita una join in più solo per mostrarli.
-- =====================================================================


-- ─── Temperatura ─────────────────────────────────────────────────────
-- Dai GPX Garmin arriva da <gpxtpx:atemp>, presente in ogni trackpoint
-- accanto a <gpxtpx:hr>: è la media dei valori registrati.
--
-- ATTENZIONE ALL'INTERPRETAZIONE: è il sensore dell'orologio, che al
-- polso legge anche il calore corporeo e tipicamente segna 3-5 gradi
-- più dell'aria reale (Garmin stessa lo dichiara; per il dato preciso
-- serve il sensore esterno tempe). L'interfaccia la etichetta quindi
-- come "registrata dall'orologio", non come temperatura ambiente.
--
-- numeric(4,1): da -99.9 a 999.9, un decimale. Sufficiente e compatto.

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS temperature numeric(4,1);

COMMENT ON COLUMN public.workout_plans.temperature IS
  'Temperatura in gradi Celsius. Dai GPX Garmin viene dal sensore dell''orologio (tende a sovrastimare l''aria di 3-5 gradi), altrimenti inserita a mano. NULL se non disponibile.';


-- ─── Condizioni meteo ────────────────────────────────────────────────
-- NON esistono nei file TCX/GPX: Garmin Connect le recupera da un
-- servizio meteo dopo il caricamento. Qui sono inserite a mano.
-- Valori chiusi invece di testo libero, così restano filtrabili e
-- confrontabili fra allenamenti.

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS weather text;

COMMENT ON COLUMN public.workout_plans.weather IS
  'Condizioni meteo: sereno, nuvoloso, pioggia, vento, neve, afoso, indoor. NULL se non indicate.';


-- ─── Vincoli di sanità ───────────────────────────────────────────────
-- DROP + ADD per restare idempotenti (Postgres non ha
-- ADD CONSTRAINT IF NOT EXISTS).

-- Fuori da questo intervallo è un errore di lettura o di digitazione,
-- non un allenamento estremo: il record di freddo per una corsa è
-- attorno ai -50, quello di caldo attorno ai +50.
ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_temperature_range;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_temperature_range
  CHECK (temperature IS NULL OR (temperature BETWEEN -60 AND 60));

ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_weather_values;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_weather_values
  CHECK (weather IS NULL OR weather IN
    ('sereno', 'nuvoloso', 'pioggia', 'vento', 'neve', 'afoso', 'indoor'));


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Deve restituire esattamente due righe.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workout_plans'
  AND column_name IN ('temperature', 'weather')
ORDER BY column_name;
