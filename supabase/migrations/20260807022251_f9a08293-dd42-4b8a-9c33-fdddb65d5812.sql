-- Backfill Sunday rule for past Sundays: if Saturday and Monday are both present/late,
-- Sunday becomes present. Only overrides rows that were auto/manually blanket-marked absent.
WITH sundays AS (
  SELECT DISTINCT a.attendance_date AS d
  FROM public.attendance a
  WHERE EXTRACT(DOW FROM a.attendance_date) = 0
),
calc AS (
  SELECT s.d, e.id AS emp,
    (SELECT status FROM public.attendance x WHERE x.employee_id=e.id AND x.attendance_date=s.d-1 AND x.shift='morning' LIMIT 1) AS sat,
    (SELECT status FROM public.attendance x WHERE x.employee_id=e.id AND x.attendance_date=s.d+1 AND x.shift='morning' LIMIT 1) AS mon
  FROM sundays s CROSS JOIN public.employees e WHERE e.active
)
UPDATE public.attendance a
SET status='present', method='auto-sunday'
FROM calc c
WHERE a.employee_id=c.emp AND a.attendance_date=c.d AND a.shift='morning'
  AND a.status='absent'
  AND COALESCE(a.method,'manual') NOT IN ('face','fingerprint')
  AND c.sat IN ('present','late') AND c.mon IN ('present','late');