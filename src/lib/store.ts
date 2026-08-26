// Cloud-backed store: sync-read API on top of an in-memory cache that
// is hydrated from Supabase on load, updated by Realtime, and pushed
// back on every write. localStorage is only used as an offline snapshot
// so the UI does not go blank between hydrations.

import { sb, getDeviceId } from "./supabase-browser";
import { useSyncExternalStore } from "react";

// ---------- types ----------

export type Role =
  | "Delivery Man"
  | "Loader"
  | "Tempo"
  | "Unloader"
  | "Stockkeeper"
  | "Party Packer"
  | "Supervisor"
  | "Office Staff";

export const ALL_ROLES: Role[] = [
  "Delivery Man",
  "Loader",
  "Tempo",
  "Unloader",
  "Stockkeeper",
  "Party Packer",
  "Supervisor",
  "Office Staff",
];

export type Employee = {
  id: string;
  full_name: string;
  role: Role;
  extra_roles?: Role[];
  monthly_salary: number;
  joining_date: string;
  mobile: string;
  active: boolean;
  biometric_enrolled: boolean;
  biometric_credential_id?: string;
  credential_ids?: string[];
  face_descriptor?: number[];
};

export type AttendanceRecord = {
  id: string;
  employee_id: string;
  date: string;
  shift: "morning" | "evening";
  status: "present" | "absent" | "late";
  in_time?: string;
  out_time?: string;
  location_ok?: boolean;
  method?: "manual" | "fingerprint" | "face" | "auto-sunday" | "auto-absent";
  /** Kisne mark kiya: admin panel se, worker ne khud scan karke, ya auto rule ne */
  marked_by?: "admin" | "worker" | "auto";
  device_id?: string;
  latitude?: number;
  longitude?: number;
  accuracy_meters?: number;
  daily_salary_override?: number;
};

export type Leave = {
  id: string;
  employee_id: string;
  type: "casual" | "sick" | "paid" | "unpaid";
  from_date: string;
  to_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
};

export type Advance = {
  id: string;
  employee_id: string;
  amount: number;
  reason: string;
  date: string;
  status: "pending" | "approved" | "rejected";
  deducted: boolean;
  deducted_month?: string;
};

export type SalaryRecord = {
  id: string;
  employee_id: string;
  month: string;
  total_days: number;
  present_days: number;
  absent_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  per_day: number;
  gross: number;
  advance_deducted: number;
  leave_deduction: number;
  bonus: number;
  penalty: number;
  final_salary: number;
};

export type Tempo = { id: string; vehicle_number: string; active: boolean };

export type AttendanceSchedule = {
  morning_start: string;
  morning_end: string;
  evening_start: string;
  evening_end: string;
  enforce: boolean;
};

export type AppSettings = {
  admin_secret: string;
  office_location?: { lat: number; lng: number; radius_meters: number; label: string };
  sheets_url?: string;
  google_access_token?: string;
  google_refresh_token?: string;
  google_token_expiry?: number;
  spreadsheet_id?: string;
  last_synced?: string;
  attendance_schedule?: AttendanceSchedule;
  sheets_sync_enabled?: boolean;
  evening_enabled?: boolean;
};

// ---------- cache + subscribers ----------

const isBrowser = typeof window !== "undefined";

type Cache = {
  employees: Employee[];
  attendance: AttendanceRecord[];
  leaves: Leave[];
  advances: Advance[];
  salaries: SalaryRecord[];
  tempos: Tempo[];
  settings: AppSettings;
};

const DEFAULT_SETTINGS: AppSettings = { admin_secret: "MANOJ" };

const cache: Cache = {
  employees: loadLocal("tsa_employees", []),
  attendance: loadLocal("tsa_attendance", []),
  leaves: loadLocal("tsa_leaves", []),
  advances: loadLocal("tsa_advances", []),
  salaries: loadLocal("tsa_salaries", []),
  tempos: loadLocal("tsa_tempos", []),
  settings: loadLocal("tsa_settings", DEFAULT_SETTINGS),
};

function loadLocal<T>(k: string, fb: T): T {
  if (!isBrowser) return fb;
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}
function saveLocal<T>(k: string, v: T) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore quota */
  }
}

