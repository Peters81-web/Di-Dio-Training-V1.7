-- =====================================================================
-- MIGRAZIONE 006 — Log di serie, ripetizioni e carico (palestra)
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce il log della palestra.
--
-- SICUREZZA:
--   * ADDITIVA: crea una tabella nuova, non tocca nulla di esistente.
--     Nessuna colonna aggiunta o modificata sulle tabelle già in uso.
--   * IDEMPOTENTE: CREATE TABLE IF NOT EXISTS + DROP/CREATE POLICY,
--     quindi rieseguirla non produce errori né duplica le policy.
--   * RLS ATTIVA con le stesse quattro policy delle altre tabelle
--     (user_id = auth.uid()). Senza, la tabella sarebbe leggibile da
--     qualunque utente autenticato: è la parte da non saltare.
--   * Se NON viene eseguita l'app continua a funzionare: il log si
--     disattiva da solo e il resto della dashboard non cambia di una
--     virgola. Vedi isMissingTableError() in public/js/exercise-log.js.
--
-- PERCHÉ SERVE:
--   Oggi "3 serie da 10 con 60 kg" esiste solo come TESTO, dentro il
--   prompt dell'AI o nel campo main_phase. Essendo prosa non è
--   interrogabile: non si può rispondere a "quanto sollevavo sulla panca
--   un mese fa?" né mostrare il sovraccarico progressivo, che è il
--   singolo indicatore più utile per chi va in palestra.
--
--   Una tabella separata invece di colonne su workout_plans perché il
--   rapporto è uno-a-molti: una sessione contiene molti esercizi, e ogni
--   esercizio molte serie. Appiattirlo in colonne significherebbe
--   inventare un limite arbitrario (serie_1_peso, serie_2_peso, ...).
--
-- PERCHÉ AGGANCIATA A workout_plans:
--   completed_workouts resta la fonte di verità dei COMPLETAMENTI, ma
--   la scheda è l'oggetto che l'utente apre e guarda, ed è già la chiave
--   usata da completed_workouts.workout_id. Agganciarsi lì tiene una
--   sola convenzione invece di due.
-- =====================================================================


-- ─── 1. Tabella ──────────────────────────────────────────────────────
-- uuid_generate_v4() e non gen_random_uuid(): è la funzione già usata da
-- workout_plans e completed_workouts, meglio non introdurre una seconda
-- convenzione nello stesso schema.

