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
  employee_code?: string;
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
  admin_password?: string;
  admin_face_descriptor?: number[];
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

const DEFAULT_SETTINGS: AppSettings = {
  admin_secret: "MANOJ",
  admin_password: "MANOJ",
};

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

export type SyncState = {
  status: "connected" | "syncing" | "offline" | "error";
  lastSyncedAt: string | null;
  pendingCount: number;
  errorMessage?: string;
};

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

let currentSyncSnapshot: SyncState = {
  status: "syncing",
  lastSyncedAt: null,
  pendingCount: 0,
};

export function getSyncStatus(): SyncState {
  return currentSyncSnapshot;
}

let dataVersion = 0;
const dataListeners = new Set<() => void>();
let isBumpingData = false;
let hasPendingDataBump = false;

function bumpData() {
  dataVersion++;
  if (isBumpingData) {
    hasPendingDataBump = true;
    return;
  }
  isBumpingData = true;
  try {
    const listeners = Array.from(dataListeners);
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  } finally {
    isBumpingData = false;
    if (hasPendingDataBump) {
      hasPendingDataBump = false;
      bumpData();
    }
  }
}

// Backward-compatible alias
const bump = bumpData;

let syncStatusVersion = 0;
const syncStatusListeners = new Set<() => void>();
let isBumpingSync = false;
let hasPendingSyncBump = false;

function bumpSyncStatus() {
  syncStatusVersion++;
  if (isBumpingSync) {
    hasPendingSyncBump = true;
    return;
  }
  isBumpingSync = true;
  try {
    const listeners = Array.from(syncStatusListeners);
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  } finally {
    isBumpingSync = false;
    if (hasPendingSyncBump) {
      hasPendingSyncBump = false;
      bumpSyncStatus();
    }
  }
}

function updateSyncState(patch: Partial<SyncState>) {
  const pending = loadPending().length;
  const next: SyncState = {
    ...currentSyncSnapshot,
    ...patch,
    pendingCount: pending,
  };
  if (
    currentSyncSnapshot.status === next.status &&
    currentSyncSnapshot.lastSyncedAt === next.lastSyncedAt &&
    currentSyncSnapshot.pendingCount === next.pendingCount &&
    currentSyncSnapshot.errorMessage === next.errorMessage
  ) {
    return;
  }
  currentSyncSnapshot = next;
  bumpSyncStatus();
}

// React hook — subscribes to data cache changes so components re-render
// ONLY when actual local writes or Supabase realtime events arrive.
export function useCloudSync(): number {
  return useSyncExternalStore(
    (l) => {
      dataListeners.add(l);
      return () => dataListeners.delete(l);
    },
    () => dataVersion,
    () => 0,
  );
}