let version = 0;
const listeners = new Set<() => void>();
function bump() {
  version++;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

// React hook — subscribes to cache changes so components re-render
// when local writes or realtime events arrive.
export function useCloudSync(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

// ---------- mappers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function dbToEmployee(r: Row): Employee {
  const rolesArr = Array.isArray(r.roles) ? (r.roles as string[]) : [];
  const primary = (rolesArr[0] as Role) || "Loader";
  const extras = (Array.isArray(r.extra_roles) ? r.extra_roles : rolesArr.slice(1)) as Role[];
  const credIds = (Array.isArray(r.credential_ids) ? r.credential_ids : []) as string[];
  return {
    id: r.id,
    full_name: r.full_name,
    role: primary,
    extra_roles: extras.length ? extras : undefined,
    monthly_salary: Number(r.monthly_salary ?? 0),
    joining_date: r.joining_date,
    mobile: r.mobile_number ?? "",
    active: !!r.active,
    biometric_enrolled: !!r.biometric_enrolled || credIds.length > 0,
    biometric_credential_id: credIds[0],
    credential_ids: credIds.length ? credIds : undefined,
    face_descriptor: Array.isArray(r.face_descriptor) ? (r.face_descriptor as number[]) : undefined,
  };
}
function employeeToDb(e: Employee): Row {
  const rolesArr = [e.role, ...(e.extra_roles ?? [])];
  return {
    id: e.id,
    employee_code: e.id.slice(0, 8).toUpperCase(),
    full_name: e.full_name,
    mobile_number: e.mobile || null,
    joining_date: e.joining_date,
    roles: rolesArr,
    extra_roles: e.extra_roles ?? [],
    monthly_salary: e.monthly_salary,
    active: e.active,
    biometric_enrolled: !!e.biometric_enrolled,
    credential_ids:
      e.credential_ids ?? (e.biometric_credential_id ? [e.biometric_credential_id] : []),
    face_descriptor: e.face_descriptor ?? null,
  };
}

function dbToAttendance(r: Row): AttendanceRecord {
  return {
    id: r.id,
    employee_id: r.employee_id,
    date: r.attendance_date,
    shift: r.shift,
    status: r.status,
    in_time: r.in_time ?? undefined,
    out_time: r.out_time ?? undefined,
    location_ok: r.location_ok ?? undefined,
    method: (r.method as AttendanceRecord["method"]) ?? undefined,
    marked_by: (r.marked_by as AttendanceRecord["marked_by"]) ?? undefined,
    device_id: r.device_id ?? undefined,
    latitude: r.latitude ?? undefined,
    longitude: r.longitude ?? undefined,
    accuracy_meters: r.accuracy_meters ?? undefined,
    daily_salary_override:
      r.daily_salary_override != null ? Number(r.daily_salary_override) : undefined,
  };
}
function attendanceToDb(a: AttendanceRecord): Row {
  return {
    id: a.id,
    employee_id: a.employee_id,
    attendance_date: a.date,
    shift: a.shift,
    status: a.status,
    in_time: a.in_time ?? null,
    out_time: a.out_time ?? null,
    location_ok: a.location_ok ?? null,
    method: a.method ?? "manual",
    marked_by:
      a.marked_by ??
      (a.method === "face" || a.method === "fingerprint"
        ? "worker"
        : a.method === "auto-sunday" || a.method === "auto-absent"
          ? "auto"
          : "admin"),
    device_id: a.device_id ?? getDeviceId(),
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    accuracy_meters: a.accuracy_meters ?? null,
    daily_salary_override: a.daily_salary_override ?? null,
  };
}

function dbToLeave(r: Row): Leave {
  return {
    id: r.id,
    employee_id: r.employee_id,
    type: r.leave_type,
    from_date: r.from_date,
    to_date: r.to_date,
    reason: r.reason ?? "",
    status: r.status,
  };
}
function leaveToDb(l: Leave): Row {
  return {
    id: l.id,
    employee_id: l.employee_id,
    leave_type: l.type,
    from_date: l.from_date,
    to_date: l.to_date,
    reason: l.reason,
    status: l.status,
  };
}

function dbToAdvance(r: Row): Advance {
  return {
    id: r.id,
    employee_id: r.employee_id,
    amount: Number(r.amount),
    reason: r.reason ?? "",
    date: r.taken_on,
    status: r.status,
    deducted: !!r.deducted,
    deducted_month: r.deducted_in_month ?? undefined,
  };
}
function advanceToDb(a: Advance): Row {
  return {
    id: a.id,
    employee_id: a.employee_id,
    amount: a.amount,
    reason: a.reason,
    taken_on: a.date,
    status: a.status,
    deducted: a.deducted,
    deducted_in_month: a.deducted_month ?? null,
  };
}

function dbToSalary(r: Row): SalaryRecord {
  return {
    id: r.id,
    employee_id: r.employee_id,
    month: r.month,
    total_days: Number(r.total_days),
    present_days: Number(r.present_days),
    absent_days: Number(r.absent_days),
    paid_leave_days: Number(r.paid_leave_days),
    unpaid_leave_days: Number(r.unpaid_leave_days),
    per_day: Number(r.per_day),
    gross: Number(r.gross),
    advance_deducted: Number(r.advance_deducted),
    leave_deduction: Number(r.leave_deduction),
    bonus: Number(r.bonus),
    penalty: Number(r.penalty),
    final_salary: Number(r.final_salary),
  };
}
function salaryToDb(s: SalaryRecord): Row {
  return { ...s };
}

function dbToTempo(r: Row): Tempo {
  return { id: r.id, vehicle_number: r.vehicle_number, active: !!r.active };
}
function tempoToDb(t: Tempo): Row {
  return { id: t.id, vehicle_number: t.vehicle_number, active: t.active };
}

// ---------- hydration + realtime ----------

export type SyncState = {
  status: "connected" | "syncing" | "offline" | "error";
  lastSyncedAt: string | null;
  pendingCount: number;
  errorMessage?: string;
};

let syncState: SyncState = {
  status: "syncing",
  lastSyncedAt: null,
  pendingCount: 0,
};

export function getSyncStatus(): SyncState {
  return { ...syncState, pendingCount: loadPending().length };
}

function updateSyncState(patch: Partial<SyncState>) {
  syncState = { ...syncState, ...patch };
  bump();
}

let isHydrating = false;
async function hydrate(): Promise<boolean> {
  if (!isBrowser || !sb || isHydrating) return false;
  isHydrating = true;
  updateSyncState({ status: "syncing" });

  try {
    const [emp, att, lv, adv, sal, tmp, st] = await Promise.all([
      sb.from("employees").select("*").order("created_at", { ascending: false }),
      sb.from("attendance").select("*").order("attendance_date", { ascending: false }).limit(10000),
      sb.from("leaves").select("*").order("created_at", { ascending: false }),
      sb.from("advances").select("*").order("created_at", { ascending: false }),
      sb.from("salaries").select("*").order("generated_at", { ascending: false }),
      sb.from("tempos").select("*").order("created_at", { ascending: false }),
      sb.from("settings").select("*").eq("key", "app_settings").maybeSingle(),
    ]);

    if (emp.data) cache.employees = emp.data.map(dbToEmployee);

    // Collect all local records (current cache, local storage, backup storage)
    const localSources: AttendanceRecord[] = [
      ...cache.attendance,
      ...loadLocal<AttendanceRecord[]>("tsa_attendance", []),
      ...loadLocal<AttendanceRecord[]>("tsa_attendance_backup", []),
    ];

    const attMap = new Map<string, AttendanceRecord>();
    const cloudKeys = new Set<string>();

    if (att.data) {
      const cloudList = att.data.map(dbToAttendance);
      for (const c of cloudList) {
        const normDate = normalizeDate(c.date);
        const key = `${c.employee_id}_${normDate}_${c.shift || "morning"}`;
        cloudKeys.add(key);
        const existing = attMap.get(key);
        if (!existing) {
          attMap.set(key, { ...c, date: normDate });
        } else {
          if (c.status === "present" || c.in_time) {
            attMap.set(key, { ...c, date: normDate });
          }
        }
      }
    }

    // Merge all local records so no locally marked attendance (e.g. 01/08/2026 - 06/08/2026) is ever lost
    const missingCloudRowsMap = new Map<string, Row>();
    for (const loc of localSources) {
      if (!loc || !loc.employee_id || !loc.date) continue;
      const normDate = normalizeDate(loc.date);
      const shift = loc.shift || "morning";
      const key = `${loc.employee_id}_${normDate}_${shift}`;
      const normalizedLoc: AttendanceRecord = { ...loc, date: normDate, shift };

      const existingInCloud = attMap.get(key);
      if (!existingInCloud) {
        attMap.set(key, normalizedLoc);
        missingCloudRowsMap.set(key, attendanceToDb(normalizedLoc));
      } else {
        // If local has presence or in_time but cloud has absent/none, preserve local and sync
        if (
          (normalizedLoc.status === "present" || normalizedLoc.in_time) &&
          existingInCloud.status !== "present"
        ) {
          const merged = { ...existingInCloud, ...normalizedLoc, id: existingInCloud.id };
          attMap.set(key, merged);
          missingCloudRowsMap.set(key, attendanceToDb(merged));
        }
      }
    }

    const missingCloudRowsToUpload = Array.from(missingCloudRowsMap.values());

    // Merge pending offline queue
    const pendingRows = loadPending();
    for (const p of pendingRows) {
      const normDate = normalizeDate(p.attendance_date);
      const shift = p.shift || "morning";
      const key = `${p.employee_id}_${normDate}_${shift}`;
      const pendingRecord = dbToAttendance({ ...p, attendance_date: normDate, shift });
      attMap.set(key, pendingRecord);
    }

    cache.attendance = Array.from(attMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    if (lv.data) cache.leaves = lv.data.map(dbToLeave);
    if (adv.data) cache.advances = adv.data.map(dbToAdvance);
    if (sal.data) cache.salaries = sal.data.map(dbToSalary);
    if (tmp.data) cache.tempos = tmp.data.map(dbToTempo);
    if (st.data?.value) cache.settings = { ...DEFAULT_SETTINGS, ...(st.data.value as AppSettings) };

    persistLocal();
    updateSyncState({
      status: "connected",
      lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      pendingCount: loadPending().length,
      errorMessage: undefined,
    });
    bump();

    ensureRealtimeSubscription();
    void flushPendingAttendance();

    // Auto-upload any recovered local attendance rows to Supabase
    if (missingCloudRowsToUpload.length > 0 && sb) {
      void pushAttendanceRowsBatch(missingCloudRowsToUpload);
    }

    return true;
  } catch (e) {
    console.error("[cloud-hydrate]", e);
    updateSyncState({
      status: "error",
      errorMessage: (e as Error).message || "Sync failed",
    });
    return false;
  } finally {
    isHydrating = false;
  }
}

function persistLocal() {
  saveLocal("tsa_employees", cache.employees);
  saveLocal("tsa_attendance", cache.attendance);
  saveLocal("tsa_attendance_backup", cache.attendance);
  saveLocal("tsa_leaves", cache.leaves);
  saveLocal("tsa_advances", cache.advances);
  saveLocal("tsa_salaries", cache.salaries);
  saveLocal("tsa_tempos", cache.tempos);
  saveLocal("tsa_settings", cache.settings);
}

let realtimeChannel: ReturnType<typeof sb.channel> | null = null;

function ensureRealtimeSubscription() {
  if (!sb || realtimeChannel) return;

  const applyUpsert = <T extends { id: string }>(arr: T[], next: T) => {
    const i = arr.findIndex((x) => x.id === next.id);
    if (i >= 0) arr[i] = next;
    else arr.unshift(next);
  };

  const applyDelete = <T extends { id: string }>(arr: T[], id: string) => {
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  };

  const applyAttendanceUpsert = (arr: AttendanceRecord[], next: AttendanceRecord) => {
    const normDate = normalizeDate(next.date);
    const item = { ...next, date: normDate };
    const i = arr.findIndex(
      (x) =>
        x.id === item.id ||
        (x.employee_id === item.employee_id &&
          normalizeDate(x.date) === normDate &&
          x.shift === item.shift),
    );
    if (i >= 0) arr[i] = item;
    else arr.unshift(item);
  };

  const applyAttendanceDelete = (arr: AttendanceRecord[], id: string) => {
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  };

  realtimeChannel = sb
    .channel("app-realtime-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, (p) => {
      if (p.eventType === "DELETE" && p.old) applyDelete(cache.employees, (p.old as Row).id);
      else if (p.new) applyUpsert(cache.employees, dbToEmployee(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (p) => {
      if (p.eventType === "DELETE" && p.old)
        applyAttendanceDelete(cache.attendance, (p.old as Row).id);
      else if (p.new) applyAttendanceUpsert(cache.attendance, dbToAttendance(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "leaves" }, (p) => {
      if (p.eventType === "DELETE" && p.old) applyDelete(cache.leaves, (p.old as Row).id);
      else if (p.new) applyUpsert(cache.leaves, dbToLeave(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "advances" }, (p) => {
      if (p.eventType === "DELETE" && p.old) applyDelete(cache.advances, (p.old as Row).id);
      else if (p.new) applyUpsert(cache.advances, dbToAdvance(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "salaries" }, (p) => {
      if (p.eventType === "DELETE" && p.old) applyDelete(cache.salaries, (p.old as Row).id);
      else if (p.new) applyUpsert(cache.salaries, dbToSalary(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "tempos" }, (p) => {
      if (p.eventType === "DELETE" && p.old) applyDelete(cache.tempos, (p.old as Row).id);
      else if (p.new) applyUpsert(cache.tempos, dbToTempo(p.new as Row));
      persistLocal();
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, (p) => {
      const row = (p.new ?? p.old) as Row | null;
      if (row && row.key === "app_settings" && p.new) {
        cache.settings = { ...DEFAULT_SETTINGS, ...((p.new as Row).value as AppSettings) };
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
      }
    });

  realtimeChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      updateSyncState({ status: "connected" });
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      updateSyncState({ status: "offline" });
      realtimeChannel = null;
      // Try to re-subscribe after delay
      setTimeout(ensureRealtimeSubscription, 3000);
    }
  });
}

// Kick off on module load (browser only).
if (isBrowser) {
  void hydrate();

  // Multi-device sync triggers: tab focus, visibility change, online event, and periodic polling
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void hydrate();
    }
  });
  window.addEventListener("focus", () => {
    void hydrate();
  });
  window.addEventListener("online", () => {
    updateSyncState({ status: "syncing" });
    void hydrate();
  });
  window.addEventListener("offline", () => {
    updateSyncState({ status: "offline" });
  });

  // Background auto-sync every 12 seconds to guarantee live parity across all phones/PCs
  setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      void hydrate();
    }
  }, 12000);
}

// Manual force sync (available to all components/pages)
export async function refreshCloud(): Promise<boolean> {
  return await hydrate();
}

export async function forceCloudSync(): Promise<{ success: boolean; lastSyncedAt: string | null }> {
  const ok = await hydrate();
  return { success: ok, lastSyncedAt: syncState.lastSyncedAt };
}

// ---------- write helpers (fire-and-forget with local optimistic update) ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warn(where: string, err: any) {
  console.error(`[cloud-write] ${where}`, err?.message ?? err);
}

// ---------- durable attendance writes ----------
// Attendance kabhi gayab na ho: har row (employee_id, attendance_date, shift)
// unique key par upsert hoti hai, aur fail hone par queue me rakh kar retry hoti hai.
const PENDING_KEY = "tsa_pending_attendance";
type PendingRow = Row;

function loadPending(): PendingRow[] {
  if (!isBrowser) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingRow[];
    return raw.map((r) => ({
      ...r,
      attendance_date: normalizeDate(r.attendance_date),
      shift: r.shift || "morning",
    }));
  } catch {
    return [];
  }
}
function savePending(rows: PendingRow[]) {
  saveLocal(PENDING_KEY, rows);
}
function queuePending(row: PendingRow) {
  const normDate = normalizeDate(row.attendance_date);
  const shift = row.shift || "morning";
  const rows = loadPending().filter(
    (r) =>
      !(
        r.employee_id === row.employee_id &&
        normalizeDate(r.attendance_date) === normDate &&
        (r.shift || "morning") === shift
      ),
  );
  rows.push({ ...row, attendance_date: normDate, shift });
  savePending(rows);
}
function dequeuePending(row: PendingRow) {
  const normDate = normalizeDate(row.attendance_date);
  const shift = row.shift || "morning";
  savePending(
    loadPending().filter(
      (r) =>
        !(
          r.employee_id === row.employee_id &&
          normalizeDate(r.attendance_date) === normDate &&
          (r.shift || "morning") === shift
        ),
    ),
  );
}

async function pushAttendanceRow(row: PendingRow): Promise<boolean> {
  if (!sb) return false;
  // id ko conflict target se hataayein — dusre device par bani row ka id alag ho sakta hai.
  const { id: _id, ...payload } = row;
  const { data, error } = await sb
    .from("attendance")
    .upsert(payload, { onConflict: "employee_id,attendance_date,shift" })
    .select()
    .maybeSingle();
  if (error) {
    warn("attendance.upsert", error);
    queuePending(row);
    return false;
  }
  dequeuePending(row);
  if (data) {
    const saved = dbToAttendance(data as Row);
    const list = [...cache.attendance];
    const i = list.findIndex(
      (r) =>
        r.employee_id === saved.employee_id &&
        normalizeDate(r.date) === normalizeDate(saved.date) &&
        r.shift === saved.shift,
    );
    if (i >= 0) list[i] = saved;
    else list.unshift(saved);
    cache.attendance = list;
    saveLocal("tsa_attendance", list);
    bump();
  }
  return true;
}

export async function pushAttendanceRowsBatch(
  rows: PendingRow[],
): Promise<{ success: boolean; count: number }> {
  if (!sb || rows.length === 0) return { success: false, count: 0 };

  // Strictly deduplicate by conflict key (employee_id + normalized attendance_date + shift)
  // to avoid PostgreSQL "ON CONFLICT DO UPDATE command cannot affect row a second time" error.
  const dedupMap = new Map<string, PendingRow>();
  for (const r of rows) {
    if (!r || !r.employee_id || !r.attendance_date) continue;
    const normDate = normalizeDate(r.attendance_date);
    const shift = r.shift || "morning";
    const key = `${r.employee_id}_${normDate}_${shift}`;
    const normalizedRow: PendingRow = { ...r, attendance_date: normDate, shift };

    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, normalizedRow);
    } else {
      if (normalizedRow.status === "present" || normalizedRow.in_time) {
        dedupMap.set(key, { ...existing, ...normalizedRow });
      }
    }
  }

  const dedupedRows = Array.from(dedupMap.values());
  if (dedupedRows.length === 0) return { success: true, count: 0 };

  const payloads = dedupedRows.map((r) => {
    const { id: _id, ...p } = r;
    return p;
  });

  let savedCount = 0;
  const chunkSize = 50;
  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize);
    const chunkRows = dedupedRows.slice(i, i + chunkSize);

    const { data, error } = await sb
      .from("attendance")
      .upsert(chunk, { onConflict: "employee_id,attendance_date,shift" })
      .select();

    if (error) {
      warn("attendance.batchUpsert", error);
      chunkRows.forEach(queuePending);
    } else {
      chunkRows.forEach(dequeuePending);
      if (data && Array.isArray(data)) {
        savedCount += data.length;
        const savedList = data.map((d) => dbToAttendance(d as Row));
        const list = [...cache.attendance];
        for (const saved of savedList) {
          const idx = list.findIndex(
            (r) =>
              r.employee_id === saved.employee_id &&
              normalizeDate(r.date) === normalizeDate(saved.date) &&
              r.shift === saved.shift,
          );
          if (idx >= 0) list[idx] = saved;
          else list.unshift(saved);
        }
        cache.attendance = list;
        saveLocal("tsa_attendance", list);
      }
    }
  }

  bump();
  fire("Attendance");
  return { success: savedCount > 0 || dedupedRows.length === 0, count: savedCount };
}