CREATE TABLE IF NOT EXISTS public.exercise_sets (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ON DELETE CASCADE su entrambe: cancellando l'utente o la scheda, le
  -- serie non devono restare orfane. La dashboard cancella già le schede
  -- e senza cascade resterebbero righe irraggiungibili ma conteggiate
  -- nelle statistiche di progressione.
  user_id       uuid NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  workout_id    uuid NOT NULL REFERENCES public.workout_plans(id) ON DELETE CASCADE,

  exercise_name text NOT NULL,

  -- Chiave di raggruppamento fra sessioni diverse. GENERATED e non
  -- calcolata dal client: "Panca Piana", "panca piana" e "  Panca piana "
  -- devono finire nella stessa progressione, e se il calcolo stesse nel
  -- client basterebbe una schermata che se ne dimentica per spezzare lo
  -- storico in due serie che non si parlano.
  exercise_key  text GENERATED ALWAYS AS (lower(btrim(exercise_name))) STORED,

  set_number    integer NOT NULL,
  reps          integer,
  weight_kg     numeric(5,1),

  -- Denormalizzata da workout_plans (completed_at, o scheduled_date se
  -- l'allenamento non è ancora stato completato). Serve al grafico di
  -- progressione, che altrimenti dovrebbe fare una join solo per sapere
  -- QUANDO è stata sollevata una certa quantità: stessa logica per cui
  -- temperature e gps_track stanno su workout_plans invece che altrove.
  performed_at  timestamptz NOT NULL DEFAULT now(),

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.exercise_sets IS
  'Serie svolte in palestra: un record per singola serie di un esercizio. Collegata alla scheda in workout_plans.';
COMMENT ON COLUMN public.exercise_sets.exercise_key IS
  'exercise_name normalizzato (minuscolo, senza spazi ai bordi): raggruppa lo stesso esercizio fra sessioni diverse.';
COMMENT ON COLUMN public.exercise_sets.weight_kg IS
  'Carico in kg. 0 = a corpo libero. NULL = non registrato.';
COMMENT ON COLUMN public.exercise_sets.performed_at IS
  'Quando è stata svolta, copiata da workout_plans. Denormalizzata per evitare una join nel calcolo della progressione.';


-- ─── 2. Vincoli di sanità ────────────────────────────────────────────
-- Come nelle migrazioni precedenti: un valore fuori scala è un errore di
-- digitazione, non un'impresa sportiva. Meglio rifiutarlo subito che
-- vederlo falsare la progressione per sempre.
-- DROP + ADD per restare idempotenti.

ALTER TABLE public.exercise_sets
  DROP CONSTRAINT IF EXISTS exercise_sets_name_length;
ALTER TABLE public.exercise_sets
  ADD CONSTRAINT exercise_sets_name_length
  CHECK (char_length(btrim(exercise_name)) BETWEEN 1 AND 80);

ALTER TABLE public.exercise_sets
  DROP CONSTRAINT IF EXISTS exercise_sets_set_number_range;
ALTER TABLE public.exercise_sets
  ADD CONSTRAINT exercise_sets_set_number_range
  CHECK (set_number BETWEEN 1 AND 50);

ALTER TABLE public.exercise_sets
  DROP CONSTRAINT IF EXISTS exercise_sets_reps_range;
ALTER TABLE public.exercise_sets
  ADD CONSTRAINT exercise_sets_reps_range
  CHECK (reps IS NULL OR (reps BETWEEN 1 AND 1000));

-- 0 è legittimo (corpo libero), il limite alto è ben oltre il record
-- mondiale di stacco: oltre, è un errore di battitura.
ALTER TABLE public.exercise_sets
  DROP CONSTRAINT IF EXISTS exercise_sets_weight_range;
ALTER TABLE public.exercise_sets
  ADD CONSTRAINT exercise_sets_weight_range
  CHECK (weight_kg IS NULL OR (weight_kg BETWEEN 0 AND 500));

-- Una sola riga per (scheda, esercizio, numero di serie): impedisce i
-- doppioni se un salvataggio parte due volte.
ALTER TABLE public.exercise_sets
  DROP CONSTRAINT IF EXISTS exercise_sets_unique_set;
ALTER TABLE public.exercise_sets
  ADD CONSTRAINT exercise_sets_unique_set
  UNIQUE (workout_id, exercise_key, set_number);


-- ─── 3. Indici ───────────────────────────────────────────────────────
-- Il primo serve alla progressione ("panca negli ultimi mesi"), il
-- secondo al caricamento delle serie di una singola scheda.
-- Senza il primo, ogni apertura del dettaglio farebbe una scansione
-- completa della tabella.

CREATE INDEX IF NOT EXISTS exercise_sets_progression_idx
  ON public.exercise_sets (user_id, exercise_key, performed_at DESC);

CREATE INDEX IF NOT EXISTS exercise_sets_workout_idx
  ON public.exercise_sets (workout_id);


-- ─── 4. Row Level Security ───────────────────────────────────────────
-- LA PARTE DA NON SALTARE. La tabella è nuova e quindi SENZA policy:
-- con RLS attiva e nessuna policy non legge nessuno, senza RLS attiva
-- legge chiunque sia autenticato. Le quattro policy sono identiche per
-- forma a quelle di completed_workouts in rls-reset.sql.

ALTER TABLE public.exercise_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exercise_sets_select_own" ON public.exercise_sets;
CREATE POLICY "exercise_sets_select_own"
  ON public.exercise_sets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "exercise_sets_insert_own" ON public.exercise_sets;
CREATE POLICY "exercise_sets_insert_own"
  ON public.exercise_sets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "exercise_sets_update_own" ON public.exercise_sets;
CREATE POLICY "exercise_sets_update_own"
  ON public.exercise_sets FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "exercise_sets_delete_own" ON public.exercise_sets;
CREATE POLICY "exercise_sets_delete_own"
  ON public.exercise_sets FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- 1) rls_attiva deve essere true e n_policy deve essere 4. Se n_policy
--    fosse 0 la tabella sarebbe inaccessibile anche al proprietario.

SELECT c.relname            AS tabella,
       c.relrowsecurity     AS rls_attiva,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = 'exercise_sets') AS n_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'exercise_sets';

-- 2) Le colonne, inclusa la generata (exercise_key deve risultare
--    is_generated = ALWAYS).
SELECT column_name, data_type, is_generated
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'exercise_sets'
ORDER BY ordinal_position;
