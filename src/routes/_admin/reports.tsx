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
} from "lucide-react";
import {
  getEmployees,
  getAttendance,
  getLeaves,
  getAttendanceForDate,
  getSalaries,
  getSettings,
  upsertAttendance,
  todayDDMM_IST,
  newId,
  normalizeDate,
  useCloudSync,
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

// ── Monthly Attendance Matrix ──────────────────────────────────────────────
function MonthlyMatrix({ month, editMode }: { month: string; editMode: boolean }) {
  const tableRef = useRef<HTMLDivElement>(null);
  // Incremented on every cell edit so useMemo re-runs and the table refreshes
  const [revision, setRevision] = useState(0);
  // Timer ref for distinguishing single-click vs double-click
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // month is intentionally in deps to refresh employee list on month change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const emps = useMemo(() => getEmployees().filter((e) => e.active), [month]);
  const totalDays = useMemo(() => daysInMonthCount(month), [month]);
  const dates = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => pad2(i + 1)),
    [totalDays],
  );

  // Build attendance lookup: empId -> dateStr -> status
  const attMap = useMemo(() => {
    const all = getAttendance().filter(
      (a) => normalizeDate(a.date).startsWith(month) && a.shift === "morning",
    );
    const m = new Map<string, Map<string, string>>();
    for (const a of all) {
      const normDate = normalizeDate(a.date);
      const dd = normDate.slice(8, 10);
      if (!m.has(a.employee_id)) m.set(a.employee_id, new Map());
      m.get(a.employee_id)!.set(dd, a.status);
    }
    return m;
    // revision is intentionally in deps to force re-read on edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, revision]);

  // Build leave lookup: empId -> Set of date strings (dd) in this month
  const leaveMap = useMemo(() => {
    const monthStart = `${month}-01`;
    const [y, mo] = month.split("-").map(Number);
    const monthEnd = new Date(y, mo, 0).toISOString().slice(0, 10);
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

  // Write a cell directly to the attendance store
  const markCell = useCallback(
    (empId: string, dd: string, status: "present" | "absent") => {
      const dateStr = `${month}-${dd}`;
      const all = getAttendance();
      const existing = all.find(
        (a) => a.employee_id === empId && a.date === dateStr && a.shift === "morning",
      );
      upsertAttendance({
        id: existing?.id ?? newId(),
        employee_id: empId,
        date: dateStr,
        shift: "morning",
        status,
        in_time: existing?.in_time ?? (status === "present" ? new Date().toISOString() : undefined),
        method: "manual",
        marked_by: "admin",
      });
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

  // CSV export
  const downloadCSV = () => {
    const header = [
      "Worker Name",
      "Role",
      ...dates.map((d) => `${d}/${month.slice(5, 7)}`),
      "Total Present",
    ];
    const rows = emps.map((e) => {
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
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={downloadCSV}>
          <Download className="size-3.5 mr-1" /> CSV Export
        </Button>
        <Button variant="outline" size="sm" onClick={printMatrix}>
          <Printer className="size-3.5 mr-1" /> Print
        </Button>
        {editMode && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs px-3 py-1.5 rounded-lg ml-auto">
            <Pencil className="size-3" />
            <span>
              Edit Mode ON — Single click = Absent (0) &nbsp;|&nbsp; Double click = Present (1)
            </span>
          </div>
        )}
        {!editMode && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto">
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

      <div ref={tableRef} className="overflow-x-auto rounded-md border">
        <table className="border-collapse text-xs min-w-max w-full">
          <thead>
            {/* Day-of-week row */}
            <tr className="bg-muted/50">
              <th className="border border-border px-3 py-1.5 text-left font-semibold whitespace-nowrap min-w-[130px]">
                Worker Name
              </th>
              <th className="border border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap min-w-[90px]">
                Role
              </th>
              {dates.map((dd) => (
                <th
                  key={dd}
                  className={`border border-border px-1.5 py-1 font-medium w-7 ${
                    isSunday(dd) ? "bg-slate-200 text-slate-500" : "text-muted-foreground"
                  }`}
                >
                  {dayLabel(dd)}
                </th>
              ))}
              <th className="border border-border px-2 py-1.5 font-bold text-blue-700 bg-blue-50 whitespace-nowrap">
                Total
              </th>
            </tr>
            {/* Date number row */}
            <tr className="bg-muted">
              <th className="border border-border px-3 py-1 text-left text-[10px] text-muted-foreground">
                Date →
              </th>
              <th className="border border-border px-2 py-1 text-left text-[10px] text-muted-foreground">
                {month}
              </th>
              {dates.map((dd) => (
                <th
                  key={dd}
                  className={`border border-border px-1.5 py-1 font-bold text-center ${
                    isSunday(dd) ? "bg-slate-200 text-slate-500" : ""
                  }`}
                >
                  {dd}
                </th>
              ))}
              <th className="border border-border px-2 py-1 font-bold bg-blue-50 text-blue-700">
                /{totalDays}
              </th>
            </tr>
          </thead>
          <tbody>
            {emps.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + 3}
                  className="text-center py-6 text-muted-foreground border border-border"
                >
                  Koi active employee nahi hai
                </td>
              </tr>
            )}
            {emps.map((e, idx) => {
              const tp = totalPresent(e.id);
              return (
                <tr key={e.id} className={idx % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                  <td className="border border-border px-3 py-1.5 font-semibold whitespace-nowrap name-col">
                    {e.full_name}
                  </td>
                  <td className="border border-border px-2 py-1.5 text-muted-foreground whitespace-nowrap text-[10px]">
                    {e.role}
                  </td>
                  {dates.map((dd) => {
                    const cell = getCell(e.id, dd);
                    const sun = isSunday(dd);
                    const editable = editMode && cell !== "leave";
                    const cellProps = editable
                      ? {
                          onClick: () => handleCellClick(e.id, dd),
                          title: "Click: Absent | Double-click: Present",
                          style: { cursor: "pointer" },
                        }
                      : {};

                    if (cell === "present")
                      return (
                        <td
                          key={dd}
                          className={`border border-border text-center font-bold text-green-700 bg-green-100 present ${editable ? "hover:brightness-90 select-none" : ""}`}
                          {...cellProps}
                        >
                          1
                        </td>
                      );
                    if (cell === "leave")
                      return (
                        <td
                          key={dd}
                          className="border border-border text-center font-bold text-amber-700 bg-yellow-100 leave"
                        >
                          *
                        </td>
                      );
                    if (cell === "absent")
                      return (
                        <td
                          key={dd}
                          className={`border border-border text-center text-red-500 bg-red-50 absent ${editable ? "hover:brightness-90 select-none" : ""}`}
                          {...cellProps}
                        >
                          -
                        </td>
                      );
                    // not marked
                    return (
                      <td
                        key={dd}
                        className={`border border-border text-center ${sun ? "bg-slate-100" : ""} ${editable ? "hover:bg-orange-50 select-none" : ""}`}
                        {...cellProps}
                      />
                    );
                  })}
                  <td
                    className={`border border-border text-center font-bold px-2 total-col ${
                      tp >= totalDays * 0.9
                        ? "text-green-700 bg-green-50"
                        : tp >= totalDays * 0.7
                          ? "text-blue-700 bg-blue-50"
                          : "text-red-700 bg-red-50"
                    }`}
                  >
                    {tp}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {emps.length > 0 && (
            <tfoot>
              <tr className="bg-muted font-bold">
                <td className="border border-border px-3 py-1.5 font-bold">Total Present</td>
                <td className="border border-border px-2 py-1.5 text-[10px] text-muted-foreground">
                  {emps.length} workers
                </td>
                {dates.map((dd) => {
                  const count = emps.filter((e) => getCell(e.id, dd) === "present").length;
                  return (
                    <td
                      key={dd}
                      className={`border border-border text-center font-bold ${
                        isSunday(dd)
                          ? "bg-slate-200"
                          : count === 0
                            ? "text-muted-foreground"
                            : "text-green-700"
                      }`}
                    >
                      {count > 0 ? count : ""}
                    </td>
                  );
                })}
                <td className="border border-border text-center font-bold bg-blue-100 text-blue-700">
                  {emps.reduce((sum, e) => sum + totalPresent(e.id), 0)}
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
function DailyReport() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const emps = getEmployees().filter((e) => e.active);
  const att = getAttendanceForDate(date);

  const summary = useMemo(() => {
    const m = new Map(att.filter((a) => a.shift === "morning").map((a) => [a.employee_id, a]));
    return {
      present: emps.filter((e) => ["present", "late"].includes(m.get(e.id)?.status ?? "")).length,
      absent: emps.filter((e) => !m.has(e.id) || m.get(e.id)?.status === "absent").length,
      late: emps.filter((e) => m.get(e.id)?.status === "late").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, emps.length]);

  const download = () => {
    const rows = emps.map((e) => {
      const a = att.find((r) => r.employee_id === e.id && r.shift === "morning");
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

  const attFor = (id: string) => att.find((r) => r.employee_id === id && r.shift === "morning");
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
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </div>
        <Button variant="outline" onClick={download}>
          <Download className="size-4 mr-1" /> CSV
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4 mr-1" /> Print
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{summary.present}</div>
          <div className="text-sm text-muted-foreground">Present</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{summary.absent}</div>
          <div className="text-sm text-muted-foreground">Absent</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{summary.late}</div>
          <div className="text-sm text-muted-foreground">Late</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Name" sortKey="name" sort={dSort} toggle={dToggle} />
              <SortHeader label="Role" sortKey="role" sort={dSort} toggle={dToggle} />
              <SortHeader label="Status" sortKey="status" sort={dSort} toggle={dToggle} />
              <SortHeader label="In" sortKey="in" sort={dSort} toggle={dToggle} />
              <SortHeader label="Out" sortKey="out" sort={dSort} toggle={dToggle} />
              <SortHeader label="Location" sortKey="loc" sort={dSort} toggle={dToggle} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEmps.map((e) => {
              const a = att.find((r) => r.employee_id === e.id && r.shift === "morning");
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
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
                      className="capitalize"
                    >
                      {a?.status ?? "not marked"}
                    </Badge>
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
                  <SortHeader label="Name" sortKey="name" sort={sSort} toggle={sToggle} />
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

// ── Main Page ──────────────────────────────────────────────────────────────
function ReportsPage() {
  useCloudSync();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const [tab, setTab] = useState<"matrix" | "daily">("matrix");
  const [month, setMonth] = useState(currentMonth);
  const [editMode, setEditMode] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleEditToggle = () => {
    if (editMode) {
      setEditMode(false);
    } else {
      setShowPasswordModal(true);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {showPasswordModal && (
        <PasswordModal
          onSuccess={() => {
            setEditMode(true);
            setShowPasswordModal(false);
          }}
          onClose={() => setShowPasswordModal(false)}
        />
      )}

      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Monthly attendance matrix &amp; daily summary
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 border-b pb-0 items-end">
        <button
          onClick={() => setTab("matrix")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "matrix"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarDays className="size-4" /> Monthly Matrix
        </button>
        <button
          onClick={() => setTab("daily")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
            className={`ml-auto mb-0.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
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

      {/* Monthly Matrix */}
      {tab === "matrix" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Month</label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="mt-5 text-sm text-muted-foreground">
              {(() => {
                const [y, m] = month.split("-").map(Number);
                return new Date(y, m - 1, 1).toLocaleString("en-IN", {
                  month: "long",
                  year: "numeric",
                });
              })()}
            </div>
          </div>
          <MonthlyMatrix month={month} editMode={editMode} />
        </div>
      )}

      {/* Daily Report */}
      {tab === "daily" && <DailyReport />}
    </div>
  );
}