export async function flushPendingAttendance(): Promise<number> {
  if (!sb || !isBrowser) return 0;
  const rows = loadPending();
  if (rows.length === 0) return 0;
  const res = await pushAttendanceRowsBatch(rows);
  return res.count;
}

if (isBrowser) {
  window.addEventListener("online", () => void flushPendingAttendance());
  setInterval(() => void flushPendingAttendance(), 30000);
}

// ---------- employees ----------

export function getEmployees(): Employee[] {
  return cache.employees;
}
export function saveEmployees(list: Employee[]) {
  cache.employees = list;
  saveLocal("tsa_employees", list);
  bump();
  fire("Employees");
}
export function upsertEmployee(emp: Employee) {
  const list = [...cache.employees];
  const idx = list.findIndex((e) => e.id === emp.id);
  if (idx >= 0) list[idx] = emp;
  else list.unshift(emp);
  cache.employees = list;
  saveLocal("tsa_employees", list);
  bump();
  if (sb)
    sb.from("employees")
      .upsert(employeeToDb(emp))
      .then(({ error }) => error && warn("employee.upsert", error));
  fire("Employees");
}
export function deleteEmployee(id: string) {
  cache.employees = cache.employees.filter((e) => e.id !== id);
  // Also clean up local dependent records so they don't hold references
  cache.attendance = cache.attendance.filter((a) => a.employee_id !== id);
  cache.leaves = cache.leaves.filter((l) => l.employee_id !== id);
  cache.advances = cache.advances.filter((a) => a.employee_id !== id);
  cache.salaries = cache.salaries.filter((s) => s.employee_id !== id);

  saveLocal("tsa_employees", cache.employees);
  saveLocal("tsa_attendance", cache.attendance);
  saveLocal("tsa_leaves", cache.leaves);
  saveLocal("tsa_advances", cache.advances);
  saveLocal("tsa_salaries", cache.salaries);

  bump();
  if (sb) {
    // Delete in Supabase (foreign keys ON DELETE CASCADE will clean related tables)
    sb.from("employees")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          warn("employee.delete", error);
        }
      });
  }
  fire("Employees");
}

