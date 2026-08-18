-- =====================================================================
-- MIGRAZIONE 007 — Metriche giornaliere di recupero
--
-- Da eseguire nel Supabase SQL Editor PRIMA di mergiare la PR che
-- introduce l'inserimento dei dati di recupero.
--
-- SICUREZZA:
--   * ADDITIVA: crea una tabella nuova, non tocca nulla di esistente.
--   * IDEMPOTENTE: CREATE TABLE IF NOT EXISTS + DROP/CREATE POLICY.
--   * RLS ATTIVA con le stesse quattro policy delle altre tabelle
--     (user_id = auth.uid()). La tabella è nuova, quindi senza policy
--     non leggerebbe nessuno e senza RLS leggerebbe chiunque sia
--     autenticato: è la parte da non saltare.
--   * Se NON viene eseguita l'app continua a funzionare: la sezione si
--     spegne da sola. Vedi isMissingTableError() in daily-metrics.js.
--
-- PERCHÉ SERVE:
--   Il banner del recupero dichiara oggi, testualmente, di non avere
--   "il tracciato cardiaco secondo per secondo, la variabilità cardiaca
--   e il sonno". Sono i tre ingressi su cui Garmin fonda il proprio
--   indice. Questa tabella è il posto dove metterli.
--
--   Arriveranno da Health Connect (app Android, fase 3), ma la tabella
--   nasce prima e accetta anche l'inserimento a mano: così il recupero
--   e l'AI possono iniziare a usarli senza aspettare l'app nativa, e se
--   quel progetto si fermasse il lavoro fatto qui resterebbe utile.
--
-- PERCHÉ UNA RIGA PER GIORNO E NON PER SESSIONE:
--   Variabilità, sonno e FC a riposo sono misure del RISVEGLIO, non di
--   un allenamento: descrivono come si è arrivati alla giornata. Legarle
--   a una sessione sarebbe sbagliato — ci sono giorni senza allenamento
--   che hanno comunque un dato di recupero, ed è proprio quello che
--   serve sapere.
--
-- COSA NON C'È QUI:
--   Il tracciato cardiaco continuo. Serve una tabella diversa (molte
--   righe per sessione) e può arrivare solo dall'app Android: crearla
--   ora, vuota e senza nessuno che la scriva, sarebbe codice morto.
--   Arriverà con la migrazione della fase 3.
-- =====================================================================


