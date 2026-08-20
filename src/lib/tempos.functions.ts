import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

export const listTempos = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  return query(`SELECT * FROM tempos ORDER BY vehicle_number`);
});

const tempoSchema = z.object({
  id: z.string().uuid().optional(),
  vehicle_number: z.string().min(1).max(50),
  model: z.string().max(100).optional().nullable(),
  assigned_route: z.string().max(200).optional().nullable(),
  active: z.boolean().default(true),
});

export const upsertTempo = createServerFn({ method: "POST" })
  .inputValidator((d) => tempoSchema.parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { queryOne } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      return queryOne(
        `UPDATE tempos SET vehicle_number=$1, model=$2, assigned_route=$3, active=$4
         WHERE id=$5 RETURNING *`,
        [
          data.vehicle_number,
          data.model ?? null,
          data.assigned_route ?? null,
          data.active,
          data.id,
        ],
      );
    } else {
      return queryOne(
        `INSERT INTO tempos (vehicle_number, model, assigned_route, active)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [data.vehicle_number, data.model ?? null, data.assigned_route ?? null, data.active],
      );
    }
  });

export const deleteTempo = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`DELETE FROM tempos WHERE id = $1`, [data.id]);
    return { ok: true };
  });

export const listAssignmentsForDate = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query } = await import("@/integrations/supabase/client.server");
    return query(
      `SELECT ta.*, e.full_name, e.employee_code, t.vehicle_number, t.model
       FROM tempo_assignments ta
       JOIN employees e ON e.id = ta.employee_id
       JOIN tempos t ON t.id = ta.tempo_id
       WHERE ta.assignment_date = $1
       ORDER BY ta.created_at DESC`,
      [data.date],
    );
  });

const assignSchema = z.object({
  employee_id: z.string().uuid(),
  tempo_id: z.string().uuid(),
  role: z.string().min(1).max(50),
  assignment_date: z.string(),
  notes: z.string().max(300).optional().nullable(),
});

export const addAssignment = createServerFn({ method: "POST" })
  .inputValidator((d) => assignSchema.parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { queryOne, execute } = await import("@/integrations/supabase/client.server");
    const tempo = await queryOne<{ active: boolean }>(`SELECT active FROM tempos WHERE id = $1`, [
      data.tempo_id,
    ]);
    if (!tempo?.active) throw new Error("Tempo inactive hai.");
    await execute(
      `INSERT INTO tempo_assignments (employee_id, tempo_id, role, assignment_date, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [data.employee_id, data.tempo_id, data.role, data.assignment_date, data.notes ?? null],
    );
    return { ok: true };
  });

export const removeAssignment = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`DELETE FROM tempo_assignments WHERE id = $1`, [data.id]);
    return { ok: true };
  });
