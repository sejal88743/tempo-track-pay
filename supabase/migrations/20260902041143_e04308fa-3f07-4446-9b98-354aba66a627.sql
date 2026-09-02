CREATE INDEX IF NOT EXISTS attendance_updated_at_idx ON public.attendance (updated_at);
CREATE INDEX IF NOT EXISTS employees_updated_at_idx ON public.employees (updated_at);
CREATE INDEX IF NOT EXISTS tempos_updated_at_idx ON public.tempos (updated_at);
CREATE INDEX IF NOT EXISTS leaves_created_at_idx ON public.leaves (created_at);
CREATE INDEX IF NOT EXISTS advances_created_at_idx ON public.advances (created_at);
CREATE INDEX IF NOT EXISTS salaries_generated_at_idx ON public.salaries (generated_at);