// Automatic attendance rules — Sunday rule + daily 7 PM auto-absent.
// Sab kuch date-based hai (time ka koi role nahi, sirf 7 PM cutoff ke liye).

import { getAttendance, getEmployees, newId, upsertAttendance, normalizeDate } from "./store";

const DAY = 86400000;

/** IST "now" as a Date whose UTC fields represent IST wall-clock. */
function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}
export function istToday(): string {
  return istNow().toISOString().slice(0, 10);
}
export function istHour(): number {
  return istNow().getUTCHours();
}
export function shiftDate(date: string, days: number): string {
  const norm = normalizeDate(date);
  return new Date(new Date(norm + "T00:00:00Z").getTime() + days * DAY).toISOString().slice(0, 10);
}
export function isSunday(date: string): boolean {
  const norm = normalizeDate(date);
  return new Date(norm + "T00:00:00Z").getUTCDay() === 0;
}
export function isMonday(date: string): boolean {
  const norm = normalizeDate(date);
  return new Date(norm + "T00:00:00Z").getUTCDay() === 1;
}
export function isSaturday(date: string): boolean {
  const norm = normalizeDate(date);
  return new Date(norm + "T00:00:00Z").getUTCDay() === 6;
}

type Marks = Map<string, { status: string; method?: string; id?: string }>;
function marksFor(date: string): Marks {
  const norm = normalizeDate(date);
  const m: Marks = new Map();
  for (const r of getAttendance()) {
    if (normalizeDate(r.date) === norm && r.shift === "morning")
      m.set(r.employee_id, { status: r.status, method: r.method, id: r.id });
  }
  return m;
}
const isPresent = (s?: string) => s === "present" || s === "late";

/**
 * Sunday rule (Strict Saturday + Monday check):
 * - Saturday Present/Late AUR Monday Present/Late -> Sunday Auto Present.
 * - In dono me se kisi ek din bhi Absent ya Chutti -> Sunday Absent.
 * @param sunday Date in YYYY-MM-DD
 * @param force If true, overrides manual edits with computed Sunday rule
 */
export function applySundayRule(sunday: string, force = false): number {
  const normSun = normalizeDate(sunday);
  if (!isSunday(normSun)) return 0;

  const satDate = shiftDate(normSun, -1);
  const monDate = shiftDate(normSun, 1);

  const sat = marksFor(satDate);
  const mon = marksFor(monDate);

  // Agar Sat aur Mon dono me se kisi din koi record hi nahi hai, to wait karein
  if (!sat.size && !mon.size) return 0;

  const sun = marksFor(normSun);
  let written = 0;

  // Har employee check karein (active + jinka weekend me attendance record hai)
  const allEmployees = getEmployees();
  const weekendEmpIds = new Set([
    ...Array.from(sat.keys()),
    ...Array.from(mon.keys()),
    ...Array.from(sun.keys()),
  ]);
  const empsToCheck = allEmployees.filter((e) => e.active || weekendEmpIds.has(e.id));

  for (const e of empsToCheck) {
    const satRecord = sat.get(e.id);
    const monRecord = mon.get(e.id);

    // Agar Monday record abhi tak bilkul nahi aaya (e.g. Monday morning worker ne scan nahi kiya),
    // to Sunday ka faisla tab tak pending rahega jab tak Monday ka mark na aa jaye
    if (!monRecord && !satRecord) continue;

    // Sat & Mon presence check
    const satOk = satRecord ? isPresent(satRecord.status) : false;
    const monOk = monRecord ? isPresent(monRecord.status) : false;

    // Strict Rule: Dono din present hone chahiye
    const should: "present" | "absent" = satOk && monOk ? "present" : "absent";
    const cur = sun.get(e.id);

    if (cur) {
      // Biometric / face scan direct Sunday par kiya ho to preserve karein
      const isRealBiometric = cur.method === "face" || cur.method === "fingerprint";
      if (isRealBiometric && !force) continue;

      // Agar manual edit hai aur force nahi hai to skip
      if (cur.method === "manual" && !force) continue;

      // Agar pehle se wahi status hai to dobara write na karein
      if (cur.status === should) continue;
    }

    upsertAttendance(
      {
        id: cur?.id ?? newId(),
        employee_id: e.id,
        date: normSun,
        shift: "morning",
        status: should,
        method: "auto-sunday",
      },
      { skipSundayCheck: true },
    );
    written++;
  }
  return written;
}

/** Monday attendance aane par previous Sunday ka rule trigger karein */
export function applySundayRuleForMonday(mondayDate: string): number {
  const normMon = normalizeDate(mondayDate);
  if (!isMonday(normMon)) return 0;
  const sunday = shiftDate(normMon, -1);
  return applySundayRule(sunday);
}

/** Saturday attendance update hone par next Sunday ka rule check karein (agar Monday marked hai) */
export function applySundayRuleForSaturday(satDate: string): number {
  const normSat = normalizeDate(satDate);
  if (!isSaturday(normSat)) return 0;
  const sunday = shiftDate(normSat, 1);
  return applySundayRule(sunday);
}

/** Pichhle 4 hafton ke Sundays par rule chala do (pending Sundays) */
export function applyRecentSundayRules(): number {
  const today = istToday();
  let n = 0;
  for (let i = 1; i <= 28; i++) {
    const d = shiftDate(today, -i);
    if (isSunday(d)) n += applySundayRule(d);
  }
  return n;
}

/**
 * Jis din kisi ek worker ki bhi attendance lagi hai, us din baaki sabki chutti
 * (absent) 7 PM IST ke baad auto lag jaati hai. Purane dinon par turant.
 */
export function applyAutoAbsent(date: string): number {
  const normDate = normalizeDate(date);
  const today = istToday();
  if (normDate > today) return 0;
  if (normDate === today && istHour() < 19) return 0;
  const marks = marksFor(normDate);
  if (!marks.size) return 0; // us din kisi ki bhi attendance nahi lagi — chhod do
  let written = 0;
  for (const e of getEmployees().filter((x) => x.active)) {
    if (marks.has(e.id)) continue;
    upsertAttendance(
      {
        id: newId(),
        employee_id: e.id,
        date: normDate,
        shift: "morning",
        status: "absent",
        method: "auto-absent",
      },
      { skipSundayCheck: true },
    );
    written++;
  }
  return written;
}

/** Aaj + pichhle 3 din ka auto-absent, aur pending Sunday rules. */
export function runAutoAttendanceRules(): { sundays: number; absents: number } {
  const today = istToday();
  let absents = 0;
  for (let i = 0; i <= 3; i++) {
    const d = shiftDate(today, -i);
    if (isSunday(d)) continue; // Sunday ka faisla Sunday rule karta hai
    absents += applyAutoAbsent(d);
  }
  const sundays = applyRecentSundayRules();
  return { sundays, absents };
}