// ---------- attendance ----------

export function normalizeDate(d: string | number | Date | null | undefined): string {
  if (!d) return "";
  if (typeof d !== "string") {
    try {
      const dt = new Date(d);
      if (!isNaN(dt.getTime())) {
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      }
    } catch {
      return "";
    }
  }
  const trimmed = String(d).trim();
  if (!trimmed) return "";

  // If ISO string with T or space followed by time: extract leading date portion
  const firstPart = trimmed.split(/[T ]/)[0];

  // Match YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD (1 or 2 digit month/day)
  const ymd = firstPart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, "0");
    const day = ymd[3].padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (1 or 2 digit day/month)
  const dmy = firstPart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    const y = dmy[3];
    return `${y}-${m}-${day}`;
  }

  // Match DD/MM/YY or DD-MM-YY (2 digit year)
  const dmy2 = firstPart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (dmy2) {
    const day = dmy2[1].padStart(2, "0");
    const m = dmy2[2].padStart(2, "0");
    const yVal = Number(dmy2[3]);
    const y = yVal < 50 ? `20${dmy2[3]}` : `19${dmy2[3]}`;
    return `${y}-${m}-${day}`;
  }

  // Fallback: Try Date.parse
  try {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  } catch {
    /* fallback */
  }

  return trimmed;
}

