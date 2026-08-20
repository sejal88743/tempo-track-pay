-- 1. Add missing columns to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS face_descriptor float8[],
  ADD COLUMN IF NOT EXISTS credential_ids text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS biometric_enrolled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_roles text[] DEFAULT '{}'::text[];

-- 2. Add device / GPS tracking columns to attendance
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS latitude float8,
  ADD COLUMN IF NOT EXISTS longitude float8,
  ADD COLUMN IF NOT EXISTS accuracy_meters float8,
  ADD COLUMN IF NOT EXISTS location_ok boolean,
  ADD COLUMN IF NOT EXISTS method text;

-- 3. Open GRANTs to anon + authenticated on all public app tables (no Supabase auth in this app)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','attendance','leaves','advances','salaries',
    'tempos','tempo_assignments','godowns','settings','worker_credentials','sessions'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Drop any prior open policy and recreate
    EXECUTE format('DROP POLICY IF EXISTS "open_all_%I" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "open_all_%I" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- 4. Enable realtime on the tables the app watches
ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.settings REPLICA IDENTITY FULL;
ALTER TABLE public.leaves REPLICA IDENTITY FULL;
ALTER TABLE public.advances REPLICA IDENTITY FULL;
ALTER TABLE public.salaries REPLICA IDENTITY FULL;
ALTER TABLE public.tempos REPLICA IDENTITY FULL;
ALTER TABLE public.tempo_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.godowns REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','attendance','leaves','advances','salaries',
    'tempos','tempo_assignments','godowns','settings'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;