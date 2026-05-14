-- =====================================================================
-- RLS RESET — Di Dio Training
-- Esegui questo script nel Supabase SQL Editor (una volta sola)
-- Rimuove tutte le 45 policy esistenti e le sostituisce con il
-- set minimo corretto: ogni utente vede e modifica SOLO i propri dati.
-- =====================================================================

-- ─── STEP 1: RIMUOVI TUTTE LE POLICY ESISTENTI ──────────────────────
-- (evita conflitti con eventuali nomi duplicati)

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;


-- ─── STEP 2: ABILITA RLS SU TUTTE LE TABELLE ────────────────────────

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specific_goals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_programs  ENABLE ROW LEVEL SECURITY;


-- ─── STEP 3: POLICY CORRETTE ─────────────────────────────────────────
-- Regola: ogni utente autenticato accede SOLO alle proprie righe.
-- profiles usa id = auth.uid(); tutte le altre tabelle usano user_id = auth.uid()


-- ── PROFILES ──────────────────────────────────────────────────────────
-- PK della tabella è `id` che coincide con auth.uid()

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ── WORKOUT_PLANS ──────────────────────────────────────────────────────

CREATE POLICY "workout_plans_select_own"
  ON public.workout_plans FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "workout_plans_insert_own"
  ON public.workout_plans FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workout_plans_update_own"
  ON public.workout_plans FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workout_plans_delete_own"
  ON public.workout_plans FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── COMPLETED_WORKOUTS ────────────────────────────────────────────────

CREATE POLICY "completed_workouts_select_own"
  ON public.completed_workouts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "completed_workouts_insert_own"
  ON public.completed_workouts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "completed_workouts_update_own"
  ON public.completed_workouts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "completed_workouts_delete_own"
  ON public.completed_workouts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── BODY_MEASUREMENTS ────────────────────────────────────────────────

CREATE POLICY "body_measurements_select_own"
  ON public.body_measurements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "body_measurements_insert_own"
  ON public.body_measurements FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "body_measurements_update_own"
  ON public.body_measurements FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "body_measurements_delete_own"
  ON public.body_measurements FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── SPECIFIC_GOALS ────────────────────────────────────────────────────

CREATE POLICY "specific_goals_select_own"
  ON public.specific_goals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "specific_goals_insert_own"
  ON public.specific_goals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "specific_goals_update_own"
  ON public.specific_goals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "specific_goals_delete_own"
  ON public.specific_goals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── USER_PREFERENCES ──────────────────────────────────────────────────

CREATE POLICY "user_preferences_select_own"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_preferences_insert_own"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_preferences_update_own"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── NOTIFICATIONS ────────────────────────────────────────────────────

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── WEEKLY_SUMMARIES ──────────────────────────────────────────────────

CREATE POLICY "weekly_summaries_select_own"
  ON public.weekly_summaries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "weekly_summaries_insert_own"
  ON public.weekly_summaries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "weekly_summaries_update_own"
  ON public.weekly_summaries FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "weekly_summaries_delete_own"
  ON public.weekly_summaries FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── TRAINING_PROGRAMS ────────────────────────────────────────────────

CREATE POLICY "training_programs_select_own"
  ON public.training_programs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "training_programs_insert_own"
  ON public.training_programs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "training_programs_update_own"
  ON public.training_programs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "training_programs_delete_own"
  ON public.training_programs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ─── VERIFICA FINALE ─────────────────────────────────────────────────
-- Esegui questa query separatamente per controllare il risultato:
--
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, cmd;
--
-- Dovresti vedere esattamente 35 righe (9 tabelle × ~4 policy ciascuna).