export function getAttendance(): AttendanceRecord[] {
  return cache.attendance;
}
export function saveAttendance(list: AttendanceRecord[]) {
  cache.attendance = list.map((r) => ({ ...r, date: normalizeDate(r.date) }));
  saveLocal("tsa_attendance", cache.attendance);
  saveLocal("tsa_attendance_backup", cache.attendance);
  bump();
  fire("Attendance");
}

export function getAttendanceForMonth(month: string): AttendanceRecord[] {
  const normMonth = month.trim().slice(0, 7);
  return cache.attendance.filter((r) => normalizeDate(r.date).startsWith(normMonth));
}

let isAutoSundayRunning = false;

export function upsertAttendance(
  rec: AttendanceRecord,
  options?: { skipSundayCheck?: boolean },
): Promise<boolean> {
  rec = { ...rec, date: normalizeDate(rec.date) };
  const list = [...cache.attendance];
  const idx = list.findIndex(
    (r) =>
      r.employee_id === rec.employee_id &&
      normalizeDate(r.date) === rec.date &&
      r.shift === rec.shift,
  );
  if (idx >= 0) {
    rec = { ...list[idx], ...rec, id: list[idx].id };
    list[idx] = rec;
  } else list.unshift(rec);
  cache.attendance = list;
  saveLocal("tsa_attendance", list);
  bump();
  const row = attendanceToDb(rec);
  let pushPromise: Promise<boolean>;
  if (sb) {
    pushPromise = pushAttendanceRow(row);
  } else {
    queuePending(row);
    pushPromise = Promise.resolve(true);
  }

  fire("Attendance");

  // Automatic Sunday Rule trigger:
  // Jab bhi Monday ya Saturday ki attendance mark ya update hoti hai,
  // turant Sunday rule check karke Sunday ki attendance auto add / update ho jaye.
  if (!options?.skipSundayCheck && !isAutoSundayRunning && rec.shift === "morning" && isBrowser) {
    const dayOfWeek = new Date(rec.date + "T00:00:00Z").getUTCDay();
    if (dayOfWeek === 1 || dayOfWeek === 6) {
      isAutoSundayRunning = true;
      setTimeout(async () => {
        try {
          const autoAtt = await import("./auto-attendance");
          if (dayOfWeek === 1) {
            // Monday -> evaluate preceding Sunday
            const sunDate = new Date(new Date(rec.date + "T00:00:00Z").getTime() - 86400000)
              .toISOString()
              .slice(0, 10);
            autoAtt.applySundayRule(sunDate);
          } else if (dayOfWeek === 6) {
            // Saturday -> evaluate next Sunday (if Monday is present)
            const sunDate = new Date(new Date(rec.date + "T00:00:00Z").getTime() + 86400000)
              .toISOString()
              .slice(0, 10);
            autoAtt.applySundayRule(sunDate);
          }
        } catch {
          /* ignore */
        } finally {
          isAutoSundayRunning = false;
        }
      }, 50);
    }
  }

  return pushPromise;
}

