// Client-side helpers: build rows from store data + fire-and-forget sync after mutations.
import { syncTabToSheet } from "./sheets-gateway.functions";
import {
  getEmployees,
  getAttendance,
  getSalaries,
  getLeaves,
  getAdvances,
  getTempos,
  getSettings,
} from "./store";

type Tab = "Employees" | "Attendance" | "Salary" | "Leaves" | "Advances" | "Tempos";

function nameMap() {
  return new Map(getEmployees().map((e) => [e.id, e.full_name]));
}

function rowsFor(tab: Tab): (string | number | boolean | null)[][] {
  switch (tab) {
    case "Employees":
      return getEmployees().map((e) => [
        e.id,
        e.full_name,
        e.role,
        e.monthly_salary,
        e.joining_date,
        e.mobile,
        e.active ? "Yes" : "No",
        (e.credential_ids?.length ?? 0) > 0 ? "Yes" : "No",
        e.face_descriptor ? "Yes" : "No",
      ]);
    case "Attendance": {
      const nm = nameMap();
      return getAttendance().map((r) => [
        r.id,
        r.employee_id,
        nm.get(r.employee_id) ?? "",
        r.date,
        r.shift,
        r.status,
        r.in_time ?? "",
        r.out_time ?? "",
        r.method ?? "manual",
      ]);
    }
    case "Salary": {
      const nm = nameMap();
      return getSalaries().map((r) => [
        r.id,
        r.employee_id,
        nm.get(r.employee_id) ?? "",
        r.month,
        r.total_days,
        r.present_days,
        r.absent_days,
        r.paid_leave_days,
        r.unpaid_leave_days,
        r.per_day,
        r.gross,
        r.advance_deducted,
        r.leave_deduction,
        r.bonus,
        r.penalty,
        r.final_salary,
      ]);
    }
    case "Leaves": {
      const nm = nameMap();
      return getLeaves().map((l) => [
        l.id,
        l.employee_id,
        nm.get(l.employee_id) ?? "",
        l.type,
        l.from_date,
        l.to_date,
        l.reason,
        l.status,
      ]);
    }
    case "Advances": {
      const nm = nameMap();
      return getAdvances().map((a) => [
        a.id,
        a.employee_id,
        nm.get(a.employee_id) ?? "",
        a.amount,
        a.reason,
        a.date,
        a.status,
        a.deducted ? "Yes" : "No",
      ]);
    }
    case "Tempos":
      return getTempos().map((t) => [t.id, t.vehicle_number, t.active ? "Yes" : "No"]);
  }
}

const queued = new Set<Tab>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function syncSoon(tab: Tab) {
  const s = getSettings();
  if (!s.spreadsheet_id || s.sheets_sync_enabled === false) return;
  queued.add(tab);
  // employees row affects names everywhere — also refresh dependents
  if (tab === "Employees")
    ["Attendance", "Salary", "Leaves", "Advances"].forEach((t) => queued.add(t as Tab));
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 800);
}

async function flush() {
  const s = getSettings();
  const sid = s.spreadsheet_id;
  if (!sid) {
    queued.clear();
    return;
  }
  const tabs = Array.from(queued);
  queued.clear();
  timer = null;
  for (const tab of tabs) {
    try {
      const res = await syncTabToSheet({ data: { spreadsheetId: sid, tab, rows: rowsFor(tab) } });
      if (res && "skipped" in res && res.skipped) {
        // Sheets API not configured on backend, stop further attempts in this batch
        break;
      }
    } catch (e) {
      console.warn("[sheets-sync]", tab, e);
    }
  }
  // update last_synced
  const { updateSettings } = await import("./store");
  updateSettings({ last_synced: new Date().toISOString() });
}

export async function syncAll() {
  const s = getSettings();
  if (!s.spreadsheet_id) throw new Error("Spreadsheet ID set nahi hai.");
  const tabs: Tab[] = ["Employees", "Attendance", "Salary", "Leaves", "Advances", "Tempos"];
  for (const tab of tabs) {
    await syncTabToSheet({ data: { spreadsheetId: s.spreadsheet_id, tab, rows: rowsFor(tab) } });
  }
  const { updateSettings } = await import("./store");
  updateSettings({ last_synced: new Date().toISOString() });
}
