-- =====================================================================
-- MIGRAZIONE 004 — Provenienza dell'allenamento
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce i filtri per provenienza.
--
-- SICUREZZA:
--   * ADDITIVA: aggiunge una colonna, non ne modifica né elimina.
--   * L'UPDATE di riempimento tocca SOLO la colonna nuova (source), mai
--     i dati esistenti.
--   * IDEMPOTENTE: rieseguirla non cambia nulla (il riempimento agisce
--     solo dove source è ancora NULL).
--   * Nessuna modifica alle policy RLS.
--
-- PERCHÉ SERVE:
--   Le attività importate da Garmin sono fatti compiuti: mostrarle con i
--   pulsanti "Completa" e "Modifica" non ha senso. I piani generati
--   dall'AI e quelli creati a mano sono invece cose da fare.
--
--   Oggi la provenienza è deducibile solo dal TESTO dell'obiettivo:
--     'Attività importata da Garmin'   -> import
--     'Piano generato dall''AI Trainer' -> AI
--     qualsiasi altra cosa              -> manuale
--   ma objective è modificabile dall'utente, quindi basta correggerlo e
--   l'attività "cambia provenienza". Serve un dato esplicito.
-- =====================================================================


-- ─── 1. Colonna ──────────────────────────────────────────────────────

ALTER TABLE public.workout_plans
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.workout_plans.source IS
  'Provenienza: garmin (importata, gia svolta), ai (generata dall''AI Trainer), manual (creata dall''utente).';


-- ─── 2. Riempimento delle righe esistenti ────────────────────────────
-- Le due stringhe sono costanti scritte dal codice, mai digitate a mano,
-- quindi il riconoscimento è affidabile per le righe già presenti.
-- La clausola "source IS NULL" rende l'operazione ripetibile senza
-- sovrascrivere valori già assegnati.

UPDATE public.workout_plans
   SET source = 'garmin'
 WHERE source IS NULL
   AND objective = 'Attività importata da Garmin';

UPDATE public.workout_plans
   SET source = 'ai'
 WHERE source IS NULL
   AND objective = 'Piano generato dall''AI Trainer';

-- Tutto il resto è creazione manuale
UPDATE public.workout_plans
   SET source = 'manual'
 WHERE source IS NULL;


-- ─── 3. Default e vincolo ────────────────────────────────────────────
-- Default 'manual': se un giorno una nuova scrittura dimenticasse di
-- valorizzare source, l'allenamento resterebbe completabile e
-- modificabile — il comportamento meno sorprendente.

ALTER TABLE public.workout_plans
  ALTER COLUMN source SET DEFAULT 'manual';

ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_source_values;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_source_values
  CHECK (source IS NULL OR source IN ('garmin', 'ai', 'manual'));


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- Mostra quante attività per provenienza: utile per controllare che il
-- riempimento abbia riconosciuto correttamente gli import Garmin.

SELECT COALESCE(source, '(nessuna)') AS provenienza,
       COUNT(*) AS attivita
FROM public.workout_plans
GROUP BY source
ORDER BY attivita DESC;