export function upsertBulkAttendance(
  records: AttendanceRecord[],
  options?: { skipSundayCheck?: boolean },
): Promise<{ success: boolean; count: number }> {
  if (!records.length) return Promise.resolve({ success: true, count: 0 });

  const normalized = records.map((rec) => ({
    ...rec,
    date: normalizeDate(rec.date),
    method: rec.method ?? "manual",
    marked_by: rec.marked_by ?? "admin",
  }));

  const list = [...cache.attendance];
  const dbRows: PendingRow[] = [];

  for (let rec of normalized) {
    const idx = list.findIndex(
      (r) =>
        r.employee_id === rec.employee_id &&
        normalizeDate(r.date) === rec.date &&
        r.shift === rec.shift,
    );
    if (idx >= 0) {
      rec = { ...list[idx], ...rec, id: list[idx].id };
      list[idx] = rec;
    } else {
      list.unshift(rec);
    }
    dbRows.push(attendanceToDb(rec));
  }

  cache.attendance = list;
  saveLocal("tsa_attendance", list);
  bump();
  fire("Attendance");

  let pushPromise: Promise<{ success: boolean; count: number }>;
  if (sb) {
    pushPromise = pushAttendanceRowsBatch(dbRows);
  } else {
    dbRows.forEach(queuePending);
    pushPromise = Promise.resolve({ success: true, count: records.length });
  }

  // Automatic Sunday Rule trigger for batch
  if (!options?.skipSundayCheck && !isAutoSundayRunning && isBrowser) {
    const hasMonOrSat = normalized.some((r) => {
      const day = new Date(r.date + "T00:00:00Z").getUTCDay();
      return (day === 1 || day === 6) && r.shift === "morning";
    });
    if (hasMonOrSat) {
      isAutoSundayRunning = true;
      setTimeout(async () => {
        try {
          const autoAtt = await import("./auto-attendance");
          autoAtt.applyRecentSundayRules();
        } catch {
          /* ignore */
        } finally {
          isAutoSundayRunning = false;
        }
      }, 100);
    }
  }

  return pushPromise;
}
export function getAttendanceForDate(date: string): AttendanceRecord[] {
  const norm = normalizeDate(date);
  return cache.attendance.filter((r) => normalizeDate(r.date) === norm);
}

