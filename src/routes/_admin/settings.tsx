import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  KeyRound,
  MapPin,
  Cloud,
  RefreshCw,
  Link2,
  Clock,
  ShieldCheck,
  Camera,
  Trash2,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import { getSettings, updateSettings, type AttendanceSchedule } from "@/lib/store";
import { getCurrentPosition } from "@/lib/location";
import { createMasterSpreadsheet } from "@/lib/sheets-gateway.functions";
import { syncAll } from "@/lib/sync";
import { AdminFaceEnrollDialog } from "@/components/AdminFaceEnrollDialog";

export const Route = createFileRoute("/_admin/settings")({ component: SettingsPage });

const DEFAULT_SCHEDULE: AttendanceSchedule = {
  morning_start: "08:30",
  morning_end: "09:30",
  evening_start: "17:00",
  evening_end: "18:00",
  enforce: false,
};

function SettingsPage() {
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState(getSettings());
  const [locLoading, setLocLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [radius, setRadius] = useState(200);
  const [sheetUrl, setSheetUrl] = useState("");
  const [faceDialogOpen, setFaceDialogOpen] = useState(false);
  const [schedule, setSchedule] = useState<AttendanceSchedule>(
    getSettings().attendance_schedule ?? DEFAULT_SCHEDULE,
  );

  const reload = () => {
    const s = getSettings();
    setSettings(s);
    setRadius(s.office_location?.radius_meters ?? 200);
    setSheetUrl(s.sheets_url ?? "");
    setSchedule(s.attendance_schedule ?? DEFAULT_SCHEDULE);
  };

  useEffect(() => {
    reload();
  }, []);

  const savePassword = async () => {
    const clean = newPassword.trim();
    if (clean.length < 2) {
      toast.error("Password kam se kam 2 characters ka hona chahiye.");
      return;
    }
    await updateSettings({ admin_password: clean, admin_secret: clean });
    toast.success("✅ Admin Password successfully save ho gaya!");
    setNewPassword("");
    reload();
  };

  const removeAdminFace = async () => {
    await updateSettings({ admin_face_descriptor: undefined });
    toast.success("Admin face scan remove kar diya gaya.");
    reload();
  };

  const pinLocation = async () => {
    setLocLoading(true);
    try {
      const pos = await getCurrentPosition();
      await updateSettings({
        office_location: {
          lat: pos.lat,
          lng: pos.lng,
          radius_meters: radius,
          label: `Office (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`,
        },
      });
      toast.success(`Location pinned! ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocLoading(false);
    }
  };

  const clearLocation = async () => {
    await updateSettings({ office_location: undefined });
    toast.success("Location check disabled");
    reload();
  };

  const saveSchedule = async () => {
    await updateSettings({ attendance_schedule: schedule });
    toast.success("Attendance schedule saved!");
    reload();
  };

  const saveSheetUrl = async () => {
    await updateSettings({ sheets_url: sheetUrl });
    toast.success("Sheet URL saved");
    reload();
  };

  const createSheet = async () => {
    setSyncLoading(true);
    try {
      const res = await createMasterSpreadsheet({ data: { title: "Transport Staff" } });
      await updateSettings({
        spreadsheet_id: res.spreadsheetId,
        sheets_url: res.url,
        sheets_sync_enabled: true,
      });
      toast.success("Spreadsheet ban gaya!");
      reload();
      // initial push
      try {
        await syncAll();
        toast.success("Initial sync done");
      } catch (e) {
        toast.error("Initial sync fail: " + (e as Error).message);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncLoading(false);
    }
  };

  const syncNow = async () => {
    setSyncLoading(true);
    try {
      await syncAll();
      toast.success("Synced to Google Sheets!");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleSync = async (on: boolean) => {
    await updateSettings({ sheets_sync_enabled: on });
    toast.success(on ? "Auto-sync ON" : "Auto-sync OFF");
    reload();
  };

  const linkExistingSheet = async () => {
    // Extract ID from URL
    const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const id = m?.[1] ?? sheetUrl.trim();
    if (id.length < 10) {
      toast.error("Valid spreadsheet URL ya ID daalein");
      return;
    }
    await updateSettings({
      spreadsheet_id: id,
      sheets_url: `https://docs.google.com/spreadsheets/d/${id}`,
      sheets_sync_enabled: true,
    });
    toast.success("Sheet linked!");
    reload();
  };

  const hasFace =
    Array.isArray(settings.admin_face_descriptor) && settings.admin_face_descriptor.length > 0;

  return (
    <div className="p-3 space-y-3 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-muted-foreground">
          Admin Face Scan, Password, attendance time, location aur Google Sheets
        </p>
      </div>

      {/* Admin Face Scan Login */}
      <Card className="p-4 space-y-3 border border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h2 className="font-semibold text-sm">Admin Face Scan Login</h2>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              hasFace
                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {hasFace ? "Registered (Active)" : "Not Registered"}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Apna chehra scan karke register karein taaki bina password type kiye direct Face Scan se
          Admin Login ho sake.
        </p>

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button
            onClick={() => setFaceDialogOpen(true)}
            size="sm"
            className="flex items-center gap-1.5"
          >
            <Camera className="size-3.5" />
            {hasFace ? "Re-scan / Update Face" : "Register Admin Face"}
          </Button>
          {hasFace && (
            <Button
              onClick={removeAdminFace}
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
            >
              <Trash2 className="size-3.5" />
              Remove Face Scan
            </Button>
          )}
        </div>
      </Card>

      {/* Admin Password */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <h2 className="font-semibold text-sm">Admin Login Password</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Supabase mein saved yahi password login screen par use hoga.
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">New Password</Label>
            <div className="relative mt-1">
              <Input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="h-9 text-sm pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button
            onClick={savePassword}
            disabled={newPassword.trim().length < 2}
            size="sm"
            className="h-9"
          >
            Save Password
          </Button>
        </div>
      </Card>

      {/* Evening Attendance Toggle */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🌙</span>
            <div>
              <h2 className="font-semibold text-sm">Evening Attendance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {settings.evening_enabled
                  ? "ON — Workers morning + evening dono mark kar sakte hain"
                  : "OFF — Sirf morning attendance hogi (ek baar)"}
              </p>
            </div>
          </div>
          <div
            onClick={() => {
              const newVal = !(settings.evening_enabled ?? false);
              updateSettings({ evening_enabled: newVal });
              toast.success(newVal ? "🌙 Evening attendance ON" : "✅ Sirf morning attendance");
              reload();
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
              settings.evening_enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
                settings.evening_enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </div>
        </div>
      </Card>

      {/* Attendance Time Schedule */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <h2 className="font-semibold text-sm">Attendance Time Schedule</h2>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">Enforce</span>
            <div
              onClick={() => setSchedule((s) => ({ ...s, enforce: !s.enforce }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${schedule.enforce ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${schedule.enforce ? "translate-x-4" : "translate-x-1"}`}
              />
            </div>
          </label>
        </div>

        {schedule.enforce && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-2 text-xs text-yellow-700">
            ⚠️ Enforce ON hai — workers sirf set time ke andar attendance mark kar payenge
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs font-medium text-orange-600">🌅 Morning Shift</div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Start</Label>
                <Input
                  type="time"
                  value={schedule.morning_start}
                  onChange={(e) => setSchedule((s) => ({ ...s, morning_start: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="mt-5 text-muted-foreground text-xs">to</div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">End</Label>
                <Input
                  type="time"
                  value={schedule.morning_end}
                  onChange={(e) => setSchedule((s) => ({ ...s, morning_end: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-blue-600">🌙 Evening Shift</div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Start</Label>
                <Input
                  type="time"
                  value={schedule.evening_start}
                  onChange={(e) => setSchedule((s) => ({ ...s, evening_start: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="mt-5 text-muted-foreground text-xs">to</div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">End</Label>
                <Input
                  type="time"
                  value={schedule.evening_end}
                  onChange={(e) => setSchedule((s) => ({ ...s, evening_end: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
          Default: Morning 08:30–09:30 &nbsp;|&nbsp; Evening 17:00–18:00
          <br />
          Enforce OFF rahega to worker kabhi bhi attendance mark kar sakta hai.
        </div>

        <Button onClick={saveSchedule} size="sm" className="w-full">
          <Clock className="size-3.5 mr-1" /> Schedule Save Karo
        </Button>
      </Card>

      {/* Location */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          <h2 className="font-semibold text-sm">Office Location (GPS Fence)</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Admin apne phone se ek baar location pin kare. Workers attendance mark karne ke liye wahan
          hone chahiye.
        </p>
        {settings.office_location ? (
          <div className="bg-green-50 border border-green-200 rounded-md p-2.5 text-xs space-y-0.5">
            <div className="font-semibold text-green-700">✓ {settings.office_location.label}</div>
            <div className="text-green-600">Radius: {settings.office_location.radius_meters}m</div>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-2.5 text-xs text-yellow-700">
            Location set nahi hai — workers bina location check ke attendance mark kar sakte hain.
          </div>
        )}
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <Label className="text-xs">Radius (meters)</Label>
            <Input
              type="number"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-24 h-8 text-sm"
            />
          </div>
          <Button onClick={pinLocation} disabled={locLoading} size="sm">
            <MapPin className="size-3.5 mr-1" />
            {locLoading ? "Getting GPS…" : "Pin Location"}
          </Button>
          {settings.office_location && (
            <Button variant="destructive" size="sm" onClick={clearLocation}>
              Remove
            </Button>
          )}
        </div>
      </Card>

      {/* Google Sheets */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="size-4 text-primary" />
            <h2 className="font-semibold text-sm">Google Sheets Auto-Sync</h2>
          </div>
          {settings.spreadsheet_id && (
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-muted-foreground">Auto-sync</span>
              <div
                onClick={() => toggleSync(!(settings.sheets_sync_enabled ?? true))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(settings.sheets_sync_enabled ?? true) ? "bg-primary" : "bg-muted"}`}
              >
                <span
                  className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${(settings.sheets_sync_enabled ?? true) ? "translate-x-4" : "translate-x-1"}`}
                />
              </div>
            </label>
          )}
        </div>

        <div className="bg-accent/40 rounded-md p-2.5 text-xs flex gap-2">
          <Info className="size-3.5 mt-0.5 shrink-0 text-primary" />
          <div>
            Google account Lovable connector se already linked hai. Data har change ke turant baad
            sheet me push hoga.
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {!settings.spreadsheet_id ? (
            <Button onClick={createSheet} size="sm" disabled={syncLoading}>
              <Link2 className="size-3.5 mr-1" />
              {syncLoading ? "Creating…" : "Create New Spreadsheet"}
            </Button>
          ) : (
            <Button onClick={syncNow} size="sm" disabled={syncLoading}>
              <RefreshCw className={`size-3.5 mr-1 ${syncLoading ? "animate-spin" : ""}`} />
              Sync Now
            </Button>
          )}
        </div>

        {settings.spreadsheet_id && (
          <div className="bg-green-50 border border-green-200 rounded-md p-2 text-xs space-y-1">
            <div className="font-mono text-green-700 break-all">{settings.spreadsheet_id}</div>
            {settings.last_synced && (
              <div className="text-green-600">
                Last synced: {new Date(settings.last_synced).toLocaleString("en-IN")}
              </div>
            )}
            <a
              href={`https://docs.google.com/spreadsheets/d/${settings.spreadsheet_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Open Sheet ↗
            </a>
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <Label className="text-xs">Ya existing sheet URL link karein</Label>
          <div className="flex gap-2">
            <Input
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="text-xs h-8"
            />
            <Button variant="outline" size="sm" onClick={linkExistingSheet}>
              Link
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Note: Sheet me manual edits next sync me overwrite ho jayenge. Source of truth = app
            data.
          </div>
        </div>
      </Card>

      <AdminFaceEnrollDialog
        open={faceDialogOpen}
        onOpenChange={setFaceDialogOpen}
        onEnrolled={reload}
      />
    </div>
  );
}
