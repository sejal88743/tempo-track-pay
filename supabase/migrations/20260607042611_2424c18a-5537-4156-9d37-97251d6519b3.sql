
-- ============ ENUMS ============
CREATE TYPE attendance_status AS ENUM ('present','absent','late');
CREATE TYPE shift_type AS ENUM ('morning','evening');
CREATE TYPE leave_type AS ENUM ('casual','sick','paid','unpaid');
CREATE TYPE request_status AS ENUM ('pending','approved','rejected');
CREATE TYPE salary_type AS ENUM ('monthly','daily');
CREATE TYPE app_role AS ENUM ('admin','worker');

-- ============ GODOWNS ============
CREATE TABLE public.godowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  latitude double precision,
  longitude double precision,
  radius_meters integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.godowns TO service_role;
ALTER TABLE public.godowns ENABLE ROW LEVEL SECURITY;

-- ============ EMPLOYEES ============
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text UNIQUE NOT NULL,
  full_name text NOT NULL,
  mobile_number text,
  address text,
  joining_date date NOT NULL DEFAULT current_date,
  roles text[] NOT NULL DEFAULT '{}',
  salary_type salary_type NOT NULL DEFAULT 'monthly',
  monthly_salary numeric(12,2) NOT NULL DEFAULT 0,
  assigned_godown_id uuid REFERENCES public.godowns(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX employees_code_idx ON public.employees(employee_code);
CREATE INDEX employees_godown_idx ON public.employees(assigned_godown_id);

-- ============ WORKER CREDENTIALS ============
CREATE TABLE public.worker_credentials (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.worker_credentials TO service_role;
ALTER TABLE public.worker_credentials ENABLE ROW LEVEL SECURITY;

-- ============ TEMPOS ============
CREATE TABLE public.tempos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number text UNIQUE NOT NULL,
  model text,
  assigned_route text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.tempos TO service_role;
ALTER TABLE public.tempos ENABLE ROW LEVEL SECURITY;

-- ============ TEMPO ASSIGNMENTS ============
CREATE TABLE public.tempo_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  tempo_id uuid NOT NULL REFERENCES public.tempos(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'Driver',
  assignment_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.tempo_assignments TO service_role;
ALTER TABLE public.tempo_assignments ENABLE ROW LEVEL SECURITY;
CREATE INDEX tempo_assignments_date_idx ON public.tempo_assignments(assignment_date);
CREATE INDEX tempo_assignments_emp_idx ON public.tempo_assignments(employee_id);

-- ============ ATTENDANCE ============
CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT current_date,
  shift shift_type NOT NULL DEFAULT 'morning',
  status attendance_status NOT NULL DEFAULT 'present',
  in_time timestamptz,
  out_time timestamptz,
  tempo_id uuid REFERENCES public.tempos(id) ON DELETE SET NULL,
  late_minutes integer DEFAULT 0,
  notes text,
  marked_by text DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date, shift)
);
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE INDEX attendance_date_idx ON public.attendance(attendance_date);
CREATE INDEX attendance_emp_date_idx ON public.attendance(employee_id, attendance_date);

-- ============ LEAVES ============
CREATE TABLE public.leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL DEFAULT 'casual',
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  status request_status NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.leaves TO service_role;
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;

-- ============ ADVANCES ============
CREATE TABLE public.advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  reason text,
  status request_status NOT NULL DEFAULT 'pending',
  taken_on date NOT NULL DEFAULT current_date,
  deducted boolean NOT NULL DEFAULT false,
  deducted_in_month text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.advances TO service_role;
ALTER TABLE public.advances ENABLE ROW LEVEL SECURITY;

-- ============ SALARIES ============
CREATE TABLE public.salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month text NOT NULL,  -- 'YYYY-MM'
  total_days integer NOT NULL,
  present_days numeric(6,2) NOT NULL DEFAULT 0,
  absent_days numeric(6,2) NOT NULL DEFAULT 0,
  paid_leave_days numeric(6,2) NOT NULL DEFAULT 0,
  unpaid_leave_days numeric(6,2) NOT NULL DEFAULT 0,
  per_day numeric(12,2) NOT NULL DEFAULT 0,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  bonus numeric(12,2) NOT NULL DEFAULT 0,
  penalty numeric(12,2) NOT NULL DEFAULT 0,
  advance_deducted numeric(12,2) NOT NULL DEFAULT 0,
  leave_deduction numeric(12,2) NOT NULL DEFAULT 0,
  final_salary numeric(12,2) NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);
GRANT ALL ON public.salaries TO service_role;
ALTER TABLE public.salaries ENABLE ROW LEVEL SECURITY;

-- ============ SETTINGS (key/value) ============
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- ============ SESSIONS (cookie-token based custom auth) ============
CREATE TABLE public.sessions (
  token text PRIMARY KEY,
  role app_role NOT NULL,
  subject_id uuid,             -- employee_id when role='worker', null for admin
  display_name text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX sessions_expires_idx ON public.sessions(expires_at);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_godowns_u BEFORE UPDATE ON public.godowns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_employees_u BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_worker_cred_u BEFORE UPDATE ON public.worker_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tempos_u BEFORE UPDATE ON public.tempos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_attendance_u BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Seed: default admin secret word + a starter godown ============
INSERT INTO public.settings(key, value) VALUES
  ('admin_secret_word', '"MANOJ"'::jsonb),
  ('sheets_sync', '{"enabled": false, "spreadsheet_id": null, "auto_minutes": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.godowns(name, address, latitude, longitude, radius_meters)
VALUES ('Main Godown', 'Default location', 0, 0, 100)
ON CONFLICT DO NOTHING;