-- ─── 1. Tabella ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_metrics (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Il giorno a cui la misura si riferisce (quello del risveglio), non
  -- il momento in cui è stata inserita.
  metric_date        date NOT NULL,

  -- Variabilità cardiaca, RMSSD in millisecondi. È il numero che
  -- Health Connect espone come HeartRateVariabilityRmssdRecord.
  -- ATTENZIONE: Garmin mostra "HRV Status" (bilanciato/basso/alto), che
  -- è un giudizio calcolato sulla propria linea di base, non un numero
  -- confrontabile. Qui si conserva il valore grezzo.
  hrv_rmssd          numeric(5,1),

  -- FC a riposo del giorno. Diversa da profiles.resting_heart_rate, che
  -- è il valore di riferimento usato per le zone: questa è la misura
  -- quotidiana, e la sua variazione rispetto alla media è il segnale.
  resting_hr         integer,

  sleep_minutes      integer,   -- durata totale
  sleep_deep_minutes integer,
  sleep_rem_minutes  integer,

  vo2max             numeric(4,1),

  -- Provenienza: chi ha scritto la riga. Serve a non sovrascrivere un
  -- dato letto dall'orologio con una correzione a mano senza saperlo,
  -- e viceversa.
  source             text NOT NULL DEFAULT 'manual',

  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.daily_metrics IS
  'Metriche giornaliere di recupero (variabilita cardiaca, sonno, FC a riposo, VO2max). Una riga per giorno.';
COMMENT ON COLUMN public.daily_metrics.hrv_rmssd IS
  'Variabilita cardiaca RMSSD in millisecondi. Valore grezzo, non lo "HRV Status" di Garmin che e un giudizio sulla linea di base personale.';
COMMENT ON COLUMN public.daily_metrics.resting_hr IS
  'FC a riposo del giorno in bpm. Distinta da profiles.resting_heart_rate, che e il riferimento fisso per le zone.';
COMMENT ON COLUMN public.daily_metrics.source IS
  'Provenienza: manual (inserita a mano) o health_connect (letta dall app Android).';


-- ─── 2. Vincoli di sanità ────────────────────────────────────────────
-- Come nelle migrazioni precedenti: fuori scala è un errore di
-- digitazione, non un caso limite. DROP + ADD per restare idempotenti.

ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_one_per_day;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_one_per_day
  UNIQUE (user_id, metric_date);

-- RMSSD: i valori tipici stanno fra 20 e 100 ms, gli atleti allenati
-- arrivano oltre 150. Sotto 1 o sopra 300 è un errore di lettura.
ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_hrv_range;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_hrv_range
  CHECK (hrv_rmssd IS NULL OR (hrv_rmssd BETWEEN 1 AND 300));

-- Stesso intervallo del vincolo su profiles, per coerenza.
ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_resting_hr_range;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_resting_hr_range
  CHECK (resting_hr IS NULL OR (resting_hr BETWEEN 30 AND 120));

ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_sleep_range;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_sleep_range
  CHECK (
    (sleep_minutes      IS NULL OR (sleep_minutes      BETWEEN 0 AND 1440)) AND
    (sleep_deep_minutes IS NULL OR (sleep_deep_minutes BETWEEN 0 AND 1440)) AND
    (sleep_rem_minutes  IS NULL OR (sleep_rem_minutes  BETWEEN 0 AND 1440))
  );

-- Le fasi non possono superare il totale: se succede, uno dei due dati
-- è sbagliato, e sommarli darebbe un sonno più lungo della notte.
ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_sleep_phases_coherent;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_sleep_phases_coherent
  CHECK (
    sleep_minutes IS NULL
    OR (COALESCE(sleep_deep_minutes, 0) + COALESCE(sleep_rem_minutes, 0)) <= sleep_minutes
  );

ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_vo2max_range;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_vo2max_range
  CHECK (vo2max IS NULL OR (vo2max BETWEEN 10 AND 100));

ALTER TABLE public.daily_metrics
  DROP CONSTRAINT IF EXISTS daily_metrics_source_values;
ALTER TABLE public.daily_metrics
  ADD CONSTRAINT daily_metrics_source_values
  CHECK (source IN ('manual', 'health_connect'));


-- ─── 3. Indice ───────────────────────────────────────────────────────
-- Le letture sono sempre "gli ultimi N giorni di questo utente".

CREATE INDEX IF NOT EXISTS daily_metrics_user_date_idx
  ON public.daily_metrics (user_id, metric_date DESC);


-- ─── 4. Row Level Security ───────────────────────────────────────────
-- Sono dati sanitari: qui la RLS conta più che altrove.

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_metrics_select_own" ON public.daily_metrics;
CREATE POLICY "daily_metrics_select_own"
  ON public.daily_metrics FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "daily_metrics_insert_own" ON public.daily_metrics;
CREATE POLICY "daily_metrics_insert_own"
  ON public.daily_metrics FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "daily_metrics_update_own" ON public.daily_metrics;
CREATE POLICY "daily_metrics_update_own"
  ON public.daily_metrics FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "daily_metrics_delete_own" ON public.daily_metrics;
CREATE POLICY "daily_metrics_delete_own"
  ON public.daily_metrics FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ─── VERIFICA ────────────────────────────────────────────────────────
-- rls_attiva deve essere true e n_policy deve essere 4.

SELECT c.relname        AS tabella,
       c.relrowsecurity AS rls_attiva,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = 'daily_metrics') AS n_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'daily_metrics';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'daily_metrics'
ORDER BY ordinal_position;