// ---------- leaves ----------

export function getLeaves(): Leave[] {
  return cache.leaves;
}
export function saveLeaves(list: Leave[]) {
  cache.leaves = list;
  saveLocal("tsa_leaves", list);
  bump();
  fire("Leaves");
}
export function upsertLeave(l: Leave) {
  const list = [...cache.leaves];
  const i = list.findIndex((r) => r.id === l.id);
  if (i >= 0) list[i] = l;
  else list.unshift(l);
  cache.leaves = list;
  saveLocal("tsa_leaves", list);
  bump();
  if (sb)
    sb.from("leaves")
      .upsert(leaveToDb(l))
      .then(({ error }) => error && warn("leave.upsert", error));
  fire("Leaves");
}

// ---------- advances ----------

export function getAdvances(): Advance[] {
  return cache.advances;
}
export function saveAdvances(list: Advance[]) {
  cache.advances = list;
  saveLocal("tsa_advances", list);
  bump();
  fire("Advances");
}
export function upsertAdvance(a: Advance) {
  const list = [...cache.advances];
  const i = list.findIndex((r) => r.id === a.id);
  if (i >= 0) list[i] = a;
  else list.unshift(a);
  cache.advances = list;
  saveLocal("tsa_advances", list);
  bump();
  if (sb)
    sb.from("advances")
      .upsert(advanceToDb(a))
      .then(({ error }) => error && warn("advance.upsert", error));
  fire("Advances");
}

