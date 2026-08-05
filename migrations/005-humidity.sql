-- =====================================================================
-- MIGRAZIONE 005 — Umidità relativa dell'allenamento
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce l'umidità.
--
-- SICUREZZA:
--   * ADDITIVA e IDEMPOTENTE come le precedenti: aggiunge una colonna,
--     non modifica né elimina nulla.
--   * Nessuna modifica alle policy RLS.
--   * Se non viene eseguita l'app continua a funzionare: import e
--     salvataggi scartano la sola colonna mancante e proseguono.
--
-- PERCHÉ SERVE:
--   L'umidità incide sulla prestazione quanto la temperatura, a volte di
--   più: con aria satura il sudore evapora poco, la termoregolazione
--   perde efficacia e a parità di ritmo la frequenza cardiaca sale.
--   Correre a 24 gradi con l'85% di umidità non è come correre a 24 con
--   il 40%.
--
--   Serve anche all'AI Trainer: conoscendo le condizioni in cui l'utente
--   si allena abitualmente può calibrare ritmi, durate e indicazioni
--   sull'idratazione, invece di proporre lo stesso piano per un clima
--   secco e per uno afoso.
-- =====================================================================


ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS humidity integer;

COMMENT ON COLUMN public.workout_plans.humidity IS
  'Umidità relativa in percentuale (0-100), dal servizio meteo o inserita a mano. NULL se non disponibile.';


-- ─── Vincolo di sanità ───────────────────────────────────────────────
-- L'umidità relativa è per definizione una percentuale: fuori da 0-100
-- è un errore di lettura o di digitazione.
-- DROP + ADD per restare idempotenti.

ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_humidity_range;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_humidity_range
  CHECK (humidity IS NULL OR (humidity BETWEEN 0 AND 100));


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Deve restituire esattamente una riga.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workout_plans'
  AND column_name  = 'humidity';
