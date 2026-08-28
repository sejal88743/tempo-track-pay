CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE attendance_status AS ENUM ('present','absent','late'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE shift_type AS ENUM ('morning','evening'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE leave_type AS ENUM ('casual','sick','paid','unpaid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE request_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE salary_type AS ENUM ('monthly','daily'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app_role AS ENUM ('admin','worker'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS godowns (
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

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text UNIQUE NOT NULL,
  full_name text NOT NULL,
  mobile_number text,
  address text,
  joining_date date NOT NULL DEFAULT current_date,
  roles text[] NOT NULL DEFAULT '{}',
  extra_roles text[] NOT NULL DEFAULT '{}',
  salary_type salary_type NOT NULL DEFAULT 'monthly',
  monthly_salary numeric(12,2) NOT NULL DEFAULT 0,
  assigned_godown_id uuid REFERENCES godowns(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  photo_url text,
  biometric_enrolled boolean NOT NULL DEFAULT false,
  credential_ids text[] NOT NULL DEFAULT '{}',
  face_descriptor double precision[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_credentials (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tempos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number text UNIQUE NOT NULL,
  model text,
  assigned_route text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tempo_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tempo_id uuid NOT NULL REFERENCES tempos(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'Driver',
  assignment_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT current_date,
  shift shift_type NOT NULL DEFAULT 'morning',
  status attendance_status NOT NULL DEFAULT 'present',
  in_time timestamptz,
  out_time timestamptz,
  tempo_id uuid REFERENCES tempos(id) ON DELETE SET NULL,
  late_minutes integer DEFAULT 0,
  notes text,
  marked_by text DEFAULT 'admin',
  device_id text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  location_ok boolean,
  method text,
  daily_salary_override numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date, shift)
);

CREATE TABLE IF NOT EXISTS leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL DEFAULT 'casual',
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  status request_status NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  reason text,
  status request_status NOT NULL DEFAULT 'pending',
  taken_on date NOT NULL DEFAULT current_date,
  deducted boolean NOT NULL DEFAULT false,
  deducted_in_month text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month text NOT NULL,
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

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  role app_role NOT NULL,
  subject_id uuid,
  display_name text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS attendance_emp_date_idx ON attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS tempo_assignments_date_idx ON tempo_assignments(assignment_date);
CREATE INDEX IF NOT EXISTS tempo_assignments_emp_idx ON tempo_assignments(employee_id);

INSERT INTO settings(key, value) VALUES
  ('admin_secret_word', '"MANOJ"'::jsonb),
  ('sheets_sync', '{"enabled": false, "spreadsheet_id": null, "auto_minutes": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;