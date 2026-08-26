import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Printer,
  CalendarDays,
  ClipboardList,
  Lock,
  Unlock,
  Pencil,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  CheckSquare,
  Square,
  Zap,
  CheckCircle2,
  XCircle,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import {
  getEmployees,
  getAttendance,
  getLeaves,
  getAttendanceForDate,
  getSalaries,
  getSettings,
  upsertAttendance,
  upsertBulkAttendance,
  todayDDMM_IST,
  newId,
  normalizeDate,
  useCloudSync,
  type AttendanceRecord,
} from "@/lib/store";
import { useSortable, SortHeader } from "@/lib/use-sort";

export const Route = createFileRoute("/_admin/reports")({ component: ReportsPage });

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(",")),
  ].join("\n");
}

function daysInMonthCount(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function shiftDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  dateObj.setDate(dateObj.getDate() + delta);
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
}

function formatMonthTitle(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function formatDayTitle(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Monthly Attendance Matrix ──────────────────────────────────────────────
function MonthlyMatrix({ month, editMode }: { month: string; editMode: boolean }) {
  const syncVersion = useCloudSync();
  const tableRef = useRef<HTMLDivElement>(null);
  // Incremented on every cell edit so useMemo re-runs and the table refreshes
  const [revision, setRevision] = useState(0);
  // Multi-worker selection for bulk updates
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(new Set());
  const [targetDay, setTargetDay] = useState<string>(() => {
    const today = new Date().toISOString().slice(8, 10);
    return today;
  });
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  // Timer ref for distinguishing single-click vs double-click
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // month is intentionally in deps to refresh employee list on month change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const emps = useMemo(() => getEmployees().filter((e) => e.active), [month, syncVersion]);
  const totalDays = useMemo(() => daysInMonthCount(month), [month]);
  const dates = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => pad2(i + 1)),
    [totalDays],
  );

  // Build attendance lookup: empId -> dateStr -> status
  const attMap = useMemo(() => {
    const all = getAttendance().filter((a) => normalizeDate(a.date).startsWith(month));
    const m = new Map<string, Map<string, string>>();
    for (const a of all) {
      const normDate = normalizeDate(a.date);
      const dd = normDate.slice(8, 10);
      if (!m.has(a.employee_id)) m.set(a.employee_id, new Map());
      const empDateMap = m.get(a.employee_id)!;
      const prevStatus = empDateMap.get(dd);
      // Priority: if any record on that date is present or late, record it
      if (!prevStatus || a.status === "present" || a.status === "late") {
        empDateMap.set(dd, a.status);
      }
    }
    return m;
    // revision is intentionally in deps to force re-read on edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, revision, syncVersion]);

  // Build leave lookup: empId -> Set of date strings (dd) in this month
  const leaveMap = useMemo(() => {
    const monthStart = `${month}-01`;
    const [y, mo] = month.split("-").map(Number);
    const totalDaysInThisMonth = new Date(y, mo, 0).getDate();
    const monthEnd = `${month}-${pad2(totalDaysInThisMonth)}`;
    const approved = getLeaves().filter(
      (l) => l.status === "approved" && l.from_date <= monthEnd && l.to_date >= monthStart,
    );
    const m = new Map<string, Set<string>>();
    for (const l of approved) {
      if (!m.has(l.employee_id)) m.set(l.employee_id, new Set());
      const from = new Date(l.from_date);
      const to = new Date(l.to_date);
      const start = new Date(Math.max(from.getTime(), new Date(monthStart).getTime()));
      const end = new Date(Math.min(to.getTime(), new Date(monthEnd).getTime()));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dd = pad2(d.getDate());
        m.get(l.employee_id)!.add(dd);
      }
    }
    return m;
  }, [month]);

  function dayLabel(dd: string) {
    const [y, mo] = month.split("-").map(Number);
    const d = new Date(y, mo - 1, parseInt(dd));
    return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
  }
  function isSunday(dd: string) {
    const [y, mo] = month.split("-").map(Number);
    return new Date(y, mo - 1, parseInt(dd)).getDay() === 0;
  }

  function getCell(empId: string, dd: string): "present" | "leave" | "absent" | "none" {
    const attStatus = attMap.get(empId)?.get(dd);
    if (attStatus === "present" || attStatus === "late") return "present";
    if (attStatus === "absent") return "absent";
    if (leaveMap.get(empId)?.has(dd)) return "leave";
    return "none";
  }

  function totalPresent(empId: string) {
    let count = 0;
    for (const dd of dates) {
      if (getCell(empId, dd) === "present") count++;
    }
    return count;
  }

  // Sorting for Monthly Matrix: Worker Name, Role, Total
  const {
    sorted: sortedEmps,
    sort: mSort,
    toggle: mToggle,
  } = useSortable(emps, {
    name: (e) => e.full_name,
    role: (e) => e.role ?? "",
    total: (e) => totalPresent(e.id),
  });

  // Toggle single worker selection
  const toggleSelectWorker = (id: string) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle select all workers
  const toggleSelectAll = () => {
    if (selectedWorkerIds.size === sortedEmps.length && sortedEmps.length > 0) {
      setSelectedWorkerIds(new Set());
    } else {
      setSelectedWorkerIds(new Set(sortedEmps.map((e) => e.id)));
    }
  };

  // Write a cell directly to the attendance store + Supabase
  const markCell = useCallback(
    async (empId: string, dd: string, status: "present" | "absent") => {
      const dateStr = `${month}-${dd}`;
      const normDateStr = normalizeDate(dateStr);
      const all = getAttendance();
      const existing = all.find(
        (a) => a.employee_id === empId && normalizeDate(a.date) === normDateStr,
      );
      const record: AttendanceRecord = {
        id: existing?.id ?? newId(),
        employee_id: empId,
        date: normDateStr,
        shift: existing?.shift ?? "morning",
        status,
        in_time: existing?.in_time ?? (status === "present" ? new Date().toISOString() : undefined),
        method: "manual",
        marked_by: "admin",
      };
      upsertAttendance(record);
      setRevision((r) => r + 1);
    },
    [month],
  );

  // Single click → absent (0); double click → present (1)
  const handleCellClick = useCallback(
    (empId: string, dd: string) => {
      if (!editMode) return;
      if (clickTimerRef.current) {
        // second click — it's a double-click, cancel the pending single-click action
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        markCell(empId, dd, "present");
      } else {
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null;
          markCell(empId, dd, "absent");
        }, 280);
      }
    },
    [editMode, markCell],
  );

  // Bulk: Mark selected workers (or all) Present/Absent on target day with fast Supabase Sync
  const handleBulkDayMark = async (status: "present" | "absent") => {
    const targetWorkers =
      selectedWorkerIds.size > 0
        ? sortedEmps.filter((e) => selectedWorkerIds.has(e.id))
        : sortedEmps;

    if (targetWorkers.length === 0) {
      toast.error("Koi worker select nahi hai");
      return;
    }

    const dateStr = `${month}-${targetDay}`;
    const normDateStr = normalizeDate(dateStr);
    setIsBulkSaving(true);

    try {
      const all = getAttendance();
      const recordsToUpsert: AttendanceRecord[] = targetWorkers.map((e) => {
        const existing = all.find(
          (a) => a.employee_id === e.id && normalizeDate(a.date) === normDateStr,
        );
        return {
          id: existing?.id ?? newId(),
          employee_id: e.id,
          date: normDateStr,
          shift: existing?.shift ?? "morning",
          status,
          in_time:
            existing?.in_time ?? (status === "present" ? new Date().toISOString() : undefined),
          method: "manual",
          marked_by: "admin",
        };
      });

      await upsertBulkAttendance(recordsToUpsert);
      setRevision((r) => r + 1);
      toast.success(
        `⚡ ${targetWorkers.length} workers ${status === "present" ? "Present" : "Absent"} mark ho gaye (${targetDay}/${month.slice(5, 7)}) Supabase me save ho gaya!`,
      );
    } catch (err) {
      toast.error("Attendance save karne me error aaya");
    } finally {
      setIsBulkSaving(false);
    }
  };

  // Bulk: Fill full month (Mon-Sat Present) for selected workers with fast Supabase Sync
  const handleFillFullMonth = async () => {
    const targetWorkers =
      selectedWorkerIds.size > 0
        ? sortedEmps.filter((e) => selectedWorkerIds.has(e.id))
        : sortedEmps;

    if (targetWorkers.length === 0) {
      toast.error("Koi worker select nahi hai");
      return;
    }

    setIsBulkSaving(true);
    try {
      const all = getAttendance();
      const recordsToUpsert: AttendanceRecord[] = [];

      for (const e of targetWorkers) {
        for (const dd of dates) {
          if (isSunday(dd)) continue; // Skip Sunday
          const dateStr = `${month}-${dd}`;
          const normDateStr = normalizeDate(dateStr);
          const existing = all.find(
            (a) => a.employee_id === e.id && normalizeDate(a.date) === normDateStr,
          );
          recordsToUpsert.push({
            id: existing?.id ?? newId(),
            employee_id: e.id,
            date: normDateStr,
            shift: existing?.shift ?? "morning",
            status: "present",
            in_time: existing?.in_time ?? new Date().toISOString(),
            method: "manual",
            marked_by: "admin",
          });
        }
      }

      await upsertBulkAttendance(recordsToUpsert);
      setRevision((r) => r + 1);
      toast.success(
        `⚡ ${targetWorkers.length} workers ka poora mahina (Mon-Sat) Present mark ho gaya aur Supabase me save ho gaya!`,
      );
    } catch (err) {
      toast.error("Full month mark karne me error aaya");
    } finally {
      setIsBulkSaving(false);
    }
  };

  // Quick mark all workers for a specific day from column header click
  const handleQuickColumnMark = async (dd: string, status: "present" | "absent") => {
    const dateStr = `${month}-${dd}`;
    const normDateStr = normalizeDate(dateStr);
    setIsBulkSaving(true);
    try {
      const all = getAttendance();
      const recordsToUpsert: AttendanceRecord[] = sortedEmps.map((e) => {
        const existing = all.find(
          (a) => a.employee_id === e.id && normalizeDate(a.date) === normDateStr,
        );
        return {
          id: existing?.id ?? newId(),
          employee_id: e.id,
          date: normDateStr,
          shift: existing?.shift ?? "morning",
          status,
          in_time:
            existing?.in_time ?? (status === "present" ? new Date().toISOString() : undefined),
          method: "manual",
          marked_by: "admin",
        };
      });

      await upsertBulkAttendance(recordsToUpsert);
      setRevision((r) => r + 1);
      toast.success(
        `⚡ Day ${dd} par sabhi ${sortedEmps.length} workers ${status === "present" ? "Present" : "Absent"} mark ho gaye!`,
      );
    } catch (err) {
      toast.error("Error saving column attendance");
    } finally {
      setIsBulkSaving(false);
    }
  };

  // CSV export
  const downloadCSV = () => {
    const header = [
      "Worker Name",
      "Role",
      ...dates.map((d) => `${d}/${month.slice(5, 7)}`),
      "Total Present",
    ];
    const rows = sortedEmps.map((e) => {
      const cells = dates.map((dd) => {
        const c = getCell(e.id, dd);
        return c === "present" ? "1" : c === "leave" ? "*" : c === "absent" ? "-" : "";
      });
      return [e.full_name, e.role, ...cells, String(totalPresent(e.id))];
    });
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-matrix-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printMatrix = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const tableHtml = tableRef.current?.innerHTML ?? "";
    const [y, mo] = month.split("-").map(Number);
    const monthName = new Date(y, mo - 1, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
    printWindow.document.write(`
      <html><head><title>Attendance — ${monthName}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; }
        h2 { margin-bottom: 8px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 3px 4px; text-align: center; white-space: nowrap; }
        th { background: #f3f4f6; font-weight: bold; }
        .name-col { text-align: left; font-weight: 600; min-width: 100px; }
        .present { background: #bbf7d0; color: #166534; font-weight: bold; }
        .leave { background: #fef9c3; color: #854d0e; font-weight: bold; }
        .absent { background: #fee2e2; color: #991b1b; }
        .sunday { background: #f1f5f9; }
        .total-col { background: #dbeafe; font-weight: bold; }
      </style></head>
      <body>
        <h2>Attendance Report — ${monthName}</h2>
        <p style="margin-bottom:8px; font-size:11px;">
          Legend: <b>1</b> = Present &nbsp; <b>*</b> = Leave &nbsp; <b>-</b> = Absent &nbsp; blank = Not marked
        </p>
        ${tableHtml}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  return (
    <div className="space-y-3">
      {/* Top action row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={downloadCSV}>
          <Download className="size-3.5 mr-1" /> CSV Export
        </Button>
        <Button variant="outline" size="sm" onClick={printMatrix}>
          <Printer className="size-3.5 mr-1" /> Print
        </Button>
        {editMode && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-900 text-xs px-3 py-1.5 rounded-lg ml-auto font-medium">
            <Pencil className="size-3.5 text-amber-600" />
            <span>
              Edit Mode ON: Single click = Absent (0) | Double click = Present (1) | Header Click =
              Bulk Day Mark
            </span>
          </div>
        )}
        {!editMode && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded bg-green-200 border border-green-400" />{" "}
              <b>1</b> Present
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded bg-yellow-100 border border-yellow-400" />{" "}
              <b>*</b> Leave
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded bg-red-100 border border-red-300" />{" "}
              <b>-</b> Absent
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded bg-gray-100 border border-gray-300" />{" "}
              blank = Not marked
            </span>
          </div>
        )}
      </div>

      {/* Multi-worker Bulk Actions Toolbar */}
      <Card className="p-3 bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-white dark:from-slate-900 dark:to-slate-800 border border-blue-200/80 dark:border-slate-700 shadow-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectAll}
              className="h-8 text-xs font-semibold"
            >
              {selectedWorkerIds.size === sortedEmps.length && sortedEmps.length > 0 ? (
                <>
                  <CheckSquare className="size-3.5 mr-1.5 text-primary" /> Unselect All
                </>
              ) : (
                <>
                  <Square className="size-3.5 mr-1.5 text-muted-foreground" /> Select All (
                  {sortedEmps.length})
                </>
              )}
            </Button>
            {selectedWorkerIds.size > 0 && (
              <Badge variant="default" className="bg-primary text-white font-bold">
                {selectedWorkerIds.size} Selected
              </Badge>
            )}
            <div className="flex items-center gap-1.5 ml-1">
              <span className="font-semibold text-muted-foreground">Target Day:</span>
              <select
                value={targetDay}
                onChange={(e) => setTargetDay(e.target.value)}
                className="h-8 px-2 py-1 rounded-md border border-input bg-background font-bold text-xs focus:ring-1 focus:ring-primary"
              >
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {d} ({dayLabel(d)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              disabled={isBulkSaving}
              onClick={() => handleBulkDayMark("present")}
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs"
              title="Mark selected workers present for the selected day"
            >
              <CheckCircle2 className="size-3.5 mr-1.5" />
              {selectedWorkerIds.size > 0
                ? `Mark Selected Present (${targetDay})`
                : `Sabhi Present (${targetDay})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isBulkSaving}
              onClick={() => handleBulkDayMark("absent")}
              className="h-8 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950 font-semibold text-xs"
              title="Mark selected workers absent for the selected day"
            >
              <XCircle className="size-3.5 mr-1.5" />
              {selectedWorkerIds.size > 0
                ? `Mark Selected Absent (${targetDay})`
                : `Sabhi Absent (${targetDay})`}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBulkSaving}
              onClick={handleFillFullMonth}
              className="h-8 bg-indigo-100 hover:bg-indigo-200 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200 font-semibold text-xs"
              title="Fill all non-Sundays as Present for the whole month in Supabase"
            >
              <Zap className="size-3.5 mr-1.5 text-amber-500" />
              Fill Full Month (Mon-Sat)
            </Button>
          </div>
        </div>
      </Card>

      {/* Monthly Matrix Table with Guaranteed Sticky Date Header */}
      <div
        ref={tableRef}
        className="overflow-auto rounded-md border shadow-xs max-h-[calc(100vh-270px)] relative bg-background"
      >
        <table className="border-collapse text-xs min-w-max w-full">
          {/* THEAD with sticky top-0 */}
          <thead className="sticky top-0 z-30 bg-slate-100 dark:bg-slate-900 border-b shadow-xs">
            {/* Day-of-week row */}
            <tr className="bg-slate-100 dark:bg-slate-900">
              {/* Sticky Top-Left Corner (Worker Name & Selection) */}
              <th className="border border-border px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[200px] bg-slate-100 dark:bg-slate-900 sticky left-0 z-40 shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedWorkerIds.size === sortedEmps.length && sortedEmps.length > 0}
                    onChange={toggleSelectAll}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    title="Select All Workers"
                  />
                  <button
                    type="button"
                    onClick={() => mToggle("name")}
                    className="inline-flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer select-none font-bold text-xs text-foreground"
                    title="Sort by Worker Name (Ascending / Descending)"
                  >
                    <span>Worker Name</span>
                    <ArrowUpDown
                      className={`size-3.5 ${mSort?.key === "name" ? "text-primary opacity-100" : "opacity-40"}`}
                    />
                    {mSort?.key === "name" && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase">
                        {mSort.dir === "asc" ? "A → Z" : "Z → A"}
                      </span>
                    )}
                  </button>
                </div>
              </th>
              {/* Role Header */}
              <th className="border border-border px-2 py-2 text-left font-semibold whitespace-nowrap min-w-[110px] bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => mToggle("role")}
                  className="inline-flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer select-none font-bold text-xs text-foreground"
                  title="Sort by Role (Ascending / Descending)"
                >
                  <span>Role</span>
                  <ArrowUpDown
                    className={`size-3.5 ${mSort?.key === "role" ? "text-primary opacity-100" : "opacity-40"}`}
                  />
                  {mSort?.key === "role" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase">
                      {mSort.dir === "asc" ? "A → Z" : "Z → A"}
                    </span>
                  )}
                </button>
              </th>
              {/* Day Labels */}
              {dates.map((dd) => (
                <th
                  key={dd}
                  className={`border border-border px-1.5 py-1 font-medium w-8 text-center ${
                    isSunday(dd)
                      ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold"
                      : "text-muted-foreground"
                  }`}
                >
                  {dayLabel(dd)}
                </th>
              ))}
              {/* Total Column Header */}
              <th className="border border-border px-2 py-1.5 font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/40 whitespace-nowrap text-center">
                <button
                  type="button"
                  onClick={() => mToggle("total")}
                  className="inline-flex items-center gap-1 hover:underline cursor-pointer select-none font-bold text-xs justify-center text-blue-700 dark:text-blue-400"
                  title="Sort by Total Present"
                >
                  <span>Total</span>
                  {mSort?.key === "total" ? (
                    mSort.dir === "asc" ? (
                      <ArrowUp className="size-3.5 text-blue-700" />
                    ) : (
                      <ArrowDown className="size-3.5 text-blue-700" />
                    )
                  ) : (
                    <ArrowUpDown className="size-3.5 opacity-40 hover:opacity-100" />
                  )}
                </button>
              </th>
            </tr>

            {/* Date Number Row (Fixed at top with sticky header) */}
            <tr className="bg-slate-100 dark:bg-slate-900 border-b-2 border-border">
              <th className="border border-border px-3 py-1.5 text-left text-[11px] font-bold text-muted-foreground bg-slate-100 dark:bg-slate-900 sticky left-0 z-40 shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                Date (Day) →
              </th>
              <th className="border border-border px-2 py-1.5 text-left text-[11px] font-bold text-primary bg-slate-100 dark:bg-slate-900">
                {month}
              </th>
              {dates.map((dd) => (
                <th
                  key={dd}
                  className={`border border-border px-1.5 py-1 font-bold text-center group cursor-pointer ${
                    isSunday(dd)
                      ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      : "hover:bg-primary/10"
                  }`}
                  onClick={() => {
                    if (editMode) {
                      handleQuickColumnMark(dd, "present");
                    }
                  }}
                  title={editMode ? `Click to mark all workers Present for Day ${dd}` : `Day ${dd}`}
                >
                  <span className="inline-block">{dd}</span>
                </th>
              ))}
              <th className="border border-border px-2 py-1 font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-center">
                /{totalDays}
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody>
            {sortedEmps.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + 3}
                  className="text-center py-6 text-muted-foreground border border-border"
                >
                  Koi active employee nahi hai
                </td>
              </tr>
            )}
            {sortedEmps.map((e, idx) => {
              const tp = totalPresent(e.id);
              const isSelected = selectedWorkerIds.has(e.id);
              const rowBg = isSelected
                ? "bg-blue-50/50 dark:bg-blue-950/20"
                : idx % 2 === 0
                  ? "bg-background"
                  : "bg-muted/20";
              const stickyBg = isSelected
                ? "bg-blue-50 dark:bg-blue-950"
                : idx % 2 === 0
                  ? "bg-background"
                  : "bg-slate-50 dark:bg-slate-900";

              return (
                <tr key={e.id} className={rowBg}>
                  {/* Sticky Worker Name Column with Checkbox */}
                  <td
                    className={`border border-border px-3 py-1.5 font-semibold whitespace-nowrap name-col sticky left-0 z-10 ${stickyBg} shadow-[2px_0_4px_rgba(0,0,0,0.06)]`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectWorker(e.id)}
                        className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                      />
                      <span className="text-foreground">{e.full_name}</span>
                    </div>
                  </td>
                  <td className="border border-border px-2 py-1.5 text-muted-foreground whitespace-nowrap text-[11px]">
                    {e.role}
                  </td>
                  {dates.map((dd) => {
                    const cell = getCell(e.id, dd);
                    const sun = isSunday(dd);
                    const editable = editMode && cell !== "leave";
                    const cellProps = editable
                      ? {
                          onClick: () => handleCellClick(e.id, dd),
                          title: "Click: Absent (0) | Double-click: Present (1)",
                          style: { cursor: "pointer" },
                        }
                      : {};

                    if (cell === "present")
                      return (
                        <td
                          key={dd}
                          className={`border border-border text-center font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100/90 dark:bg-emerald-950/50 present ${editable ? "hover:brightness-90 select-none" : ""}`}
                          {...cellProps}
                        >
                          1
                        </td>
                      );
                    if (cell === "leave")
                      return (
                        <td
                          key={dd}
                          className="border border-border text-center font-bold text-amber-700 dark:text-amber-400 bg-yellow-100/90 dark:bg-yellow-950/50 leave"
                        >
                          *
                        </td>
                      );
                    if (cell === "absent")
                      return (
                        <td
                          key={dd}
                          className={`border border-border text-center font-semibold text-rose-600 dark:text-rose-400 bg-rose-100/80 dark:bg-rose-950/40 absent ${editable ? "hover:brightness-90 select-none" : ""}`}
                          {...cellProps}
                        >
                          -
                        </td>
                      );
                    // not marked
                    return (
                      <td
                        key={dd}
                        className={`border border-border text-center ${sun ? "bg-slate-100 dark:bg-slate-800/60" : ""} ${editable ? "hover:bg-amber-50/70 select-none" : ""}`}
                        {...cellProps}
                      />
                    );
                  })}
                  <td
                    className={`border border-border text-center font-bold px-2 total-col ${
                      tp >= totalDays * 0.9
                        ? "text-green-700 bg-green-50 dark:bg-green-950/40 dark:text-green-400"
                        : tp >= totalDays * 0.7
                          ? "text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400"
                          : "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {tp}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {sortedEmps.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 dark:bg-slate-900 font-bold border-t-2 border-border">
                <td className="border border-border px-3 py-1.5 font-bold sticky left-0 z-10 bg-slate-100 dark:bg-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                  Total Present
                </td>
                <td className="border border-border px-2 py-1.5 text-[10px] text-muted-foreground">
                  {sortedEmps.length} workers
                </td>
                {dates.map((dd) => {
                  const count = sortedEmps.filter((e) => getCell(e.id, dd) === "present").length;
                  return (
                    <td
                      key={dd}
                      className={`border border-border text-center font-bold ${
                        isSunday(dd)
                          ? "bg-slate-200 dark:bg-slate-800"
                          : count === 0
                            ? "text-muted-foreground"
                            : "text-green-700 dark:text-green-400"
                      }`}
                    >
                      {count > 0 ? count : ""}
                    </td>
                  );
                })}
                <td className="border border-border text-center font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                  {sortedEmps.reduce((sum, e) => sum + totalPresent(e.id), 0)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Daily Attendance Report ────────────────────────────────────────────────
function DailyReport({ date }: { date: string }) {
  const syncVersion = useCloudSync();
  const [revision, setRevision] = useState(0);
  const [selectedDailyIds, setSelectedDailyIds] = useState<Set<string>>(new Set());
  const [isDailySaving, setIsDailySaving] = useState(false);

  const emps = useMemo(
    () => getEmployees().filter((e) => e.active),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, revision, syncVersion],
  );
  const att = useMemo(
    () => getAttendanceForDate(date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, revision, syncVersion],
  );

  const summary = useMemo(() => {
    const m = new Map<string, (typeof att)[0]>();
    for (const a of att) {
      const prev = m.get(a.employee_id);
      if (!prev || a.status === "present" || a.status === "late") {
        m.set(a.employee_id, a);
      }
    }
    return {
      present: emps.filter((e) => ["present", "late"].includes(m.get(e.id)?.status ?? "")).length,
      absent: emps.filter((e) => !m.has(e.id) || m.get(e.id)?.status === "absent").length,
      late: emps.filter((e) => m.get(e.id)?.status === "late").length,
    };
  }, [emps, att]);

  const toggleDailyWorker = (id: string) => {
    setSelectedDailyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDailyAll = () => {
    if (selectedDailyIds.size === emps.length && emps.length > 0) {
      setSelectedDailyIds(new Set());
    } else {
      setSelectedDailyIds(new Set(emps.map((e) => e.id)));
    }
  };

  // Single row quick status update with instant Supabase save
  const handleSingleStatus = async (empId: string, status: "present" | "absent" | "late") => {
    const existing = att.find((a) => a.employee_id === empId);
    const record: AttendanceRecord = {
      id: existing?.id ?? newId(),
      employee_id: empId,
      date,
      shift: existing?.shift ?? "morning",
      status,
      in_time:
        existing?.in_time ??
        (status === "present" || status === "late" ? new Date().toISOString() : undefined),
      method: "manual",
      marked_by: "admin",
    };
    upsertAttendance(record);
    setRevision((r) => r + 1);
    toast.success(`Worker status updated to ${status} and saved to Supabase!`);
  };

  // Bulk status update with fast Supabase Sync
  const handleDailyBulkMark = async (status: "present" | "absent") => {
    const targetWorkers =
      selectedDailyIds.size > 0 ? emps.filter((e) => selectedDailyIds.has(e.id)) : emps;

    if (targetWorkers.length === 0) {
      toast.error("Koi worker select nahi hai");
      return;
    }

    setIsDailySaving(true);
    try {
      const recordsToUpsert: AttendanceRecord[] = targetWorkers.map((e) => {
        const existing = att.find((a) => a.employee_id === e.id);
        return {
          id: existing?.id ?? newId(),
          employee_id: e.id,
          date,
          shift: existing?.shift ?? "morning",
          status,
          in_time:
            existing?.in_time ?? (status === "present" ? new Date().toISOString() : undefined),
          method: "manual",
          marked_by: "admin",
        };
      });

      await upsertBulkAttendance(recordsToUpsert);
      setRevision((r) => r + 1);
      toast.success(
        `⚡ ${targetWorkers.length} workers ${status === "present" ? "Present" : "Absent"} mark ho gaye aur Supabase me save ho gaye!`,
      );
    } catch (err) {
      toast.error("Bulk save karne me error aaya");
    } finally {
      setIsDailySaving(false);
    }
  };

  const attFor = (id: string) => {
    const records = att.filter((r) => r.employee_id === id);
    return records.find((r) => r.status === "present" || r.status === "late") ?? records[0];
  };

  const download = () => {
    const rows = sortedEmps.map((e) => {
      const a = attFor(e.id);
      return {
        name: e.full_name,
        role: e.role,
        status: a?.status ?? "not marked",
        in_time: a?.in_time
          ? new Date(a.in_time).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        out_time: a?.out_time
          ? new Date(a.out_time).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        location_ok: a?.location_ok ? "Yes" : "No",
      };
    });
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = `attendance-${date}.csv`;
    a2.click();
    URL.revokeObjectURL(url);
  };

  const month = date.slice(0, 7);
  const salaries = getSalaries().filter((s) => s.month === month);
  const empMap = new Map(getEmployees().map((e) => [e.id, e.full_name]));
  const {
    sorted: sortedEmps,
    sort: dSort,
    toggle: dToggle,
  } = useSortable(emps, {
    name: (e) => e.full_name,
    role: (e) => e.role ?? "",
    status: (e) => attFor(e.id)?.status ?? "not marked",
    in: (e) => attFor(e.id)?.in_time ?? "",
    out: (e) => attFor(e.id)?.out_time ?? "",
    loc: (e) =>
      attFor(e.id)?.location_ok === true ? 1 : attFor(e.id)?.location_ok === false ? 0 : -1,
  });
  const {
    sorted: sortedSalaries,
    sort: sSort,
    toggle: sToggle,
  } = useSortable(salaries, {
    name: (r) => empMap.get(r.employee_id) ?? "",
    present: (r) => r.present_days,
    gross: (r) => r.gross,
    deductions: (r) => r.advance_deducted + r.leave_deduction + r.penalty,
    final: (r) => r.final_salary,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="size-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4 mr-1" /> Print
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Showing <b>{sortedEmps.length}</b> active workers for <b>{formatDayTitle(date)}</b>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center border-green-200 bg-green-50/40 dark:bg-green-950/20">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {summary.present}
          </div>
          <div className="text-xs font-semibold text-green-800 dark:text-green-300">Present</div>
        </Card>
        <Card className="p-4 text-center border-red-200 bg-red-50/40 dark:bg-red-950/20">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.absent}</div>
          <div className="text-xs font-semibold text-red-800 dark:text-red-300">Absent</div>
        </Card>
        <Card className="p-4 text-center border-amber-200 bg-amber-50/40 dark:bg-amber-950/20">
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {summary.late}
          </div>
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Late</div>
        </Card>
      </div>

      {/* Daily Bulk Action Bar */}
      <Card className="p-3 bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-white dark:from-slate-900 dark:to-slate-800 border border-blue-200/80 dark:border-slate-700 shadow-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleDailyAll}
              className="h-8 text-xs font-semibold"
            >
              {selectedDailyIds.size === sortedEmps.length && sortedEmps.length > 0 ? (
                <>
                  <CheckSquare className="size-3.5 mr-1.5 text-primary" /> Unselect All
                </>
              ) : (
                <>
                  <Square className="size-3.5 mr-1.5 text-muted-foreground" /> Select All (
                  {sortedEmps.length})
                </>
              )}
            </Button>
            {selectedDailyIds.size > 0 && (
              <Badge variant="default" className="bg-primary text-white font-bold">
                {selectedDailyIds.size} Selected
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              disabled={isDailySaving}
              onClick={() => handleDailyBulkMark("present")}
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs"
            >
              <CheckCircle2 className="size-3.5 mr-1.5" />
              {selectedDailyIds.size > 0
                ? `Mark Selected Present (${selectedDailyIds.size})`
                : "⚡ Sabhi ko Present Mark Karein"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isDailySaving}
              onClick={() => handleDailyBulkMark("absent")}
              className="h-8 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950 font-semibold text-xs"
            >
              <XCircle className="size-3.5 mr-1.5" />
              {selectedDailyIds.size > 0
                ? `Mark Selected Absent (${selectedDailyIds.size})`
                : "⚡ Sabhi ko Absent Mark Karein"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selectedDailyIds.size === sortedEmps.length && sortedEmps.length > 0}
                  onChange={toggleDailyAll}
                  className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                  title="Select All"
                />
              </TableHead>
              <SortHeader label="Worker Name" sortKey="name" sort={dSort} toggle={dToggle} />
              <SortHeader label="Role" sortKey="role" sort={dSort} toggle={dToggle} />
              <SortHeader label="Status" sortKey="status" sort={dSort} toggle={dToggle} />
              <TableHead>Quick Action (⚡ Sync)</TableHead>
              <SortHeader label="In" sortKey="in" sort={dSort} toggle={dToggle} />
              <SortHeader label="Out" sortKey="out" sort={dSort} toggle={dToggle} />
              <SortHeader label="Location" sortKey="loc" sort={dSort} toggle={dToggle} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEmps.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                  Koi active employee nahi hai
                </TableCell>
              </TableRow>
            )}
            {sortedEmps.map((e) => {
              const a = attFor(e.id);
              const isSelected = selectedDailyIds.has(e.id);

              return (
                <TableRow
                  key={e.id}
                  className={isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleDailyWorker(e.id)}
                      className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    />
                  </TableCell>
                  <TableCell className="font-semibold text-foreground">{e.full_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-medium">
                      {e.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        !a || a.status === "absent"
                          ? "destructive"
                          : a.status === "late"
                            ? "secondary"
                            : "default"
                      }
                      className="capitalize font-semibold"
                    >
                      {a?.status ?? "not marked"}
                    </Badge>
                  </TableCell>
                  {/* Quick Action Buttons per row */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={a?.status === "present" ? "default" : "outline"}
                        onClick={() => handleSingleStatus(e.id, "present")}
                        className={`h-7 px-2 text-[11px] font-bold ${
                          a?.status === "present"
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        }`}
                        title="Mark Present & Sync Supabase"
                      >
                        P
                      </Button>
                      <Button
                        size="sm"
                        variant={a?.status === "absent" ? "destructive" : "outline"}
                        onClick={() => handleSingleStatus(e.id, "absent")}
                        className={`h-7 px-2 text-[11px] font-bold ${
                          a?.status === "absent"
                            ? "bg-rose-600 hover:bg-rose-700 text-white"
                            : "text-rose-700 border-rose-300 hover:bg-rose-50"
                        }`}
                        title="Mark Absent & Sync Supabase"
                      >
                        A
                      </Button>
                      <Button
                        size="sm"
                        variant={a?.status === "late" ? "secondary" : "outline"}
                        onClick={() => handleSingleStatus(e.id, "late")}
                        className={`h-7 px-2 text-[11px] font-bold ${
                          a?.status === "late"
                            ? "bg-amber-500 text-white hover:bg-amber-600"
                            : "text-amber-700 border-amber-300 hover:bg-amber-50"
                        }`}
                        title="Mark Late & Sync Supabase"
                      >
                        L
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    {a?.in_time
                      ? new Date(a.in_time).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {a?.out_time
                      ? new Date(a.out_time).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {a?.location_ok === true
                      ? "✓ OK"
                      : a?.location_ok === false
                        ? "✗ Outside"
                        : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {salaries.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Monthly Salary — {month}</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Worker Name" sortKey="name" sort={sSort} toggle={sToggle} />
                  <SortHeader
                    label="Present"
                    sortKey="present"
                    sort={sSort}
                    toggle={sToggle}
                    className="text-right"
                    align="right"
                  />
                  <SortHeader
                    label="Gross (₹)"
                    sortKey="gross"
                    sort={sSort}
                    toggle={sToggle}
                    className="text-right"
                    align="right"
                  />
                  <SortHeader
                    label="Deductions (₹)"
                    sortKey="deductions"
                    sort={sSort}
                    toggle={sToggle}
                    className="text-right"
                    align="right"
                  />
                  <SortHeader
                    label="Final (₹)"
                    sortKey="final"
                    sort={sSort}
                    toggle={sToggle}
                    className="text-right font-bold"
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSalaries.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {empMap.get(s.employee_id) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.present_days}/{s.total_days}
                    </TableCell>
                    <TableCell className="text-right">₹{s.gross.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right text-red-600">
                      ₹
                      {(s.advance_deducted + s.leave_deduction + s.penalty).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right font-bold text-green-700">
                      ₹{s.final_salary.toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/30">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right">
                    ₹{salaries.reduce((s, r) => s + r.gross, 0).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right text-green-700">
                    ₹{salaries.reduce((s, r) => s + r.final_salary, 0).toLocaleString("en-IN")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Password Modal ─────────────────────────────────────────────────────────
function PasswordModal({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  const check = () => {
    const secret = (getSettings().admin_secret ?? "MANOJ").toUpperCase();
    const expected = todayDDMM_IST() + secret;
    if (pw.trim().toUpperCase() === expected) {
      onSuccess();
    } else {
      setError(true);
      setPw("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Lock className="size-5 text-amber-500" /> Edit Mode Unlock
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="size-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Wahi password jo Admin Login me lagta hai (DDMM + SECRET)
        </p>

        <Input
          type="password"
          placeholder="Aaj ka admin password…"
          value={pw}
          autoFocus
          onChange={(e) => {
            setPw(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && check()}
          className={error ? "border-red-500 focus-visible:ring-red-500" : ""}
        />
        {error && <p className="text-xs text-red-500">Galat password. Dobara try karein.</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={check}>
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 1-Year Worker Attendance View ──────────────────────────────────────────────
interface YearlyAttendanceReportProps {
  year: string;
  onSelectMonth: (month: string) => void;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function YearlyAttendanceReport({ year, onSelectMonth }: YearlyAttendanceReportProps) {
  const syncVersion = useCloudSync();
  const emps = useMemo(() => {
    void syncVersion;
    return getEmployees().filter((e) => e.active);
  }, [syncVersion]);
  const attendance = useMemo(() => {
    void syncVersion;
    return getAttendance();
  }, [syncVersion]);
  const leaves = useMemo(() => {
    void syncVersion;
    return getLeaves().filter((l) => l.status === "approved");
  }, [syncVersion]);

  // Compute 12-month data for each worker in the selected year
  const yearlyData = useMemo(() => {
    return emps.map((e) => {
      const monthStats = Array.from({ length: 12 }, (_, mIdx) => {
        const monthNum = pad2(mIdx + 1);
        const monthKey = `${year}-${monthNum}`;
        const totalDays = daysInMonthCount(monthKey);

        // Month attendance (deduplicated by date, shift-agnostic)
        const monthAtt = attendance.filter(
          (a) => a.employee_id === e.id && normalizeDate(a.date).startsWith(monthKey),
        );

        const dateMap = new Map<string, (typeof monthAtt)[0]>();
        for (const a of monthAtt) {
          const normD = normalizeDate(a.date);
          const prev = dateMap.get(normD);
          if (!prev || a.status === "present" || a.status === "late") {
            dateMap.set(normD, a);
          }
        }

        let presentCount = 0;
        let absentCount = 0;
        let lateCount = 0;

        for (const a of Array.from(dateMap.values())) {
          if (a.status === "present" || a.status === "late") {
            presentCount++;
            if (a.status === "late") lateCount++;
          } else if (a.status === "absent") {
            absentCount++;
          }
        }

        // Month leaves
        const monthStart = `${monthKey}-01`;
        const monthEnd = `${monthKey}-${pad2(totalDays)}`;
        const empLeaves = leaves.filter(
          (l) => l.employee_id === e.id && l.from_date <= monthEnd && l.to_date >= monthStart,
        );
        let leaveDays = 0;
        for (const l of empLeaves) {
          const from = new Date(l.from_date);
          const to = new Date(l.to_date);
          const s = new Date(Math.max(from.getTime(), new Date(monthStart).getTime()));
          const ed = new Date(Math.min(to.getTime(), new Date(monthEnd).getTime()));
          const days = Math.max(0, Math.round((ed.getTime() - s.getTime()) / 86400000) + 1);
          leaveDays += days;
        }

        return {
          monthKey,
          monthName: MONTH_NAMES[mIdx],
          present: presentCount,
          absent: absentCount,
          late: lateCount,
          leaves: leaveDays,
          totalDays,
        };
      });

      const totalYearPresent = monthStats.reduce((sum, m) => sum + m.present, 0);
      const totalYearAbsent = monthStats.reduce((sum, m) => sum + m.absent, 0);
      const totalYearLeaves = monthStats.reduce((sum, m) => sum + m.leaves, 0);
      const totalRecorded = totalYearPresent + totalYearAbsent;
      const attendancePercent =
        totalRecorded > 0 ? Math.round((totalYearPresent / totalRecorded) * 100) : 0;

      return {
        id: e.id,
        name: e.full_name,
        role: e.role ?? "",
        monthStats,
        totalYearPresent,
        totalYearAbsent,
        totalYearLeaves,
        attendancePercent,
      };
    });
  }, [emps, attendance, leaves, year]);

  // Sorting for Yearly Report
  const {
    sorted: sortedYearly,
    sort: ySort,
    toggle: yToggle,
  } = useSortable(yearlyData, {
    name: (r) => r.name,
    role: (r) => r.role,
    totalPresent: (r) => r.totalYearPresent,
    totalAbsent: (r) => r.totalYearAbsent,
    totalLeaves: (r) => r.totalYearLeaves,
    percent: (r) => r.attendancePercent,
  });

  // Overall Year Aggregates
  const companyTotalPresent = yearlyData.reduce((s, r) => s + r.totalYearPresent, 0);
  const companyTotalAbsent = yearlyData.reduce((s, r) => s + r.totalYearAbsent, 0);
  const companyAvgPercent =
    yearlyData.length > 0
      ? Math.round(yearlyData.reduce((s, r) => s + r.attendancePercent, 0) / yearlyData.length)
      : 0;

  // Export 1-Year Attendance CSV
  const downloadYearlyCSV = () => {
    const headers = [
      "Worker Name",
      "Role",
      ...MONTH_NAMES.map((m) => `${m} ${year} (Present)`),
      "Total Present (Year)",
      "Total Absent (Year)",
      "Total Leaves (Year)",
      "Attendance %",
    ];

    const rows = sortedYearly.map((r) => [
      r.name,
      r.role,
      ...r.monthStats.map((m) => String(m.present)),
      String(r.totalYearPresent),
      String(r.totalYearAbsent),
      String(r.totalYearLeaves),
      `${r.attendancePercent}%`,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_1year_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`1-Year Attendance report (${year}) CSV download ho gaya!`);
  };

  return (
    <div className="space-y-5">
      {/* Action Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadYearlyCSV}
            className="cursor-pointer"
          >
            <Download className="size-4 mr-1.5" /> 1-Year CSV Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="cursor-pointer"
          >
            <Printer className="size-4 mr-1.5" /> Print
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Showing 12-Month attendance for <b>{sortedYearly.length}</b> active workers in year{" "}
          <b>{year}</b>
        </div>
      </div>

      {/* Summary Cards for Year */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card className="p-4 text-center border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {sortedYearly.length}
          </div>
          <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
            Active Workers
          </div>
        </Card>
        <Card className="p-4 text-center border-green-200 bg-green-50/40 dark:bg-green-950/20">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {companyTotalPresent}
          </div>
          <div className="text-xs font-semibold text-green-800 dark:text-green-300">
            Total Present Marks
          </div>
        </Card>
        <Card className="p-4 text-center border-red-200 bg-red-50/40 dark:bg-red-950/20">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {companyTotalAbsent}
          </div>
          <div className="text-xs font-semibold text-red-800 dark:text-red-300">
            Total Absent Marks
          </div>
        </Card>
        <Card className="p-4 text-center border-purple-200 bg-purple-50/40 dark:bg-purple-950/20">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {companyAvgPercent}%
          </div>
          <div className="text-xs font-semibold text-purple-800 dark:text-purple-300">
            Avg Attendance Rate
          </div>
        </Card>
      </div>

      {/* Quick Month Selector Jump Bar */}
      <Card className="p-3 bg-muted/40 border border-border shadow-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Zap className="size-3.5 text-primary" /> Month Jump (Click to open detailed Monthly
            Matrix):
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {MONTH_NAMES.map((name, idx) => {
              const monthKey = `${year}-${pad2(idx + 1)}`;
              return (
                <Button
                  key={monthKey}
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectMonth(monthKey)}
                  className="h-7 px-2.5 text-xs font-medium hover:bg-primary hover:text-white transition-colors cursor-pointer"
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 1-Year Attendance Table */}
      <Card className="overflow-x-auto shadow-xs">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="bg-muted/70">
              <TableHead className="w-10 text-center font-bold">#</TableHead>
              <SortHeader
                label="Worker Name"
                sortKey="name"
                sort={ySort}
                toggle={yToggle}
                className="min-w-[140px]"
              />
              <SortHeader
                label="Role"
                sortKey="role"
                sort={ySort}
                toggle={yToggle}
                className="min-w-[90px]"
              />
              {MONTH_NAMES.map((m, idx) => (
                <TableHead
                  key={m}
                  className="text-center font-bold px-1 cursor-pointer hover:text-primary transition-colors"
                  title={`Open ${m} ${year} Monthly Matrix`}
                  onClick={() => onSelectMonth(`${year}-${pad2(idx + 1)}`)}
                >
                  {m}
                </TableHead>
              ))}
              <SortHeader
                label="Total P"
                sortKey="totalPresent"
                sort={ySort}
                toggle={yToggle}
                className="text-center font-bold text-green-700 bg-green-50/50 dark:bg-green-950/20"
                align="center"
              />
              <SortHeader
                label="Total A"
                sortKey="totalAbsent"
                sort={ySort}
                toggle={yToggle}
                className="text-center font-bold text-red-700 bg-red-50/50 dark:bg-red-950/20"
                align="center"
              />
              <SortHeader
                label="Leaves"
                sortKey="totalLeaves"
                sort={ySort}
                toggle={yToggle}
                className="text-center font-bold text-amber-700"
                align="center"
              />
              <SortHeader
                label="%"
                sortKey="percent"
                sort={ySort}
                toggle={yToggle}
                className="text-center font-bold"
                align="center"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedYearly.length === 0 && (
              <TableRow>
                <TableCell colSpan={17} className="text-center py-8 text-muted-foreground">
                  Koi active worker nahi mila
                </TableCell>
              </TableRow>
            )}
            {sortedYearly.map((r, idx) => (
              <TableRow key={r.id} className="hover:bg-muted/40 transition-colors">
                <TableCell className="text-center font-medium text-muted-foreground">
                  {idx + 1}
                </TableCell>
                <TableCell className="font-semibold text-foreground whitespace-nowrap">
                  {r.name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant="secondary" className="text-[11px] font-normal">
                    {r.role}
                  </Badge>
                </TableCell>
                {r.monthStats.map((m) => (
                  <TableCell
                    key={m.monthKey}
                    className="text-center px-1 cursor-pointer hover:bg-primary/10 transition-colors"
                    onClick={() => onSelectMonth(m.monthKey)}
                    title={`${r.name} - ${m.monthName} ${year}: ${m.present} Present, ${m.absent} Absent. Click to view Monthly Matrix`}
                  >
                    {m.present > 0 ? (
                      <span className="inline-block px-1.5 py-0.5 rounded font-bold text-[11px] bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                        {m.present}
                      </span>
                    ) : m.absent > 0 ? (
                      <span className="inline-block px-1.5 py-0.5 rounded font-medium text-[11px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        0
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-[11px]">—</span>
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-center font-bold text-green-700 dark:text-green-400 bg-green-50/30 dark:bg-green-950/10">
                  {r.totalYearPresent}
                </TableCell>
                <TableCell className="text-center font-bold text-red-600 dark:text-red-400 bg-red-50/30 dark:bg-red-950/10">
                  {r.totalYearAbsent}
                </TableCell>
                <TableCell className="text-center font-medium text-amber-700 dark:text-amber-400">
                  {r.totalYearLeaves}
                </TableCell>
                <TableCell className="text-center font-bold">
                  <Badge
                    variant={
                      r.attendancePercent >= 80
                        ? "default"
                        : r.attendancePercent >= 60
                          ? "secondary"
                          : "destructive"
                    }
                    className="text-[10px] px-1.5 py-0"
                  >
                    {r.attendancePercent}%
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
function ReportsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const currentYear = String(now.getFullYear());
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const [tab, setTab] = useState<"matrix" | "yearly" | "daily">("matrix");
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [date, setDate] = useState(todayStr);
  const [editMode, setEditMode] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleEditToggle = () => {
    if (editMode) {
      setEditMode(false);
    } else {
      setShowPasswordModal(true);
    }
  };

  const handleSelectMonthFromYearly = (m: string) => {
    setMonth(m);
    setTab("matrix");
    toast.info(`Switched to Monthly Matrix: ${formatMonthTitle(m)}`);
  };

  return (
    <div className="p-6 space-y-4">
      {showPasswordModal && (
        <PasswordModal
          onSuccess={() => {
            setEditMode(true);
            setShowPasswordModal(false);
          }}
          onClose={() => setShowPasswordModal(false)}
        />
      )}

      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports &amp; Attendance Analysis</h1>
        <p className="text-sm text-muted-foreground">
          1-Year worker attendance overview, monthly matrix &amp; daily sync logs
        </p>
      </div>

      {/* ── STICKY DATE & CONTROLS HEADER (Sticks to top on scroll) ── */}
      <div className="sticky top-11 z-30 bg-background/95 backdrop-blur-md -mx-6 px-6 py-2.5 border-b shadow-xs space-y-2.5">
        {/* Tab switcher & Edit Mode button */}
        <div className="flex gap-2 border-b border-border/60 pb-0 items-end flex-wrap">
          <button
            onClick={() => setTab("matrix")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              tab === "matrix"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="size-4" /> Monthly Matrix
          </button>
          <button
            onClick={() => setTab("yearly")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              tab === "yearly"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Calendar className="size-4" /> 1-Year Attendance
          </button>
          <button
            onClick={() => setTab("daily")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              tab === "daily"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardList className="size-4" /> Daily Report
          </button>

          {/* Edit mode toggle — only on monthly matrix */}
          {tab === "matrix" && (
            <button
              onClick={handleEditToggle}
              className={`ml-auto mb-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                editMode
                  ? "bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200"
                  : "bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {editMode ? (
                <>
                  <Unlock className="size-3.5" /> Edit Mode ON
                </>
              ) : (
                <>
                  <Lock className="size-3.5" /> Edit Mode
                </>
              )}
            </button>
          )}
        </div>

        {/* ── Sticky Date Navigator Toolbar ── */}
        {tab === "matrix" ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Calendar className="size-3.5 text-primary" /> Month:
              </span>
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setMonth((m) => shiftMonth(m, -1))}
                  title="Previous Month"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-36 h-7 text-xs bg-background font-medium"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setMonth((m) => shiftMonth(m, 1))}
                  title="Next Month"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              {month !== currentMonth && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 cursor-pointer"
                  onClick={() => setMonth(currentMonth)}
                >
                  <RotateCcw className="size-3 mr-1" /> This Month
                </Button>
              )}
              <span className="text-sm font-bold text-foreground ml-1">
                {formatMonthTitle(month)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">Always visible while scrolling</div>
          </div>
        ) : tab === "yearly" ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Calendar className="size-3.5 text-primary" /> Year:
              </span>
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setYear((y) => String(Number(y) - 1))}
                  title="Previous Year"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-7 px-2 text-xs bg-background rounded border border-input font-bold"
                >
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="2028">2028</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setYear((y) => String(Number(y) + 1))}
                  title="Next Year"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              {year !== currentYear && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 cursor-pointer"
                  onClick={() => setYear(currentYear)}
                >
                  <RotateCcw className="size-3 mr-1" /> This Year ({currentYear})
                </Button>
              )}
              <span className="text-sm font-bold text-foreground ml-1">Year {year} Overview</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Month-wise worker attendance for 1 Year
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Calendar className="size-3.5 text-primary" /> Date:
              </span>
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setDate((d) => shiftDate(d, -1))}
                  title="Previous Day"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-36 h-7 text-xs bg-background font-medium"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 h-7 w-7 cursor-pointer"
                  onClick={() => setDate((d) => shiftDate(d, 1))}
                  title="Next Day"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              {date !== todayStr && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 cursor-pointer"
                  onClick={() => setDate(todayStr)}
                >
                  <RotateCcw className="size-3 mr-1" /> Today
                </Button>
              )}
              <span className="text-sm font-bold text-foreground ml-1">{formatDayTitle(date)}</span>
            </div>
            <div className="text-xs text-muted-foreground">Always visible while scrolling</div>
          </div>
        )}
      </div>

      {/* Monthly Matrix View */}
      {tab === "matrix" && <MonthlyMatrix month={month} editMode={editMode} />}

      {/* 1-Year Attendance View */}
      {tab === "yearly" && (
        <YearlyAttendanceReport year={year} onSelectMonth={handleSelectMonthFromYearly} />
      )}

      {/* Daily Report View */}
      {tab === "daily" && <DailyReport date={date} />}
    </div>
  );
}
