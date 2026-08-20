import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import {
  Users,
  CheckCircle2,
  XCircle,
  Truck,
  BadgeIndianRupee,
  CalendarOff,
  Fingerprint,
} from "lucide-react";
import { getEmployees, getAttendance, getAdvances, getLeaves, todayString } from "@/lib/store";

export const Route = createFileRoute("/_admin/dashboard")({ component: Dashboard });

function Stat({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tone?: "primary" | "success" | "destructive" | "warning";
}) {
  const cls = {
    primary: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600",
    destructive: "bg-red-500/10 text-red-600",
    warning: "bg-amber-500/10 text-amber-600",
  }[tone];
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className={`size-12 rounded-xl flex items-center justify-center ${cls}`}>
        <Icon className="size-6" />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

function Dashboard() {
  const [counts, setCounts] = useState({
    total: 0,
    biometricEnrolled: 0,
    present: 0,
    absent: 0,
    pendingAdv: 0,
    pendingLeaves: 0,
  });

  useEffect(() => {
    const emps = getEmployees().filter((e) => e.active);
    const today = todayString();
    const todayAtt = getAttendance().filter((r) => r.date === today && r.shift === "morning");
    const present = todayAtt.filter((r) => r.status === "present" || r.status === "late").length;
    const absent = todayAtt.filter((r) => r.status === "absent").length;
    const pendingAdv = getAdvances().filter((a) => a.status === "pending").length;
    const pendingLeaves = getLeaves().filter((l) => l.status === "pending").length;
    const biometricEnrolled = emps.filter((e) => e.biometric_enrolled).length;
    setCounts({
      total: emps.length,
      biometricEnrolled,
      present,
      absent,
      pendingAdv,
      pendingLeaves,
    });
  }, []);

  return (
    <div className="p-3 space-y-3">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat icon={Users} label="Total Active Employees" value={counts.total} />
        <Stat
          icon={Fingerprint}
          label="Biometric Enrolled"
          value={counts.biometricEnrolled}
          tone="success"
        />
        <Stat
          icon={CheckCircle2}
          label="Present Today (Morning)"
          value={counts.present}
          tone="success"
        />
        <Stat icon={XCircle} label="Absent Today" value={counts.absent} tone="destructive" />
        <Stat
          icon={BadgeIndianRupee}
          label="Pending Advances"
          value={counts.pendingAdv}
          tone="warning"
        />
        <Stat
          icon={CalendarOff}
          label="Pending Leaves"
          value={counts.pendingLeaves}
          tone="warning"
        />
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Link
            to="/attendance"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            📋 Mark Attendance
          </Link>
          <Link
            to="/employees"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            👤 Add Employee
          </Link>
          <Link
            to="/salary"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            💰 Generate Salary
          </Link>
          <Link
            to="/settings"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            ⚙️ Settings
          </Link>
          <Link
            to="/worker"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            📱 Worker Portal
          </Link>
          <Link
            to="/reports"
            className="p-3 rounded-lg border text-sm font-medium hover:bg-accent text-center transition-colors"
          >
            📊 Reports
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">System Info</h2>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          <li>Worker attendance — Worker Portal kholo → Naam select karo → Biometric scan</li>
          <li>Settings me location pin karo (GPS fence)</li>
          <li>Settings me Google Sheets connect karo data backup ke liye</li>
          <li>Salary page se monthly salary generate karo — auto calculation hogi</li>
        </ul>
      </Card>
    </div>
  );
}
