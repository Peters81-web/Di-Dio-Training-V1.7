-- =====================================================================
-- RLS RESET — Di Dio Training
-- Eseguibile nel Supabase SQL Editor in modo SICURO e RIPETIBILE.
--
-- Differenze rispetto alla versione precedente:
--   * Non rimuove più TUTTE le policy del public schema (era distruttivo
--     se nel frattempo erano state aggiunte policy custom non gestite
--     da questo file).
--   * Per ogni singola policy: DROP IF EXISTS + CREATE, quindi è 100%
--     idempotente (puoi rieseguirlo quanto vuoi).
--   * Include la policy DELETE su user_preferences (mancava).
--
-- Regola generale:
--   ogni utente autenticato accede SOLO alle proprie righe.
--   profiles usa id = auth.uid(); tutte le altre tabelle user_id = auth.uid()
--
-- Tabelle gestite (12): profiles, workout_plans, completed_workouts,
--   body_measurements, specific_goals, user_preferences, notifications,
--   weekly_summaries, training_programs, activities (read-only),
--   scheduled_workouts (nested via training_programs).
-- =====================================================================


-- ─── STEP 1: ABILITA RLS SU TUTTE LE TABELLE ────────────────────────
-- ALTER TABLE ... ENABLE RLS è già idempotente (no-op se attivo)

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_workouts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_measurements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specific_goals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_summaries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_programs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_workouts  ENABLE ROW LEVEL SECURITY;


-- ─── STEP 2: POLICY (DROP IF EXISTS + CREATE per ognuna) ────────────

-- ── PROFILES ──────────────────────────────────────────────────────────
-- PK della tabella è `id` che coincide con auth.uid()

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ── WORKOUT_PLANS ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "workout_plans_select_own" ON public.workout_plans;
CREATE POLICY "workout_plans_select_own"
  ON public.workout_plans FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "workout_plans_insert_own" ON public.workout_plans;
CREATE POLICY "workout_plans_insert_own"
  ON public.workout_plans FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "workout_plans_update_own" ON public.workout_plans;
CREATE POLICY "workout_plans_update_own"
  ON public.workout_plans FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "workout_plans_delete_own" ON public.workout_plans;
CREATE POLICY "workout_plans_delete_own"
  ON public.workout_plans FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── COMPLETED_WORKOUTS ────────────────────────────────────────────────

DROP POLICY IF EXISTS "completed_workouts_select_own" ON public.completed_workouts;
CREATE POLICY "completed_workouts_select_own"
  ON public.completed_workouts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "completed_workouts_insert_own" ON public.completed_workouts;
CREATE POLICY "completed_workouts_insert_own"
  ON public.completed_workouts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "completed_workouts_update_own" ON public.completed_workouts;
CREATE POLICY "completed_workouts_update_own"
  ON public.completed_workouts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "completed_workouts_delete_own" ON public.completed_workouts;
CREATE POLICY "completed_workouts_delete_own"
  ON public.completed_workouts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── BODY_MEASUREMENTS ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "body_measurements_select_own" ON public.body_measurements;
CREATE POLICY "body_measurements_select_own"
  ON public.body_measurements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "body_measurements_insert_own" ON public.body_measurements;
CREATE POLICY "body_measurements_insert_own"
  ON public.body_measurements FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "body_measurements_update_own" ON public.body_measurements;
CREATE POLICY "body_measurements_update_own"
  ON public.body_measurements FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "body_measurements_delete_own" ON public.body_measurements;
CREATE POLICY "body_measurements_delete_own"
  ON public.body_measurements FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── SPECIFIC_GOALS ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "specific_goals_select_own" ON public.specific_goals;
CREATE POLICY "specific_goals_select_own"
  ON public.specific_goals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "specific_goals_insert_own" ON public.specific_goals;
CREATE POLICY "specific_goals_insert_own"
  ON public.specific_goals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "specific_goals_update_own" ON public.specific_goals;
CREATE POLICY "specific_goals_update_own"
  ON public.specific_goals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "specific_goals_delete_own" ON public.specific_goals;
CREATE POLICY "specific_goals_delete_own"
  ON public.specific_goals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── USER_PREFERENCES ──────────────────────────────────────────────────
