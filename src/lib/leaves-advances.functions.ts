import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

export const listLeaves = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  return query(
    `SELECT l.*, e.full_name, e.employee_code
     FROM leaves l JOIN employees e ON e.id = l.employee_id
     ORDER BY l.created_at DESC`,
  );
});

export const decideLeave = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "rejected"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`UPDATE leaves SET status=$1, decided_at=$2 WHERE id=$3`, [
      data.status,
      new Date().toISOString(),
      data.id,
    ]);
    return { ok: true };
  });

export const adminCreateLeave = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        employee_id: z.string().uuid(),
        leave_type: z.enum(["casual", "sick", "paid", "unpaid"]),
        from_date: z.string(),
        to_date: z.string(),
        reason: z.string().max(500).optional().nullable(),
        status: z.enum(["pending", "approved", "rejected"]).default("approved"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO leaves (employee_id, leave_type, from_date, to_date, reason, status, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        data.employee_id,
        data.leave_type,
        data.from_date,
        data.to_date,
        data.reason ?? null,
        data.status,
        data.status !== "pending" ? new Date().toISOString() : null,
      ],
    );
    return { ok: true };
  });

export const listAdvances = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  return query(
    `SELECT a.*, e.full_name, e.employee_code
     FROM advances a JOIN employees e ON e.id = a.employee_id
     ORDER BY a.created_at DESC`,
  );
});

export const decideAdvance = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "rejected"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`UPDATE advances SET status=$1 WHERE id=$2`, [data.status, data.id]);
    return { ok: true };
  });

export const adminCreateAdvance = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        employee_id: z.string().uuid(),
        amount: z.number().positive(),
        reason: z.string().max(300).optional().nullable(),
        taken_on: z.string(),
        status: z.enum(["pending", "approved", "rejected"]).default("approved"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO advances (employee_id, amount, reason, taken_on, status)
       VALUES ($1,$2,$3,$4,$5)`,
      [data.employee_id, data.amount, data.reason ?? null, data.taken_on, data.status],
    );
    return { ok: true };
  });

export const myApplyLeave = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        leave_type: z.enum(["casual", "sick", "paid", "unpaid"]),
        from_date: z.string(),
        to_date: z.string(),
        reason: z.string().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireWorker } = await import("./session.server");
    const s = await requireWorker();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO leaves (employee_id, leave_type, from_date, to_date, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [s.subject_id!, data.leave_type, data.from_date, data.to_date, data.reason ?? null],
    );
    return { ok: true };
  });

export const myRequestAdvance = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        amount: z.number().positive(),
        reason: z.string().max(300).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireWorker } = await import("./session.server");
    const s = await requireWorker();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO advances (employee_id, amount, reason, taken_on)
       VALUES ($1,$2,$3,$4)`,
      [s.subject_id!, data.amount, data.reason ?? null, new Date().toISOString().slice(0, 10)],
    );
    return { ok: true };
  });
