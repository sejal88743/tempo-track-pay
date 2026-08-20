import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  XCircle,
  Clock3,
  MapPin,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Search,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import {
  getEmployees,
  getAttendanceForDate,
  upsertAttendance,
  getAttendance,
  getSettings,
  newId,
  normalizeDate,
  useCloudSync,
  type Employee,
  type AttendanceRecord,
} from "@/lib/store";
import { applySundayRule, isSunday, isMonday } from "@/lib/auto-attendance";

export const Route = createFileRoute("/_admin/attendance")({ component: AttendancePage });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function stepDate(date: string, days: number) {
  const norm = normalizeDate(date) || todayISO();
  const d = new Date(norm + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function AttendancePage() {
  useCloudSync();
  const [date, setDate] = useState(todayISO());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attRecords, setAttRecords] = useState<AttendanceRecord[]>([]);
  const [nameSearch, setNameSearch] = useState("");
  const settings = getSettings();
  const eveningEnabled = settings.evening_enabled ?? false;
  const [shift, setShift] = useState<"morning" | "evening">("morning");

  const normalizedCurrentDate = normalizeDate(date) || todayISO();
  const isSelectedSunday = isSunday(normalizedCurrentDate);
  const isSelectedMonday = isMonday(normalizedCurrentDate);

  const reload = () => {
    const norm = normalizeDate(date) || todayISO();
    const allEmps = getEmployees();
    const records = getAttendanceForDate(norm);
    const empIdsWithRecord = new Set(records.map((r) => r.employee_id));
    // Include all active employees PLUS any employee who has an attendance record on this date
    const empsToShow = allEmps.filter((e) => e.active || empIdsWithRecord.has(e.id));
    setEmployees(empsToShow);
    setAttRecords(records);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const attMap = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    attRecords.filter((r) => r.shift === shift).forEach((r) => m.set(r.employee_id, r));
    return m;
  }, [attRecords, shift]);

  const update = (employee_id: string, patch: Partial<AttendanceRecord>) => {
    const norm = normalizeDate(date) || todayISO();
    const cur = attMap.get(employee_id) ?? {
      id: newId(),
      employee_id,
      date: norm,
      shift,
      status: "present" as const,
    };
    const next = {
      ...cur,
      ...patch,
      date: norm,
      method: patch.method ?? "manual",
    } as AttendanceRecord;
    upsertAttendance(next);
    reload();
  };

  const markAllPresent = () => {
    const norm = normalizeDate(date) || todayISO();
    employees.forEach((e) => {
      if (!attMap.has(e.id)) {
        upsertAttendance({
          id: newId(),
          employee_id: e.id,
          date: norm,
          shift,
          status: "present",
          method: "manual",
        });
      }
    });
    reload();
    toast.success("Sabhi ko present mark kiya");
  };

  const markAllAbsent = () => {
    if (!confirm(`Sabhi ko ABSENT mark karein?`)) return;
    const norm = normalizeDate(date) || todayISO();
    employees.forEach((e) => {
      const cur = attMap.get(e.id);
      upsertAttendance({
        id: cur?.id ?? newId(),
        employee_id: e.id,
        date: norm,
        shift,
        status: "absent",
        method: "manual",
        daily_salary_override: cur?.daily_salary_override,
      });
    });
    reload();
    toast.success("Sabhi absent mark ho gaye");
  };

  const runSundayRuleAction = () => {
    const norm = normalizeDate(date) || todayISO();
    if (!isSunday(norm)) {
      toast.error("Selected date Sunday (Itwar) honi chahiye.");
      return;
    }
    const updated = applySundayRule(norm, true);
    reload();
    toast.success(
      `Sunday Rule update complete! (${updated} workers ka Sunday status Sat + Mon ke hisab se set hua)`,
    );
  };

  const filteredEmployees = useMemo(
    () =>
      nameSearch.trim()
        ? employees.filter((e) =>
            e.full_name.toLowerCase().includes(nameSearch.trim().toLowerCase()),
          )
        : employees,
    [employees, nameSearch],
  );

  const presentCount = Array.from(attMap.values()).filter((r) =>
    ["present", "late"].includes(r.status),
  ).length;
  const absentCount = Array.from(attMap.values()).filter((r) => r.status === "absent").length;
  const notMarked = employees.length - attMap.size;

  const dateObj = new Date(normalizedCurrentDate + "T00:00:00Z");
  const dateLabel = dateObj.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
          <div className="flex gap-3 text-sm mt-0.5">
            <span className="text-green-600 font-medium">✅ Present: {presentCount}</span>
            <span className="text-red-500 font-medium">❌ Absent: {absentCount}</span>
            {notMarked > 0 && (
              <span className="text-muted-foreground">⬜ Unmarked: {notMarked}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Button size="sm" variant="outline" onClick={markAllPresent}>
            <CheckCircle2 className="size-3.5 mr-1 text-green-600" /> Sab Present
          </Button>
          <Button size="sm" variant="outline" onClick={markAllAbsent}>
            <XCircle className="size-3.5 mr-1 text-red-500" /> Sab Absent
          </Button>
          <Button
            size="sm"
            variant={isSelectedSunday ? "default" : "outline"}
            onClick={runSundayRuleAction}
            title="Saniwar + Somwar check karke Sunday update karein"
          >
            <Sparkles className="size-3.5 mr-1" /> Sunday Rule Check
          </Button>
        </div>
      </div>

      {/* Info notice for Sunday / Monday automatic rules */}
      {isSelectedSunday && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-blue-600 shrink-0" />
            <span>
              <strong>Sunday Rule:</strong> Saniwar aur Somwar dono din Present hone par Sunday auto
              Present hota hai. Kisi ek din bhi Absent hone par Sunday Absent hota hai.
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={runSundayRuleAction}
          >
            Apply Now
          </Button>
        </div>
      )}

      {isSelectedMonday && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-1.5">
          <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Somwar (Monday):</strong> Somwar ko attendance lagte hi pichhle Saniwar ka check
            karke Itwar (Sunday) ki attendance automatic add/update ho jaati hai!
          </span>
        </div>
      )}

      {/* Name search & Quick dates */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Worker ka naam khojein (e.g. Magan)…"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Quick Date:</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            onClick={() => setDate("2026-08-01")}
          >
            01/08/26 (Sat)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            onClick={() => setDate("2026-08-02")}
          >
            02/08/26 (Sun)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            onClick={() => setDate("2026-08-03")}
          >
            03/08/26 (Mon)
          </Button>
        </div>
      </div>

      {/* Date selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          onClick={() => setDate(stepDate(date, -1))}
          title="Pichhla din"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="relative">
          <Input
            type="date"
            value={normalizedCurrentDate}
            onChange={(e) => setDate(e.target.value)}
            className="w-40 h-8 text-sm"
          />
        </div>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          onClick={() => setDate(stepDate(date, 1))}
          title="Agla din"
        >
          <ChevronRight className="size-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">{dateLabel}</span>
        {normalizedCurrentDate !== todayISO() && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 ml-1"
            onClick={() => setDate(todayISO())}
          >
            <Calendar className="size-3 mr-1" /> Aaj
          </Button>
        )}

        {/* Shift toggle */}
        {eveningEnabled && (
          <div className="flex gap-1 ml-2">
            {(["morning", "evening"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShift(s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
                  shift === s
                    ? "bg-primary text-white border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {s === "morning" ? "🌅 Morning" : "🌙 Evening"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">Worker Name</TableHead>
              <TableHead className="min-w-[110px]">Role</TableHead>
              <TableHead className="min-w-[160px]">Attendance</TableHead>
              <TableHead className="min-w-[100px]">Method / Note</TableHead>
              <TableHead className="min-w-[110px]">In Time</TableHead>
              <TableHead className="min-w-[110px]">Out Time</TableHead>
              <TableHead className="min-w-[80px]">Location</TableHead>
              <TableHead
                className="min-w-[100px]"
                title="Us din ki salary (agar blank to monthly se calculate hogi)"
              >
                RS (Daily)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.map((e) => {
              const a = attMap.get(e.id);
              const status = a?.status;
              const isAutoSunday = a?.method === "auto-sunday";
              const isAutoAbsent = a?.method === "auto-absent";

              return (
                <TableRow key={e.id} className={!status ? "bg-muted/20" : ""}>
                  {/* Name */}
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-1.5">
                      <span>{e.full_name}</span>
                      {!e.active && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground px-1 py-0"
                        >
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Role */}
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {e.role}
                    </Badge>
                  </TableCell>

                  {/* Attendance icons */}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        title="Present"
                        onClick={() =>
                          update(e.id, {
                            status: "present",
                            in_time: a?.in_time ?? new Date().toISOString(),
                            method: "manual",
                          })
                        }
                        className={`p-1.5 rounded-lg transition-all ${
                          status === "present"
                            ? "bg-green-500 text-white shadow"
                            : "text-muted-foreground hover:bg-green-100 hover:text-green-600"
                        }`}
                      >
                        <CheckCircle2 className="size-4" />
                      </button>
                      <button
                        title="Late"
                        onClick={() =>
                          update(e.id, {
                            status: "late",
                            in_time: a?.in_time ?? new Date().toISOString(),
                            method: "manual",
                          })
                        }
                        className={`p-1.5 rounded-lg transition-all ${
                          status === "late"
                            ? "bg-amber-500 text-white shadow"
                            : "text-muted-foreground hover:bg-amber-100 hover:text-amber-600"
                        }`}
                      >
                        <Clock3 className="size-4" />
                      </button>
                      <button
                        title="Absent"
                        onClick={() => update(e.id, { status: "absent", method: "manual" })}
                        className={`p-1.5 rounded-lg transition-all ${
                          status === "absent"
                            ? "bg-red-500 text-white shadow"
                            : "text-muted-foreground hover:bg-red-100 hover:text-red-600"
                        }`}
                      >
                        <XCircle className="size-4" />
                      </button>
                      {status && (
                        <span
                          className={`text-xs font-medium ml-1 ${
                            status === "present"
                              ? "text-green-600"
                              : status === "late"
                                ? "text-amber-600"
                                : "text-red-500"
                          }`}
                        >
                          {status === "present" ? "Present" : status === "late" ? "Late" : "Absent"}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Method / Auto badge */}
                  <TableCell>
                    {isAutoSunday ? (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          status === "present"
                            ? "border-green-400 text-green-700 bg-green-50"
                            : "border-red-300 text-red-600 bg-red-50"
                        }`}
                      >
                        ✨ Auto Sunday
                      </Badge>
                    ) : isAutoAbsent ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Auto 7PM
                      </Badge>
                    ) : a?.method === "face" ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-blue-600 border-blue-200"
                      >
                        Face
                      </Badge>
                    ) : a?.method === "fingerprint" ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-purple-600 border-purple-200"
                      >
                        Biometric
                      </Badge>
                    ) : status ? (
                      <span className="text-xs text-muted-foreground">Manual</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* In Time */}
                  <TableCell>
                    <Input
                      type="time"
                      className="w-28 h-7 text-xs"
                      value={a?.in_time ? new Date(a.in_time).toTimeString().slice(0, 5) : ""}
                      onChange={(ev) => {
                        if (!ev.target.value) return;
                        const [h, m] = ev.target.value.split(":").map(Number);
                        const d = new Date(normalizedCurrentDate + "T00:00:00Z");
                        d.setUTCHours(h, m, 0, 0);
                        update(e.id, { status: a?.status ?? "present", in_time: d.toISOString() });
                      }}
                    />
                  </TableCell>

                  {/* Out Time */}
                  <TableCell>
                    <Input
                      type="time"
                      className="w-28 h-7 text-xs"
                      value={a?.out_time ? new Date(a.out_time).toTimeString().slice(0, 5) : ""}
                      onChange={(ev) => {
                        if (!ev.target.value) return;
                        const [h, m] = ev.target.value.split(":").map(Number);
                        const d = new Date(normalizedCurrentDate + "T00:00:00Z");
                        d.setUTCHours(h, m, 0, 0);
                        update(e.id, { status: a?.status ?? "present", out_time: d.toISOString() });
                      }}
                    />
                  </TableCell>

                  {/* Location */}
                  <TableCell>
                    {a?.location_ok === true ? (
                      <span className="text-green-600 text-xs flex items-center gap-0.5">
                        <MapPin className="size-3" /> OK
                      </span>
                    ) : a?.location_ok === false ? (
                      <span className="text-red-500 text-xs flex items-center gap-0.5">
                        <MapPin className="size-3" /> Outside
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>

                  {/* RS - Daily Salary Override */}
                  <TableCell>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Auto"
                        className="pl-5 w-24 h-7 text-xs"
                        value={a?.daily_salary_override ?? ""}
                        onChange={(ev) => {
                          const val = ev.target.value === "" ? undefined : Number(ev.target.value);
                          update(e.id, {
                            status: a?.status ?? "present",
                            daily_salary_override: val,
                          });
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  Koi employee nahi mila. Employees page se worker add karein.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Legend */}
      <div className="text-xs text-muted-foreground flex gap-4 flex-wrap items-center">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="size-3 text-green-500" /> Present
        </span>
        <span className="flex items-center gap-1">
          <Clock3 className="size-3 text-amber-500" /> Late
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="size-3 text-red-500" /> Absent
        </span>
        <span className="flex items-center gap-1">
          <Badge
            variant="outline"
            className="text-[10px] text-green-700 bg-green-50 border-green-300"
          >
            ✨ Auto Sunday
          </Badge>
          = Saniwar + Somwar dono Present hone par Sunday auto Present
        </span>
      </div>
    </div>
  );
}