-- NB: include policy DELETE (mancante nella versione precedente)

DROP POLICY IF EXISTS "user_preferences_select_own" ON public.user_preferences;
CREATE POLICY "user_preferences_select_own"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_insert_own" ON public.user_preferences;
CREATE POLICY "user_preferences_insert_own"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_update_own" ON public.user_preferences;
CREATE POLICY "user_preferences_update_own"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_delete_own" ON public.user_preferences;
CREATE POLICY "user_preferences_delete_own"
  ON public.user_preferences FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── NOTIFICATIONS ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── WEEKLY_SUMMARIES ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "weekly_summaries_select_own" ON public.weekly_summaries;
CREATE POLICY "weekly_summaries_select_own"
  ON public.weekly_summaries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "weekly_summaries_insert_own" ON public.weekly_summaries;
CREATE POLICY "weekly_summaries_insert_own"
  ON public.weekly_summaries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "weekly_summaries_update_own" ON public.weekly_summaries;
CREATE POLICY "weekly_summaries_update_own"
  ON public.weekly_summaries FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "weekly_summaries_delete_own" ON public.weekly_summaries;
CREATE POLICY "weekly_summaries_delete_own"
  ON public.weekly_summaries FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── TRAINING_PROGRAMS ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "training_programs_select_own" ON public.training_programs;
CREATE POLICY "training_programs_select_own"
  ON public.training_programs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "training_programs_insert_own" ON public.training_programs;
CREATE POLICY "training_programs_insert_own"
  ON public.training_programs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "training_programs_update_own" ON public.training_programs;
CREATE POLICY "training_programs_update_own"
  ON public.training_programs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "training_programs_delete_own" ON public.training_programs;
CREATE POLICY "training_programs_delete_own"
  ON public.training_programs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── ACTIVITIES ────────────────────────────────────────────────────────
-- Tabella di riferimento (dati statici: Corsa, Palestra, ecc.)
-- Solo lettura per tutti gli utenti autenticati — nessun utente può
-- inserire/modificare/eliminare voci di questa tabella dal client.

DROP POLICY IF EXISTS "activities_select_all_authenticated" ON public.activities;
CREATE POLICY "activities_select_all_authenticated"
  ON public.activities FOR SELECT
  TO authenticated
  USING (true);


-- ── SCHEDULED_WORKOUTS ────────────────────────────────────────────────
-- Non ha user_id diretto: appartiene a training_programs tramite FK.
-- La policy verifica che il programma genitore appartenga all'utente.

DROP POLICY IF EXISTS "scheduled_workouts_select_own" ON public.scheduled_workouts;
CREATE POLICY "scheduled_workouts_select_own"
  ON public.scheduled_workouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs tp
      WHERE tp.id = scheduled_workouts.program_id
        AND tp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scheduled_workouts_insert_own" ON public.scheduled_workouts;
CREATE POLICY "scheduled_workouts_insert_own"
  ON public.scheduled_workouts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.training_programs tp
      WHERE tp.id = scheduled_workouts.program_id
        AND tp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scheduled_workouts_update_own" ON public.scheduled_workouts;
CREATE POLICY "scheduled_workouts_update_own"
  ON public.scheduled_workouts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs tp
      WHERE tp.id = scheduled_workouts.program_id
        AND tp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scheduled_workouts_delete_own" ON public.scheduled_workouts;
CREATE POLICY "scheduled_workouts_delete_own"
  ON public.scheduled_workouts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs tp
      WHERE tp.id = scheduled_workouts.program_id
        AND tp.user_id = auth.uid()
    )
  );


-- =====================================================================
-- VERIFICA FINALE — esegui in una query separata
-- =====================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' ORDER BY tablename, cmd;
--
-- Atteso: 38 policy totali
--   activities:          1 (SELECT only)
--   body_measurements:   4
--   completed_workouts:  4
--   notifications:       4
--   profiles:            3
--   scheduled_workouts:  4
--   specific_goals:      4
--   training_programs:   4
--   user_preferences:    4   ← include DELETE adesso
--   weekly_summaries:    4
--   workout_plans:       4
-- =====================================================================
