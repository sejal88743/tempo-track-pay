import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export const listSalaries = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ month: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query } = await import("@/integrations/supabase/client.server");
    return query(
      `SELECT s.*, e.full_name, e.employee_code, e.monthly_salary AS emp_monthly_salary
       FROM salaries s JOIN employees e ON e.id = s.employee_id
       WHERE s.month = $1
       ORDER BY s.generated_at DESC`,
      [data.month],
    );
  });

export const generateMonthlySalaries = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { query, execute } = await import("@/integrations/supabase/client.server");
    const total = daysInMonth(data.month);
    const monthStart = `${data.month}-01`;
    const monthEnd = `${data.month}-${String(total).padStart(2, "0")}`;

    const emps = await query<{ id: string; monthly_salary: string }>(
      `SELECT id, monthly_salary FROM employees WHERE active = true`,
    );
    if (!emps.length) return { ok: true, count: 0 };

    const att = await query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM attendance
       WHERE attendance_date >= $1 AND attendance_date <= $2 AND shift = 'morning'`,
      [monthStart, monthEnd],
    );

    const leaves = await query<{
      employee_id: string;
      leave_type: string;
      from_date: string;
      to_date: string;
    }>(
      `SELECT employee_id, leave_type, from_date, to_date FROM leaves
       WHERE status = 'approved' AND from_date <= $1 AND to_date >= $2`,
      [monthEnd, monthStart],
    );

    const adv = await query<{ id: string; employee_id: string; amount: string }>(
      `SELECT id, employee_id, amount FROM advances
       WHERE status != 'rejected' AND (deducted = false OR deducted_in_month = $1)`,
      [data.month],
    );

    const presentByEmp = new Map<string, number>();
    att.forEach((r) => {
      if (r.status === "present" || r.status === "late") {
        presentByEmp.set(r.employee_id, (presentByEmp.get(r.employee_id) ?? 0) + 1);
      }
    });

    const advByEmp = new Map<string, { sum: number; ids: string[] }>();
    adv.forEach((a) => {
      const cur = advByEmp.get(a.employee_id) ?? { sum: 0, ids: [] };
      cur.sum += Number(a.amount);
      cur.ids.push(a.id);
      advByEmp.set(a.employee_id, cur);
    });

    const overlapDays = (from: string, to: string) => {
      const a = new Date(Math.max(new Date(from).getTime(), new Date(monthStart).getTime()));
      const b = new Date(Math.min(new Date(to).getTime(), new Date(monthEnd).getTime()));
      return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
    };
    const paidByEmp = new Map<string, number>();
    const unpaidByEmp = new Map<string, number>();
    leaves.forEach((l) => {
      const d = overlapDays(l.from_date, l.to_date);
      if (l.leave_type === "paid" || l.leave_type === "sick") {
        paidByEmp.set(l.employee_id, (paidByEmp.get(l.employee_id) ?? 0) + d);
      } else {
        unpaidByEmp.set(l.employee_id, (unpaidByEmp.get(l.employee_id) ?? 0) + d);
      }
    });

    for (const e of emps) {
      const present = presentByEmp.get(e.id) ?? 0;
      const paid = paidByEmp.get(e.id) ?? 0;
      const unpaid = unpaidByEmp.get(e.id) ?? 0;
      const per = Number(e.monthly_salary) / total;
      const gross = per * (present + paid);
      const leave_deduction = per * unpaid;
      const advance_deducted = advByEmp.get(e.id)?.sum ?? 0;
      const final_salary = Math.max(0, gross - leave_deduction - advance_deducted);
      await execute(
        `INSERT INTO salaries
           (employee_id, month, total_days, present_days, absent_days, paid_leave_days,
            unpaid_leave_days, per_day, gross, bonus, penalty, advance_deducted, leave_deduction, final_salary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,$11,$12)
         ON CONFLICT (employee_id, month) DO UPDATE SET
           total_days=EXCLUDED.total_days, present_days=EXCLUDED.present_days,
           absent_days=EXCLUDED.absent_days, paid_leave_days=EXCLUDED.paid_leave_days,
           unpaid_leave_days=EXCLUDED.unpaid_leave_days, per_day=EXCLUDED.per_day,
           gross=EXCLUDED.gross, advance_deducted=EXCLUDED.advance_deducted,
           leave_deduction=EXCLUDED.leave_deduction, final_salary=EXCLUDED.final_salary,
           generated_at=now()`,
        [
          e.id,
          data.month,
          total,
          present,
          total - present - paid - unpaid,
          paid,
          unpaid,
          Number(per.toFixed(2)),
          Number(gross.toFixed(2)),
          advance_deducted,
          Number(leave_deduction.toFixed(2)),
          Number(final_salary.toFixed(2)),
        ],
      );
    }

    const allIds = adv.map((a) => a.id);
    if (allIds.length) {
      const placeholders = allIds.map((_, i) => `$${i + 2}`).join(", ");
      await execute(
        `UPDATE advances SET deducted = true, deducted_in_month = $1 WHERE id IN (${placeholders})`,
        [data.month, ...allIds],
      );
    }
    return { ok: true, count: emps.length };
  });

export const updateSalaryRow = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        bonus: z.number().min(0).default(0),
        penalty: z.number().min(0).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { queryOne, execute } = await import("@/integrations/supabase/client.server");
    const cur = await queryOne<{
      gross: string;
      leave_deduction: string;
      advance_deducted: string;
    }>(`SELECT gross, leave_deduction, advance_deducted FROM salaries WHERE id = $1`, [data.id]);
    if (!cur) throw new Error("Not found");
    const final = Math.max(
      0,
      Number(cur.gross) -
        Number(cur.leave_deduction) -
        Number(cur.advance_deducted) +
        data.bonus -
        data.penalty,
    );
    await execute(`UPDATE salaries SET bonus=$1, penalty=$2, final_salary=$3 WHERE id=$4`, [
      data.bonus,
      data.penalty,
      Number(final.toFixed(2)),
      data.id,
    ]);
    return { ok: true };
  });
