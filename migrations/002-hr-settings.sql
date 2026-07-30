-- =====================================================================
-- MIGRAZIONE 002 — Frequenza cardiaca massima e a riposo nel profilo
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- corregge il calcolo delle zone cardio.
--
-- SICUREZZA:
--   * Puramente ADDITIVA e IDEMPOTENTE, come la 001: aggiunge colonne,
--     non modifica né elimina nulla. I dati esistenti restano intatti.
--   * Nessuna modifica alle policy RLS: le colonne ereditano quelle già
--     attive su profiles (id = auth.uid()).
--
-- PERCHÉ SERVE:
--   Le zone venivano calcolate come percentuale della FC massima, con la
--   massima stimata dall'età (Tanaka). Garmin usa invece la percentuale
--   della RISERVA cardiaca (formula di Karvonen), che parte dalla FC a
--   riposo. Ricostruendo i confini mostrati da Garmin per un utente
--   reale:
--
--                        Z1    Z2    Z3    Z4    Z5
--     Garmin            115   130   142   155   167
--     Karvonen          119   131   143   155   167   <- scarto 0-1 bpm
--     % della massima    89   106   124   142   159   <- fuori di 20-25
--
--   La stima dell'età era buona (177 contro 179 reali): era il metodo a
--   essere sbagliato. Karvonen tiene conto di quanto si è allenati, e
--   serve la FC a riposo, che non si può dedurre dall'età.
--
--   Entrambi i valori restano opzionali: senza, si continua a stimare la
--   massima dall'età e a usare la percentuale della massima.
-- =====================================================================


-- ─── FC massima misurata ─────────────────────────────────────────────
-- Se valorizzata sostituisce la stima di Tanaka (208 - 0,7 x età).
-- Da copiare da Garmin Connect, che la aggiorna sulle attività reali.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_heart_rate integer;

COMMENT ON COLUMN public.profiles.max_heart_rate IS
  'FC massima misurata, in bpm. NULL = stimata dall''età con la formula di Tanaka.';


-- ─── FC a riposo ─────────────────────────────────────────────────────
-- Abilita il calcolo delle zone con Karvonen (% della riserva cardiaca),
-- lo stesso metodo di Garmin. Senza, si ripiega sulla % della massima.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS resting_heart_rate integer;

COMMENT ON COLUMN public.profiles.resting_heart_rate IS
  'FC a riposo, in bpm. Se presente le zone usano Karvonen (%% riserva cardiaca) invece della %% della massima.';


-- ─── Vincoli di sanità ───────────────────────────────────────────────
-- Valori fuori scala indicano un errore di digitazione, non un caso
-- clinico: meglio rifiutarli subito che vederli falsare tutte le zone.
-- DROP + ADD per restare idempotenti.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_max_heart_rate_range;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_max_heart_rate_range
  CHECK (max_heart_rate IS NULL OR (max_heart_rate BETWEEN 100 AND 250));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_resting_heart_rate_range;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_resting_heart_rate_range
  CHECK (resting_heart_rate IS NULL OR (resting_heart_rate BETWEEN 30 AND 120));

-- La riserva cardiaca deve avere senso: una massima non superiore alla
-- FC a riposo produrrebbe zone invertite o divisioni per zero.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_hr_reserve_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_hr_reserve_valid
  CHECK (
    max_heart_rate IS NULL
    OR resting_heart_rate IS NULL
    OR max_heart_rate > resting_heart_rate + 40
  );


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Deve restituire esattamente due righe.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name IN ('max_heart_rate', 'resting_heart_rate')
ORDER BY column_name;
