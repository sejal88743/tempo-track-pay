// Pure salary calculation — no Supabase dependency

import {
  getEmployees,
  getAttendance,
  getLeaves,
  getAdvances,
  saveAdvances,
  saveSalaries,
  getSalaries,
  daysInMonth,
  newId,
  normalizeDate,
  type SalaryRecord,
} from "./store";

export function generateSalaries(month: string): SalaryRecord[] {
  const total = daysInMonth(month);
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

  const emps = getEmployees().filter((e) => e.active);

  const att = getAttendance().filter(
    (r) =>
      r.shift === "morning" &&
      normalizeDate(r.date) >= monthStart &&
      normalizeDate(r.date) <= monthEnd,
  );

  const leaves = getLeaves().filter(
    (l) => l.status === "approved" && l.from_date <= monthEnd && l.to_date >= monthStart,
  );

  const advances = getAdvances().filter((a) => a.status === "approved" && !a.deducted);

  const overlapDays = (from: string, to: string) => {
    const a = new Date(Math.max(new Date(from).getTime(), new Date(monthStart).getTime()));
    const b = new Date(Math.min(new Date(to).getTime(), new Date(monthEnd).getTime()));
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  };

  const existing = getSalaries();

  const records: SalaryRecord[] = emps.map((e) => {
    const myAtt = att.filter((r) => r.employee_id === e.id);
    // Deduplicate by date so a single day is never counted multiple times
    const dateMap = new Map<string, (typeof att)[0]>();
    for (const r of myAtt) {
      const d = normalizeDate(r.date);
      const prev = dateMap.get(d);
      if (!prev || r.status === "present" || r.status === "late") {
        dateMap.set(d, r);
      }
    }
    const presentAtt = Array.from(dateMap.values()).filter(
      (r) => r.status === "present" || r.status === "late",
    );
    const present = presentAtt.length;

    const myLeaves = leaves.filter((l) => l.employee_id === e.id);
    let paid = 0,
      unpaid = 0;
    for (const l of myLeaves) {
      const d = overlapDays(l.from_date, l.to_date);
      if (l.type === "paid" || l.type === "sick") paid += d;
      else unpaid += d;
    }

    const myAdv = advances.filter((a) => a.employee_id === e.id);
    const advance_deducted = myAdv.reduce((s, a) => s + a.amount, 0);

    const per = e.monthly_salary > 0 ? e.monthly_salary / total : 0;

    // If a day has daily_salary_override set, use that fixed amount for that day
    // Otherwise use normal per-day rate
    const grossPresent = presentAtt.reduce((sum, r) => {
      return sum + (r.daily_salary_override != null ? r.daily_salary_override : per);
    }, 0);
    const gross = grossPresent + per * paid;
    const leave_deduction = per * unpaid;
    const exRow = existing.find((s) => s.employee_id === e.id && s.month === month);
    const bonus = exRow?.bonus ?? 0;
    const penalty = exRow?.penalty ?? 0;
    const final_salary = Math.max(0, gross - leave_deduction - advance_deducted + bonus - penalty);

    return {
      id: exRow?.id ?? newId(),
      employee_id: e.id,
      month,
      total_days: total,
      present_days: present,
      absent_days: Math.max(0, total - present - paid - unpaid),
      paid_leave_days: paid,
      unpaid_leave_days: unpaid,
      per_day: Number(per.toFixed(2)),
      gross: Number(gross.toFixed(2)),
      advance_deducted: Number(advance_deducted.toFixed(2)),
      leave_deduction: Number(leave_deduction.toFixed(2)),
      bonus,
      penalty,
      final_salary: Number(final_salary.toFixed(2)),
    };
  });

  // Mark advances as deducted
  const allAdv = getAdvances();
  let changed = false;
  for (const a of allAdv) {
    if (advances.some((d) => d.id === a.id)) {
      a.deducted = true;
      a.deducted_month = month;
      changed = true;
    }
  }
  if (changed) saveAdvances(allAdv);

  saveSalaries([...getSalaries().filter((s) => s.month !== month), ...records]);

  return records;
}