// React hook — subscribes ONLY to sync badge / connection status changes
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(
    (l) => {
      syncStatusListeners.add(l);
      return () => syncStatusListeners.delete(l);
    },
    () => currentSyncSnapshot,
    () => currentSyncSnapshot,
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
    employee_code: r.employee_code || undefined,
    full_name: r.full_name,
    role: primary,
    extra_roles: extras.length ? extras : undefined,
    monthly_salary: Number(r.monthly_salary ?? 0),
    joining_date: r.joining_date,
    mobile: r.mobile_number ?? "",
    active: r.active !== false,
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
    employee_code: e.employee_code || e.id.slice(0, 8).toUpperCase(),
    full_name: e.full_name,
    mobile_number: e.mobile || null,
    joining_date: e.joining_date,
    roles: rolesArr,
    extra_roles: e.extra_roles ?? [],
    monthly_salary: e.monthly_salary,
    active: e.active !== false,
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
    date: normalizeDate(r.attendance_date || r.date || ""),
    shift: r.shift || "morning",
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
  const isAbsent = a.status === "absent";
  return {
    id: a.id,
    employee_id: a.employee_id,
    attendance_date: normalizeDate(a.date),
    shift: a.shift || "morning",
    status: a.status,
    in_time: isAbsent ? null : (a.in_time ?? null),
    out_time: isAbsent ? null : (a.out_time ?? null),
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

let isHydrating = false;
let lastHydrateTimestamp = 0;
let initialHydratePromise: Promise<boolean> | null = null;

/** Full hydrate me itne din ki attendance load hoti hai (baaki on-demand). */
const ATTENDANCE_WINDOW_DAYS = 180;
/** Delta sync cursor — is timestamp ke baad change hui rows hi laayi jaati hain. */
let deltaCursor: string | null = null;
let isDeltaSyncing = false;

/**
 * Robust paginated fetcher to overcome Supabase PostgREST default 1000-row limit.
 * Iterates in batches of 1000 using .range() until all records are retrieved.
 */
async function fetchAllRowsWithPagination(
  table: string,
  orderBy: string,
  ascending = false,
  maxPages = 50,
  filter?: { column: string; gte: string },
): Promise<{ data: Row[] | null; error: unknown }> {
  if (!sb) return { data: null, error: new Error("No Supabase client") };
  const PAGE_SIZE = 1000;
  let from = 0;
  let all: Row[] = [];
  try {
    for (let page = 0; page < maxPages; page++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (sb as any)
        .from(table)
        .select("*")
        .order(orderBy, { ascending })
        .range(from, from + PAGE_SIZE - 1);
      if (filter) q = q.gte(filter.column, filter.gte);

      const { data, error } = await q;

      if (error) {
        return { data: all.length > 0 ? all : null, error };
      }
      if (!data || data.length === 0) break;
      all = all.concat(data as Row[]);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return { data: all, error: null };
  } catch (err) {
    return { data: all.length > 0 ? all : null, error: err };
  }
}

/**
 * Dedicated month-based attendance fetcher to guarantee 100% complete data
 * for any viewed month in Reports / Salary.
 */
export async function fetchAttendanceForMonth(monthKey: string): Promise<boolean> {
  if (!sb || !isBrowser) return false;
  try {
    const normMonth = monthKey.trim().slice(0, 7);
    const startDate = `${normMonth}-01`;
    const endDate = `${normMonth}-31`;
    const { data, error } = await sb
      .from("attendance")
      .select("*")
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)
      .order("attendance_date", { ascending: true });

    if (error) {
      warn("fetchAttendanceForMonth", error);
      return false;
    }
    if (data && data.length > 0) {
      const cloudList = data.map(dbToAttendance);
      const attMap = new Map<string, AttendanceRecord>();
      // 1. Keep all existing local cache records
      for (const localRec of cache.attendance) {
        if (!localRec || !localRec.employee_id || !localRec.date) continue;
        const normDate = normalizeDate(localRec.date);
        const shift = localRec.shift || "morning";
        const key = `${localRec.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...localRec, date: normDate, shift });
      }
      // 2. Overlay fresh month cloud records
      for (const c of cloudList) {
        const normDate = normalizeDate(c.date);
        const shift = c.shift || "morning";
        const key = `${c.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...c, date: normDate, shift });
      }
      cache.attendance = Array.from(attMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      persistLocal();
      bumpData();
    }
    return true;
  } catch (err) {
    console.error("[fetchAttendanceForMonth]", err);
    return false;
  }
}

/**
 * Dedicated year-based attendance fetcher to guarantee 100% complete data
 * for any viewed year in 1-Year Attendance Report.
 */
export async function fetchAttendanceForYear(yearStr: string): Promise<boolean> {
  if (!sb || !isBrowser) return false;
  try {
    const y = yearStr.trim().slice(0, 4);
    const startDate = `${y}-01-01`;
    const endDate = `${y}-12-31`;
    const { data, error } = await sb
      .from("attendance")
      .select("*")
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)
      .order("attendance_date", { ascending: true });

    if (error) {
      warn("fetchAttendanceForYear", error);
      return false;
    }
    if (data && data.length > 0) {
      const cloudList = data.map(dbToAttendance);
      const attMap = new Map<string, AttendanceRecord>();
      for (const localRec of cache.attendance) {
        if (!localRec || !localRec.employee_id || !localRec.date) continue;
        const normDate = normalizeDate(localRec.date);
        const shift = localRec.shift || "morning";
        const key = `${localRec.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...localRec, date: normDate, shift });
      }
      for (const c of cloudList) {
        const normDate = normalizeDate(c.date);
        const shift = c.shift || "morning";
        const key = `${c.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...c, date: normDate, shift });
      }
      cache.attendance = Array.from(attMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      persistLocal();
      bumpData();
    }
    return true;
  } catch (err) {
    console.error("[fetchAttendanceForYear]", err);
    return false;
  }
}

export async function hydrate(force = false): Promise<boolean> {
  if (!isBrowser || !sb) return false;
  if (isHydrating) return false;

  const now = Date.now();
  // Throttle only if not forced and less than 3 seconds have passed
  if (!force && now - lastHydrateTimestamp < 3000) {
    return true;
  }

  isHydrating = true;
  updateSyncState({ status: "syncing" });

  try {
    // Sirf recent window (default 180 din) full-load hoti hai — app fast rehti hai.
    // Purane mahine/saal Reports & Salary page on-demand fetch karte hain.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ATTENDANCE_WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const [emp, att, lv, adv, sal, tmp, st] = await Promise.all([
      sb.from("employees").select("*").order("created_at", { ascending: false }),
      fetchAllRowsWithPagination("attendance", "attendance_date", false, 50, {
        column: "attendance_date",
        gte: cutoffStr,
      }),
      sb.from("leaves").select("*").order("created_at", { ascending: false }),
      sb.from("advances").select("*").order("created_at", { ascending: false }),
      sb.from("salaries").select("*").order("generated_at", { ascending: false }),
      sb.from("tempos").select("*").order("created_at", { ascending: false }),
      sb.from("settings").select("*").eq("key", "app_settings").maybeSingle(),
    ]);

    if (emp.error) {
      warn("employees.hydrate", emp.error);
    } else if (emp.data) {
      cache.employees = emp.data.map(dbToEmployee);
    }

    if (att.error && (!att.data || att.data.length === 0)) {
      warn("attendance.hydrate", att.error);
    } else if (att.data) {
      const attMap = new Map<string, AttendanceRecord>();

      // 1. First keep all current in-memory / local cached attendance
      for (const localRec of cache.attendance) {
        if (!localRec || !localRec.employee_id || !localRec.date) continue;
        const normDate = normalizeDate(localRec.date);
        const shift = localRec.shift || "morning";
        const key = `${localRec.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...localRec, date: normDate, shift });
      }

      // 2. Cloud data overlays authoritative records
      const cloudList = att.data.map(dbToAttendance);
      for (const c of cloudList) {
        const normDate = normalizeDate(c.date);
        const shift = c.shift || "morning";
        const key = `${c.employee_id}_${normDate}_${shift}`;
        attMap.set(key, { ...c, date: normDate, shift });
      }

      // 3. Pending un-synced offline writes overlay on top with highest priority
      const pendingRows = loadPending();
      for (const p of pendingRows) {
        const normDate = normalizeDate(p.attendance_date);
        const shift = p.shift || "morning";
        const key = `${p.employee_id}_${normDate}_${shift}`;
        const pendingRecord = dbToAttendance({ ...p, attendance_date: normDate, shift });
        attMap.set(key, pendingRecord);
      }

      cache.attendance = Array.from(attMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }

    if (lv.error) warn("leaves.hydrate", lv.error);
    else if (lv.data) cache.leaves = lv.data.map(dbToLeave);

    if (adv.error) warn("advances.hydrate", adv.error);
    else if (adv.data) cache.advances = adv.data.map(dbToAdvance);

    if (sal.error) warn("salaries.hydrate", sal.error);
    else if (sal.data) cache.salaries = sal.data.map(dbToSalary);

    if (tmp.error) warn("tempos.hydrate", tmp.error);
    else if (tmp.data) cache.tempos = tmp.data.map(dbToTempo);

    if (st.error) warn("settings.hydrate", st.error);
    else if (st.data?.value) {
      cache.settings = { ...DEFAULT_SETTINGS, ...(st.data.value as AppSettings) };
    }

    lastHydrateTimestamp = Date.now();
    deltaCursor = new Date(Date.now() - 10_000).toISOString();
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
    bumpData();

    ensureRealtimeSubscription();
    void flushPendingAttendance();

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

/**
 * Delta sync — sirf wahi rows laata hai jo pichhle sync ke baad badli hain.
 * Ye poll/focus par chalta hai, isliye app fast rehti hai aur har device par
 * data seconds me match ho jaata hai. Cursor na ho to full hydrate.
 */
export async function deltaSync(): Promise<boolean> {
  if (!isBrowser || !sb) return false;
  if (isHydrating || isDeltaSyncing) return false;
  if (!deltaCursor) return hydrate(true);

  isDeltaSyncing = true;
  const since = deltaCursor;
  try {
    const [att, emp, lv, adv, sal, tmp, st] = await Promise.all([
      sb.from("attendance").select("*").gt("updated_at", since).limit(2000),
      sb.from("employees").select("*").gt("updated_at", since).limit(1000),
      sb.from("leaves").select("*").gt("created_at", since).limit(1000),
      sb.from("advances").select("*").gt("created_at", since).limit(1000),
      sb.from("salaries").select("*").gt("generated_at", since).limit(1000),
      sb.from("tempos").select("*").gt("updated_at", since).limit(500),
      sb
        .from("settings")
        .select("*")
        .eq("key", "app_settings")
        .gt("updated_at", since)
        .maybeSingle(),
    ]);

    if (att.error || emp.error) {
      // Delta fail — full hydrate par fallback
      isDeltaSyncing = false;
      return hydrate(true);
    }

    let changed = false;

    if (att.data?.length) {
      const map = new Map<string, AttendanceRecord>();
      for (const r of cache.attendance) {
        map.set(`${r.employee_id}_${normalizeDate(r.date)}_${r.shift || "morning"}`, r);
      }
      for (const row of att.data) {
        const c = dbToAttendance(row as Row);
        const rec = { ...c, date: normalizeDate(c.date), shift: c.shift || "morning" };
        map.set(`${rec.employee_id}_${rec.date}_${rec.shift}`, rec);
      }
      cache.attendance = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      changed = true;
    }

    const mergeById = <T extends { id: string }>(list: T[], incoming: T[]) => {
      const map = new Map(list.map((x) => [x.id, x]));
      for (const x of incoming) map.set(x.id, x);
      return Array.from(map.values());
    };

    if (emp.data?.length) {
      cache.employees = mergeById(cache.employees, emp.data.map(dbToEmployee));
      changed = true;
    }
    if (lv.data?.length) {
      cache.leaves = mergeById(cache.leaves, lv.data.map(dbToLeave));
      changed = true;
    }
    if (adv.data?.length) {
      cache.advances = mergeById(cache.advances, adv.data.map(dbToAdvance));
      changed = true;
    }
    if (sal.data?.length) {
      cache.salaries = mergeById(cache.salaries, sal.data.map(dbToSalary));
      changed = true;
    }
    if (tmp.data?.length) {
      cache.tempos = mergeById(cache.tempos, tmp.data.map(dbToTempo));
      changed = true;
    }
    if (st.data?.value) {
      cache.settings = { ...DEFAULT_SETTINGS, ...(st.data.value as AppSettings) };
      changed = true;
    }

    deltaCursor = new Date(Date.now() - 10_000).toISOString();
    lastHydrateTimestamp = Date.now();

    if (changed) {
      persistLocal();
      bumpData();
    }
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
    ensureRealtimeSubscription();
    return true;
  } catch (e) {
    console.warn("[delta-sync]", e);
    return false;
  } finally {
    isDeltaSyncing = false;
  }
}

export function waitForInitialHydration(): Promise<boolean> {
  if (!initialHydratePromise) {
    initialHydratePromise = hydrate(true);
  }
  return initialHydratePromise;
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
let isRealtimeSubscribed = false;
let isRealtimeInitializing = false;

export function broadcastMutation(
  table: "attendance" | "employees" | "leaves" | "advances" | "salaries" | "tempos" | "settings",
  action: "upsert" | "delete" | "batch",
  data?: unknown,
  id?: string,
) {
  if (!sb || !realtimeChannel) return;
  try {
    realtimeChannel
      .send({
        type: "broadcast",
        event: "cloud_mutation",
        payload: {
          table,
          action,
          data,
          id,
          senderDeviceId: getDeviceId(),
          timestamp: Date.now(),
        },
      })
      .catch((e) => console.warn("[broadcast-send-error]", e));
  } catch (err) {
    /* ignore broadcast error */
  }
}

function ensureRealtimeSubscription() {
  if (!sb || isRealtimeSubscribed || isRealtimeInitializing) return;
  isRealtimeInitializing = true;

  try {
    // If a channel already exists with this topic in the Supabase client, clean it up first
    const existingChannels = sb.getChannels();
    const existing = existingChannels.find((c) => c.topic === "realtime:app-realtime-sync");
    if (existing) {
      try {
        sb.removeChannel(existing);
      } catch {
        /* ignore */
      }
    }

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
      const shift = next.shift || "morning";
      const item = { ...next, date: normDate, shift };
      const i = arr.findIndex(
        (x) =>
          x.id === item.id ||
          (x.employee_id === item.employee_id &&
            normalizeDate(x.date) === normDate &&
            (x.shift || "morning") === shift),
      );
      if (i >= 0) arr[i] = item;
      else arr.unshift(item);
    };

    const applyAttendanceDelete = (arr: AttendanceRecord[], id: string) => {
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
    };

    const channel = sb.channel("app-realtime-sync");

    // Attach ALL handlers BEFORE calling subscribe()
    channel
      .on("broadcast", { event: "cloud_mutation" }, (p) => {
        const payload = p.payload as {
          table: string;
          action: "upsert" | "delete" | "batch";
          data?: Record<string, unknown> | Record<string, unknown>[];
          id?: string;
          senderDeviceId?: string;
        };
        if (!payload) return;
        // Ignore echo from our own device (already applied locally)
        if (payload.senderDeviceId && payload.senderDeviceId === getDeviceId()) {
          return;
        }

        if (payload.table === "attendance") {
          if (payload.action === "delete" && payload.id) {
            applyAttendanceDelete(cache.attendance, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyAttendanceUpsert(cache.attendance, payload.data);
          } else {
            void deltaSync();
          }
          cache.attendance = [...cache.attendance];
        } else if (payload.table === "employees") {
          if (payload.action === "delete" && payload.id) {
            applyDelete(cache.employees, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyUpsert(cache.employees, payload.data);
          } else {
            void deltaSync();
          }
          cache.employees = [...cache.employees];
        } else if (payload.table === "leaves") {
          if (payload.action === "delete" && payload.id) {
            applyDelete(cache.leaves, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyUpsert(cache.leaves, payload.data);
          } else {
            void deltaSync();
          }
          cache.leaves = [...cache.leaves];
        } else if (payload.table === "advances") {
          if (payload.action === "delete" && payload.id) {
            applyDelete(cache.advances, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyUpsert(cache.advances, payload.data);
          } else {
            void deltaSync();
          }
          cache.advances = [...cache.advances];
        } else if (payload.table === "salaries") {
          if (payload.action === "delete" && payload.id) {
            applyDelete(cache.salaries, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyUpsert(cache.salaries, payload.data);
          } else {
            void deltaSync();
          }
          cache.salaries = [...cache.salaries];
        } else if (payload.table === "tempos") {
          if (payload.action === "delete" && payload.id) {
            applyDelete(cache.tempos, payload.id);
          } else if (payload.action === "upsert" && payload.data) {
            applyUpsert(cache.tempos, payload.data);
          } else {
            void deltaSync();
          }
          cache.tempos = [...cache.tempos];
        } else if (payload.table === "settings") {
          if (payload.data) {
            cache.settings = { ...DEFAULT_SETTINGS, ...payload.data };
          } else {
            void deltaSync();
          }
        }

        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, (p) => {
        if (p.eventType === "DELETE" && p.old) applyDelete(cache.employees, (p.old as Row).id);
        else if (p.new) applyUpsert(cache.employees, dbToEmployee(p.new as Row));
        cache.employees = [...cache.employees];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (p) => {
        if (p.eventType === "DELETE" && p.old) {
          applyAttendanceDelete(cache.attendance, (p.old as Row).id);
        } else if (p.new) {
          applyAttendanceUpsert(cache.attendance, dbToAttendance(p.new as Row));
        }
        cache.attendance = [...cache.attendance];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "leaves" }, (p) => {
        if (p.eventType === "DELETE" && p.old) applyDelete(cache.leaves, (p.old as Row).id);
        else if (p.new) applyUpsert(cache.leaves, dbToLeave(p.new as Row));
        cache.leaves = [...cache.leaves];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "advances" }, (p) => {
        if (p.eventType === "DELETE" && p.old) applyDelete(cache.advances, (p.old as Row).id);
        else if (p.new) applyUpsert(cache.advances, dbToAdvance(p.new as Row));
        cache.advances = [...cache.advances];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "salaries" }, (p) => {
        if (p.eventType === "DELETE" && p.old) applyDelete(cache.salaries, (p.old as Row).id);
        else if (p.new) applyUpsert(cache.salaries, dbToSalary(p.new as Row));
        cache.salaries = [...cache.salaries];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tempos" }, (p) => {
        if (p.eventType === "DELETE" && p.old) applyDelete(cache.tempos, (p.old as Row).id);
        else if (p.new) applyUpsert(cache.tempos, dbToTempo(p.new as Row));
        cache.tempos = [...cache.tempos];
        persistLocal();
        updateSyncState({
          status: "connected",
          lastSyncedAt: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
        bumpData();
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
          bumpData();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "__all__" }, () => {
        // Server functions mutations trigger snapshot rehydration
        void deltaSync();
      });

    realtimeChannel = channel;

    // NOW subscribe
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        isRealtimeSubscribed = true;
        isRealtimeInitializing = false;
        updateSyncState({ status: "connected" });
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        isRealtimeSubscribed = false;
        isRealtimeInitializing = false;
        updateSyncState({ status: "offline" });
      }
    });
  } catch (e) {
    isRealtimeInitializing = false;
    console.error("[realtime-init]", e);
  }
}

// Kick off initial load on module load (browser only).
if (isBrowser) {
  // Load data immediately on app launch
  void waitForInitialHydration();

  // Multi-device sync triggers: fetch latest cloud updates on tab focus / visibility
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void deltaSync();
    }
  });
  window.addEventListener("focus", () => {
    void deltaSync();
  });
  window.addEventListener("online", () => {
    updateSyncState({ status: "syncing" });
    void deltaSync();
  });
  window.addEventListener("offline", () => {
    updateSyncState({ status: "offline" });
  });

  // Fast delta poll every 8s (sirf badle hue rows) + safety full sync har 5 min
  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      typeof navigator !== "undefined" &&
      navigator.onLine !== false
    ) {
      void deltaSync();
    }
  }, 8000);

  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      typeof navigator !== "undefined" &&
      navigator.onLine !== false
    ) {
      void hydrate(true);
    }
  }, 300000);
}

// Manual force sync (available to all components/pages)
export async function refreshCloud(): Promise<boolean> {
  return await hydrate(true);
}

export async function forceCloudSync(): Promise<{ success: boolean; lastSyncedAt: string | null }> {
  const ok = await hydrate(true);
  return { success: ok, lastSyncedAt: currentSyncSnapshot.lastSyncedAt };
}

// ---------- write helpers (fire-and-forget with local optimistic update) ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warn(where: string, err: any) {
  const msg = err?.message || err?.details || err?.hint || String(err);
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("network") ||
    msg.includes("FetchError")
  ) {
    updateSyncState({ status: "offline", errorMessage: "Offline: saved locally" });
    return;
  }
  console.error(`[cloud-write error] ${where}:`, err);
  updateSyncState({ status: "error", errorMessage: `Supabase write failed (${where}): ${msg}` });
}

// ---------- durable attendance writes ----------
// Attendance kabhi gayab na ho: har row (employee_id, attendance_date, shift)
// unique key par upsert hoti hai, aur fail hone par queue me rakh kar retry hoti hai.

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
  queuePending(row);
  const { id: _id, ...payload } = row;
  const { data, error } = await sb
    .from("attendance")
    .upsert(payload, { onConflict: "employee_id,attendance_date,shift" })
    .select()
    .maybeSingle();
  if (error) {
    warn("attendance.upsert", error);
    return false;
  }
  dequeuePending(row);
  updateSyncState({
    status: "connected",
    lastSyncedAt: new Date().toISOString(),
    errorMessage: undefined,
  });
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
    broadcastMutation("attendance", "upsert", saved);
    bumpData();
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
      dedupMap.set(key, { ...existing, ...normalizedRow });
    }
  }

  const dedupedRows = Array.from(dedupMap.values());
  if (dedupedRows.length === 0) return { success: true, count: 0 };

  // Queue into pending offline queue immediately
  dedupedRows.forEach(queuePending);

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

  if (savedCount > 0) {
    updateSyncState({
      status: "connected",
      lastSyncedAt: new Date().toISOString(),
      errorMessage: undefined,
    });
    broadcastMutation("attendance", "batch");
  }
  bumpData();
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
  setInterval(() => {
    if (loadPending().length > 0) void flushPendingAttendance();
  }, 60000);
}

// ---------- employees ----------

export function getEmployees(): Employee[] {
  return cache.employees;
}
export async function saveEmployees(list: Employee[]): Promise<boolean> {
  cache.employees = list;
  saveLocal("tsa_employees", list);
  bumpData();
  let ok = true;
  if (sb && list.length > 0) {
    const rows = list.map(employeeToDb);
    const { error } = await sb.from("employees").upsert(rows, { onConflict: "id" });
    if (error) {
      warn("employees.save", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("employees", "batch");
    }
  }
  fire("Employees");
  return ok;
}
export async function upsertEmployee(emp: Employee): Promise<boolean> {
  const list = [...cache.employees];
  const idx = list.findIndex((e) => e.id === emp.id);
  if (idx >= 0) list[idx] = emp;
  else list.unshift(emp);
  cache.employees = list;
  saveLocal("tsa_employees", list);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("employees").upsert(employeeToDb(emp), { onConflict: "id" });
    if (error) {
      warn("employee.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("employees", "upsert", emp);
    }
  }
  fire("Employees");
  return ok;
}
export async function deleteEmployee(id: string): Promise<boolean> {
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

  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("employees").delete().eq("id", id);
    if (error) {
      warn("employee.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("employees", "delete", undefined, id);
    }
  }
  fire("Employees");
  return ok;
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
export async function saveAttendance(list: AttendanceRecord[]): Promise<boolean> {
  cache.attendance = list.map((r) => ({ ...r, date: normalizeDate(r.date) }));
  saveLocal("tsa_attendance", cache.attendance);
  saveLocal("tsa_attendance_backup", cache.attendance);
  bumpData();
  fire("Attendance");
  if (sb && list.length > 0) {
    const dbRows = list.map(attendanceToDb);
    const res = await pushAttendanceRowsBatch(dbRows);
    return res.success;
  }
  return true;
}

export function getAttendanceForMonth(month: string): AttendanceRecord[] {
  const normMonth = month.trim().slice(0, 7);
  return cache.attendance.filter((r) => normalizeDate(r.date).startsWith(normMonth));
}

let isAutoSundayRunning = false;

export async function upsertAttendance(
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
  bumpData();
  const row = attendanceToDb(rec);
  let pushSuccess = true;
  if (sb) {
    pushSuccess = await pushAttendanceRow(row);
  } else {
    queuePending(row);
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

  return pushSuccess;
}

export async function upsertBulkAttendance(
  records: AttendanceRecord[],
  options?: { skipSundayCheck?: boolean },
): Promise<{ success: boolean; count: number }> {
  if (!records.length) return { success: true, count: 0 };

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
  bumpData();
  fire("Attendance");

  let pushResult: { success: boolean; count: number };
  if (sb) {
    pushResult = await pushAttendanceRowsBatch(dbRows);
  } else {
    dbRows.forEach(queuePending);
    pushResult = { success: true, count: records.length };
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

  return pushResult;
}
export function getAttendanceForDate(date: string): AttendanceRecord[] {
  const norm = normalizeDate(date);
  return cache.attendance.filter((r) => normalizeDate(r.date) === norm);
}

export async function deleteAttendance(id: string): Promise<boolean> {
  cache.attendance = cache.attendance.filter((a) => a.id !== id);
  saveLocal("tsa_attendance", cache.attendance);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("attendance").delete().eq("id", id);
    if (error) {
      warn("attendance.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("attendance", "delete", undefined, id);
    }
  }
  fire("Attendance");
  return ok;
}

// ---------- leaves ----------

export function getLeaves(): Leave[] {
  return cache.leaves;
}
export async function saveLeaves(list: Leave[]): Promise<boolean> {
  cache.leaves = list;
  saveLocal("tsa_leaves", list);
  bumpData();
  let ok = true;
  if (sb && list.length > 0) {
    const rows = list.map(leaveToDb);
    const { error } = await sb.from("leaves").upsert(rows, { onConflict: "id" });
    if (error) {
      warn("leaves.save", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("leaves", "batch");
    }
  }
  fire("Leaves");
  return ok;
}
export async function upsertLeave(l: Leave): Promise<boolean> {
  const list = [...cache.leaves];
  const i = list.findIndex((r) => r.id === l.id);
  if (i >= 0) list[i] = l;
  else list.unshift(l);
  cache.leaves = list;
  saveLocal("tsa_leaves", list);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("leaves").upsert(leaveToDb(l), { onConflict: "id" });
    if (error) {
      warn("leave.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("leaves", "upsert", l);
    }
  }
  fire("Leaves");
  return ok;
}
export async function deleteLeave(id: string): Promise<boolean> {
  cache.leaves = cache.leaves.filter((l) => l.id !== id);
  saveLocal("tsa_leaves", cache.leaves);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("leaves").delete().eq("id", id);
    if (error) {
      warn("leave.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("leaves", "delete", undefined, id);
    }
  }
  fire("Leaves");
  return ok;
}

// ---------- advances ----------

export function getAdvances(): Advance[] {
  return cache.advances;
}
export async function saveAdvances(list: Advance[]): Promise<boolean> {
  cache.advances = list;
  saveLocal("tsa_advances", list);
  bumpData();
  let ok = true;
  if (sb && list.length > 0) {
    const rows = list.map(advanceToDb);
    const { error } = await sb.from("advances").upsert(rows, { onConflict: "id" });
    if (error) {
      warn("advances.save", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("advances", "batch");
    }
  }
  fire("Advances");
  return ok;
}
export async function upsertAdvance(a: Advance): Promise<boolean> {
  const list = [...cache.advances];
  const i = list.findIndex((r) => r.id === a.id);
  if (i >= 0) list[i] = a;
  else list.unshift(a);
  cache.advances = list;
  saveLocal("tsa_advances", list);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("advances").upsert(advanceToDb(a), { onConflict: "id" });
    if (error) {
      warn("advance.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("advances", "upsert", a);
    }
  }
  fire("Advances");
  return ok;
}
export async function deleteAdvance(id: string): Promise<boolean> {
  cache.advances = cache.advances.filter((a) => a.id !== id);
  saveLocal("tsa_advances", cache.advances);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("advances").delete().eq("id", id);
    if (error) {
      warn("advance.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("advances", "delete", undefined, id);
    }
  }
  fire("Advances");
  return ok;
}

// ---------- salaries ----------

export function getSalaries(): SalaryRecord[] {
  return cache.salaries;
}
export async function saveSalaries(list: SalaryRecord[]): Promise<boolean> {
  cache.salaries = list;
  saveLocal("tsa_salaries", list);
  bumpData();
  let ok = true;
  if (sb && list.length > 0) {
    const rows = list.map(salaryToDb);
    const { error } = await sb.from("salaries").upsert(rows, { onConflict: "employee_id,month" });
    if (error) {
      warn("salaries.save", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("salaries", "batch");
    }
  }
  fire("Salary");
  return ok;
}
export async function upsertSalary(s: SalaryRecord): Promise<boolean> {
  const list = [...cache.salaries];
  const i = list.findIndex((r) => r.id === s.id);
  if (i >= 0) list[i] = s;
  else list.unshift(s);
  cache.salaries = list;
  saveLocal("tsa_salaries", list);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb
      .from("salaries")
      .upsert(salaryToDb(s), { onConflict: "employee_id,month" });
    if (error) {
      warn("salary.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("salaries", "upsert", s);
    }
  }
  fire("Salary");
  return ok;
}
export async function deleteSalary(id: string): Promise<boolean> {
  cache.salaries = cache.salaries.filter((s) => s.id !== id);
  saveLocal("tsa_salaries", cache.salaries);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("salaries").delete().eq("id", id);
    if (error) {
      warn("salary.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("salaries", "delete", undefined, id);
    }
  }
  fire("Salary");
  return ok;
}

// ---------- tempos ----------

export function getTempos(): Tempo[] {
  return cache.tempos;
}
export async function saveTempos(list: Tempo[]): Promise<boolean> {
  cache.tempos = list;
  saveLocal("tsa_tempos", list);
  bumpData();
  let ok = true;
  if (sb && list.length > 0) {
    const rows = list.map(tempoToDb);
    const { error } = await sb.from("tempos").upsert(rows, { onConflict: "id" });
    if (error) {
      warn("tempos.save", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("tempos", "batch");
    }
  }
  fire("Tempos");
  return ok;
}
export async function upsertTempo(t: Tempo): Promise<boolean> {
  const list = [...cache.tempos];
  const i = list.findIndex((r) => r.id === t.id);
  if (i >= 0) list[i] = t;
  else list.unshift(t);
  cache.tempos = list;
  saveLocal("tsa_tempos", list);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("tempos").upsert(tempoToDb(t), { onConflict: "id" });
    if (error) {
      warn("tempo.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("tempos", "upsert", t);
    }
  }
  fire("Tempos");
  return ok;
}
export async function deleteTempo(id: string): Promise<boolean> {
  cache.tempos = cache.tempos.filter((t) => t.id !== id);
  saveLocal("tsa_tempos", cache.tempos);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb.from("tempos").delete().eq("id", id);
    if (error) {
      warn("tempo.delete", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("tempos", "delete", undefined, id);
    }
  }
  fire("Tempos");
  return ok;
}

// ---------- settings ----------

export function getSettings(): AppSettings {
  return cache.settings;
}
export async function saveSettings(s: AppSettings): Promise<boolean> {
  cache.settings = s;
  saveLocal("tsa_settings", s);
  bumpData();
  let ok = true;
  if (sb) {
    const { error } = await sb
      .from("settings")
      .upsert({ key: "app_settings", value: s }, { onConflict: "key" });
    if (error) {
      warn("settings.upsert", error);
      ok = false;
    } else {
      updateSyncState({
        status: "connected",
        lastSyncedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      broadcastMutation("settings", "upsert", s);
    }
  }
  return ok;
}
export function updateSettings(patch: Partial<AppSettings>) {
  return saveSettings({ ...cache.settings, ...patch });
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