// ---------- salaries ----------

export function getSalaries(): SalaryRecord[] {
  return cache.salaries;
}
export function saveSalaries(list: SalaryRecord[]) {
  cache.salaries = list;
  saveLocal("tsa_salaries", list);
  bump();
  fire("Salary");
}
export function upsertSalary(s: SalaryRecord) {
  const list = [...cache.salaries];
  const i = list.findIndex((r) => r.id === s.id);
  if (i >= 0) list[i] = s;
  else list.unshift(s);
  cache.salaries = list;
  saveLocal("tsa_salaries", list);
  bump();
  if (sb)
    sb.from("salaries")
      .upsert(salaryToDb(s))
      .then(({ error }) => error && warn("salary.upsert", error));
  fire("Salary");
}

// ---------- tempos ----------

export function getTempos(): Tempo[] {
  return cache.tempos;
}
export function saveTempos(list: Tempo[]) {
  cache.tempos = list;
  saveLocal("tsa_tempos", list);
  bump();
  fire("Tempos");
}
export function upsertTempo(t: Tempo) {
  const list = [...cache.tempos];
  const i = list.findIndex((r) => r.id === t.id);
  if (i >= 0) list[i] = t;
  else list.unshift(t);
  cache.tempos = list;
  saveLocal("tsa_tempos", list);
  bump();
  if (sb)
    sb.from("tempos")
      .upsert(tempoToDb(t))
      .then(({ error }) => error && warn("tempo.upsert", error));
  fire("Tempos");
}

// ---------- settings ----------

export function getSettings(): AppSettings {
  return cache.settings;
}
export function saveSettings(s: AppSettings) {
  cache.settings = s;
  saveLocal("tsa_settings", s);
  bump();
  if (sb)
    sb.from("settings")
      .upsert({ key: "app_settings", value: s })
      .then(({ error }) => error && warn("settings.upsert", error));
}
export function updateSettings(patch: Partial<AppSettings>) {
  saveSettings({ ...cache.settings, ...patch });
}

// ---------- admin session (still local — this is per-device auth token) ----------

const ADMIN_SESSION_KEY = "tsa_admin_session";
// Session-scoped: app band karke dobara kholne par password fir se daalna padega.
export function isAdminLoggedIn(): boolean {
  if (!isBrowser) return false;
  try {
    // Purane persistent sessions saaf kar do
    localStorage.removeItem(ADMIN_SESSION_KEY);
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    const { expiry } = JSON.parse(raw);
    if (!expiry || Date.now() > expiry) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function setAdminLoggedIn(v: boolean) {
  if (!isBrowser) return;
  if (v) {
    // 12 ghante ki working session, tab band hote hi khatam
    const expiry = Date.now() + 12 * 60 * 60 * 1000;
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ expiry }));
  } else {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

// ---------- util ----------

export function newId(): string {
  return crypto.randomUUID();
}
export function todayString(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export function todayDDMM_IST(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}`;
}

// ---------- sheets sync hook (unchanged) ----------

function fire(tab: "Employees" | "Attendance" | "Salary" | "Leaves" | "Advances" | "Tempos") {
  if (!isBrowser) return;
  import("./sync").then((m) => m.syncSoon(tab)).catch(() => {});
}

// Re-export device id so callers can attach it to attendance rows.
export { getDeviceId } from "./supabase-browser";
