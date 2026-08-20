import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

export const listEmployees = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  return query(
    `SELECT e.*, g.name AS godown_name
     FROM employees e
     LEFT JOIN godowns g ON g.id = e.assigned_godown_id
     ORDER BY e.created_at DESC`,
  );
});

const empSchema = z.object({
  id: z.string().uuid().optional(),
  employee_code: z.string().min(1).max(64),
  full_name: z.string().min(1).max(200),
  mobile_number: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  joining_date: z.string().optional(),
  roles: z.array(z.string()).default([]),
  salary_type: z.enum(["monthly", "daily"]).default("monthly"),
  monthly_salary: z.number().min(0).default(0),
  assigned_godown_id: z.string().uuid().optional().nullable(),
  active: z.boolean().default(true),
});

export const upsertEmployee = createServerFn({ method: "POST" })
  .inputValidator((d) => empSchema.parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { queryOne } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      return queryOne(
        `UPDATE employees SET
           employee_code=$1, full_name=$2, mobile_number=$3, address=$4,
           joining_date=$5, roles=$6, salary_type=$7, monthly_salary=$8,
           assigned_godown_id=$9, active=$10
         WHERE id=$11 RETURNING *`,
        [
          data.employee_code,
          data.full_name,
          data.mobile_number ?? null,
          data.address ?? null,
          data.joining_date ?? null,
          JSON.stringify(data.roles),
          data.salary_type,
          data.monthly_salary,
          data.assigned_godown_id ?? null,
          data.active,
          data.id,
        ],
      );
    } else {
      return queryOne(
        `INSERT INTO employees
           (employee_code, full_name, mobile_number, address, joining_date, roles,
            salary_type, monthly_salary, assigned_godown_id, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          data.employee_code,
          data.full_name,
          data.mobile_number ?? null,
          data.address ?? null,
          data.joining_date ?? null,
          JSON.stringify(data.roles),
          data.salary_type,
          data.monthly_salary,
          data.assigned_godown_id ?? null,
          data.active,
        ],
      );
    }
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`DELETE FROM employees WHERE id = $1`, [data.id]);
    return { ok: true };
  });

export const setWorkerPassword = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ employee_id: z.string().uuid(), password: z.string().min(4).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash(data.password, 10);
    await execute(
      `INSERT INTO worker_credentials (employee_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (employee_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [data.employee_id, hash],
    );
    return { ok: true };
  });
