import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

export const listAttendanceForDate = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query } = await import("@/integrations/supabase/client.server");
    const [emps, att] = await Promise.all([
      query(
        `SELECT id, employee_code, full_name, assigned_godown_id, active
         FROM employees WHERE active = true ORDER BY full_name`,
      ),
      query(`SELECT * FROM attendance WHERE attendance_date = $1`, [data.date]),
    ]);
    return { employees: emps, attendance: att };
  });

const markSchema = z.object({
  employee_id: z.string().uuid(),
  attendance_date: z.string(),
  shift: z.enum(["morning", "evening"]),
  status: z.enum(["present", "absent", "late"]),
  in_time: z.string().optional().nullable(),
  out_time: z.string().optional().nullable(),
  tempo_id: z.string().uuid().optional().nullable(),
  late_minutes: z.number().int().min(0).default(0),
  notes: z.string().max(500).optional().nullable(),
});

export const markAttendance = createServerFn({ method: "POST" })
  .inputValidator((d) => markSchema.parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO attendance
         (employee_id, attendance_date, shift, status, in_time, out_time, tempo_id, late_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (employee_id, attendance_date, shift) DO UPDATE SET
         status = EXCLUDED.status,
         in_time = EXCLUDED.in_time,
         out_time = EXCLUDED.out_time,
         tempo_id = EXCLUDED.tempo_id,
         late_minutes = EXCLUDED.late_minutes,
         notes = EXCLUDED.notes`,
      [
        data.employee_id,
        data.attendance_date,
        data.shift,
        data.status,
        data.in_time ?? null,
        data.out_time ?? null,
        data.tempo_id ?? null,
        data.late_minutes,
        data.notes ?? null,
      ],
    );
    return { ok: true };
  });

export const bulkMarkAbsent = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ date: z.string(), shift: z.enum(["morning", "evening"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query, execute } = await import("@/integrations/supabase/client.server");
    const emps = await query<{ id: string }>(`SELECT id FROM employees WHERE active = true`);
    if (!emps.length) return { ok: true, count: 0 };
    for (const e of emps) {
      await execute(
        `INSERT INTO attendance (employee_id, attendance_date, shift, status)
         VALUES ($1, $2, $3, 'absent')
         ON CONFLICT (employee_id, attendance_date, shift) DO NOTHING`,
        [e.id, data.date, data.shift],
      );
    }
    return { ok: true, count: emps.length };
  });

export const runSundayRule = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sundayDate: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query, execute } = await import("@/integrations/supabase/client.server");
    const sun = new Date(data.sundayDate + "T00:00:00Z");
    if (sun.getUTCDay() !== 0) throw new Error("Date Sunday honi chahiye.");
    const sat = new Date(sun.getTime() - 86400000).toISOString().slice(0, 10);
    const mon = new Date(sun.getTime() + 86400000).toISOString().slice(0, 10);
    const emps = await query<{ id: string }>(`SELECT id FROM employees WHERE active = true`);
    if (!emps.length) return { ok: true, count: 0 };
    const satRows = await query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM attendance WHERE attendance_date = $1 AND shift = 'morning'`,
      [sat],
    );
    const monRows = await query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM attendance WHERE attendance_date = $1 AND shift = 'morning'`,
      [mon],
    );
    const satMap = new Map(satRows.map((r) => [r.employee_id, r.status]));
    const monMap = new Map(monRows.map((r) => [r.employee_id, r.status]));
    for (const e of emps) {
      const satOk = ["present", "late"].includes(satMap.get(e.id) ?? "");
      const monOk = ["present", "late"].includes(monMap.get(e.id) ?? "");
      const status = satOk && monOk ? "present" : "absent";
      await execute(
        `INSERT INTO attendance (employee_id, attendance_date, shift, status, notes)
         VALUES ($1, $2, 'morning', $3, 'Auto Sunday rule')
         ON CONFLICT (employee_id, attendance_date, shift) DO UPDATE SET
           status = EXCLUDED.status, notes = EXCLUDED.notes`,
        [e.id, data.sundayDate, status],
      );
    }
    return { ok: true, count: emps.length };
  });

export const myRecentAttendance = createServerFn({ method: "GET" }).handler(async () => {
  const { requireWorker } = await import("./session.server");
  const s = await requireWorker();
  const { query, queryOne } = await import("@/integrations/supabase/client.server");
  const today = new Date();
  const from = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const rows = await query(
    `SELECT a.*, t.vehicle_number
     FROM attendance a
     LEFT JOIN tempos t ON t.id = a.tempo_id
     WHERE a.employee_id = $1 AND a.attendance_date >= $2
     ORDER BY a.attendance_date DESC`,
    [s.subject_id!, from],
  );
  const emp = await queryOne<{ full_name: string; employee_code: string }>(
    `SELECT full_name, employee_code FROM employees WHERE id = $1`,
    [s.subject_id!],
  );
  return { rows, me: emp };
});
