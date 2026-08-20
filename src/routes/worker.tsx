import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Truck,
  MapPin,
  CheckCircle2,
  ScanFace,
  Camera,
  Loader2,
  ChevronRight,
  SwitchCamera,
} from "lucide-react";

import {
  getEmployees,
  getSettings,
  upsertAttendance,
  getAttendanceForDate,
  getAttendance,
  upsertEmployee,
  todayString,
  newId,
  useCloudSync,
  type Employee,
} from "@/lib/store";
import { captureStableDescriptor, loadModels, identifyLive } from "@/lib/face-recognition";

import { getCurrentPosition, isWithinFence, warmupLocation } from "@/lib/location";

type Step = "scan" | "locating" | "face-camera" | "face-enrollcamera" | "confirm" | "done";

export const Route = createFileRoute("/worker")({
  head: () => ({ meta: [{ title: "Worker Attendance — Transport Staff" }] }),
  component: WorkerPage,
});

function WorkerPage() {
  useCloudSync(); // pull latest employees (with face descriptors) from cloud
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("scan");
  const [identified, setIdentified] = useState<Employee | null>(null);
  const [shift, setShift] = useState<"morning" | "evening">("morning");
  const [loading, setLoading] = useState(false);
  const [enrollCandidate, setEnrollCandidate] = useState<Employee | null>(null);
  // GPS status — always mandatory, no toast ever shown
  const [gpsStatus, setGpsStatus] = useState<"checking" | "ok" | "denied" | "outside">("checking");
  const [outsideLabel, setOutsideLabel] = useState("");
  const [locBlocked, setLocBlocked] = useState(false);
  const [locError, setLocError] = useState("");
  // No-match popup state
  const [showNoMatchPopup, setShowNoMatchPopup] = useState(false);
  const [noMatchMode, setNoMatchMode] = useState<"choose" | "enroll-select" | null>(null);
  const [noMatchReason, setNoMatchReason] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  // bumped every time a fresh camera stream is opened → forces re-attach
  const [camKey, setCamKey] = useState(0);
  const [matchInfo, setMatchInfo] = useState<{ distance: number; margin: number } | null>(null);

  // Monthly attendance count shown on done screen
  const [monthCount, setMonthCount] = useState<{ present: number; total: number } | null>(null);
  const [showMonthDetail, setShowMonthDetail] = useState(false);
  const [blockedEmp, setBlockedEmp] = useState<Employee | null>(null);
  const [mounted, setMounted] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const settings = getSettings();
  const eveningEnabled = settings.evening_enabled ?? false;

  // Silent GPS check — runs on mount and on retry.
  // Always returns the resolved status so callers can gate on the result
  // instead of reading potentially-stale React state.
  const checkGps = useCallback(async (): Promise<"ok" | "denied" | "outside"> => {
    setGpsStatus("checking");
    try {
      const pos = await getCurrentPosition();
      const s = getSettings();
      if (s.office_location) {
        const ok = isWithinFence(pos, s.office_location, s.office_location.radius_meters);
        if (!ok) {
          setOutsideLabel(s.office_location.label);
          setGpsStatus("outside");
          return "outside";
        }
      }
      setGpsStatus("ok");
      return "ok";
    } catch {
      // No toast — silently show GPS screen
      setGpsStatus("denied");
      return "denied";
    }
  }, []);

  useEffect(
    () => {
      setMounted(true);
      loadModels().catch(() => {});
      warmupLocation();
      const h = new Date().getHours();
      setShift(eveningEnabled && h >= 14 ? "evening" : "morning");

      checkGps();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // intentionally run once on mount
  );

  // Attach stream to video element when a camera step opens (or a fresh stream arrives)
  useEffect(() => {
    if (step !== "face-camera" && step !== "face-enrollcamera") return;
    let tries = 0;
    const tryAttach = () => {
      tries += 1;
      const v = videoRef.current;
      const s = streamRef.current;
      if (v && s) {
        if (v.srcObject !== s) v.srcObject = s;
        v.play().catch(() => {});
        if (v.videoWidth > 0) return true;
      }
      return false;
    };
    if (tryAttach()) return;
    const iv = setInterval(() => {
      if (tryAttach() || tries > 20) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [step, camKey]);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(
    () => () => {
      stopCamera();
      stopCountdown();
    },
    [stopCamera, stopCountdown],
  );

  // No auto-capture — the user taps the Scan / Register button to take a
  // photo. Just clear any lingering countdown when the step changes.
  useEffect(() => {
    stopCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, camKey]);

  const openCamera = async (face: "user" | "environment" = facing): Promise<MediaStream | null> => {
    // Always release any previous stream first — some devices refuse a second
    // getUserMedia while the old track is still live (black screen on retry).
    stopCamera();
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      // Fallback: some devices reject exact facingMode/resolution combos
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        toast.error("Camera access nahi mila. Browser mein permission allow karein.");
        return null;
      }
    }
  };

  const flipCamera = async () => {
    const next = facing === "user" ? "environment" : "user";
    stopCountdown();
    stopCamera();
    setFacing(next);
    const stream = await openCamera(next);
    if (!stream) return;
    streamRef.current = stream;
    setCamKey((k) => k + 1);
  };

  // ── FACE SCAN (identify) ─────────────────────────────────────────────────

  const handleFaceScan = async () => {
    setLoading(true);
    setShowNoMatchPopup(false);
    setNoMatchMode(null);
    setIdentified(null);
    setMatchInfo(null);

    const s = getSettings();

    // Open camera and check GPS simultaneously for instant-feel UX.
    // When no geofence is configured, skip the GPS position call entirely.
    // In both cases the GPS result comes from checkGps()'s return value —
    // never from stale React state — so the gate is reliable.
    const [stream, gpsResult] = await Promise.all([
      openCamera(),
      s.office_location ? checkGps() : Promise.resolve("ok" as const),
    ]);

    if (!stream) {
      setLoading(false);
      return;
    }
    if (gpsResult !== "ok") {
      // GPS failed — discard the stream and let checkGps-updated state
      // render the denied/outside screen automatically.
      stream.getTracks().forEach((t) => t.stop());
      setLoading(false);
      return;
    }

    // No fence configured → mark location as ok without a GPS round-trip
    if (!s.office_location) setGpsStatus("ok");

    streamRef.current = stream;
    setCamKey((k) => k + 1);
    setLoading(false);
    setStep("face-camera");
  };

  const failScan = (reason: string) => {
    stopCamera();
    setStep("scan");
    setNoMatchReason(reason);
    setShowNoMatchPopup(true);
    setNoMatchMode("choose");
  };

  const captureFaceAndIdentify = async () => {
    if (!videoRef.current) return;
    stopCountdown();
    setLoading(true);
    setScanProgress({ done: 0, total: 2 });
    try {
      await loadModels();
      const emps = getEmployees().filter(
        (e) => e.active && Array.isArray(e.face_descriptor) && e.face_descriptor.length > 0,
      );
      const candidates = emps.map((e) => ({ id: e.id, descriptor: e.face_descriptor! }));

      const res = await identifyLive(videoRef.current, candidates, {
        maxSamples: 6,
        onProgress: (done, total) => setScanProgress({ done, total }),
      });

      if (!res.ok) {
        failScan(
          res.reason === "ambiguous"
            ? "Do workers ka face milta-julta laga — safety ke liye attendance nahi lagayi. Dobara scan karein."
            : res.reason === "no-face-data"
              ? "Kisi worker ka face register nahi hai."
              : res.reason === "no-face"
                ? "Chehra nahi dikh raha. Achchi roshni mein seedha camera ki taraf dekhein."
                : "Aapka face match nahi hua. Agar aapka face register nahi hai to pehle register karein.",
        );
        return;
      }

      const emp = getEmployees().find((e) => e.id === res.id)!;
      stopCamera();
      setIdentified(emp);
      // No name-confirmation screen — mark attendance directly and show
      // the present-day count on the done screen.
      await markAttendance(emp);
    } catch (e) {
      toast.error("Face scan error: " + (e as Error).message);
      setStep("scan");
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  };

  // ── ENROLL FACE ──────────────────────────────────────────────────────────

  const startFaceEnroll = async (emp: Employee) => {
    // Block re-enrollment from the worker screen if a descriptor already exists.
    // Only first-time registration (no descriptor) is permitted here.
    // If the face is already on file, the worker must retry scanning or ask admin.
    if (emp.face_descriptor && emp.face_descriptor.length > 0) {
      toast.error(
        `${emp.full_name} ka face pehle se register hai. Scan dobara try karein ya admin se milein.`,
      );
      return;
    }
    setEnrollCandidate(emp);
    setShowNoMatchPopup(false);
    setNoMatchMode(null);
    setLoading(true);
    setStep("scan");
    const stream = await openCamera();
    if (!stream) {
      setLoading(false);
      return;
    }
    streamRef.current = stream;
    setCamKey((k) => k + 1);
    setLoading(false);
    setStep("face-enrollcamera");
  };

  const captureEnrollFace = async () => {
    if (!videoRef.current || !enrollCandidate) return;
    // Guard: should never reach here if the employee already has a descriptor
    // (startFaceEnroll blocks that path), but check defensively.
    if (enrollCandidate.face_descriptor && enrollCandidate.face_descriptor.length > 0) {
      toast.error("Is worker ka face pehle se registered hai. Admin se sampark karein.");
      stopCamera();
      setStep("scan");
      return;
    }
    stopCountdown();
    setLoading(true);
    setScanProgress({ done: 0, total: 3 });
    try {
      await loadModels();
      const descriptor = await captureStableDescriptor(videoRef.current, 3, (done, total) =>
        setScanProgress({ done, total }),
      );
      if (!descriptor) {
        toast.error("Chehra nahi dikh raha. Seedha camera ki taraf dekhein.");
        return;
      }
      const updated: Employee = {
        ...enrollCandidate,
        face_descriptor: Array.from(descriptor),
      };
      upsertEmployee(updated);
      stopCamera();
      setIdentified(updated);
      toast.success("✅ Face register ho gaya!");
      await markAttendance(updated);
    } catch (e) {
      toast.error("Enroll error: " + (e as Error).message);
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  };

  // ── MARK ATTENDANCE (auto, face match ke turant baad) ────────────────────

  const markAttendance = async (emp: Employee) => {
    const today = todayString();
    const now = new Date().toISOString();
    const existing = getAttendanceForDate(today).find(
      (r) => r.employee_id === emp.id && r.shift === shift,
    );
    // Admin ne aaj is worker ko ABSENT mark kiya ho to worker khud attendance nahi laga sakta.
    if (existing && existing.status === "absent" && existing.marked_by === "admin") {
      setBlockedEmp(emp);
      setStep("scan");
      return;
    }
    // Capture fresh GPS at mark time
    let lat: number | undefined, lng: number | undefined, acc: number | undefined;
    try {
      const p = await getCurrentPosition();
      lat = p.lat;
      lng = p.lng;
      acc = p.accuracy;
    } catch {
      /* fall through — attendance still saves */
    }
    upsertAttendance({
      id: existing?.id ?? newId(),
      employee_id: emp.id,
      date: today,
      shift,
      status: "present",
      in_time: existing?.in_time ?? now,
      out_time: now,
      location_ok: true,
      method: "face",
      marked_by: "worker",
      latitude: lat,
      longitude: lng,
      accuracy_meters: acc,
    });

    // Calculate this month's present count
    const monthPrefix = today.slice(0, 7); // "YYYY-MM"
    const allAtt = getAttendance();
    const monthAtt = allAtt.filter(
      (r) =>
        r.employee_id === emp.id &&
        r.date.startsWith(monthPrefix) &&
        r.shift === "morning" &&
        (r.status === "present" || r.status === "late"),
    );
    const todayDate = new Date(today + "T00:00:00");
    const daysElapsed = todayDate.getDate(); // 1-based day of month
    setMonthCount({ present: monthAtt.length, total: daysElapsed });

    setStep("done");
    toast.success(`✅ ${emp.full_name} ki attendance mark ho gayi!`);
  };

  // ── MONTH DETAIL (date-wise 1/0 + salary) ────────────────────────────────
  const buildMonthDetail = (emp: Employee) => {
    const today = todayString();
    const monthPrefix = today.slice(0, 7);
    const [y, m] = monthPrefix.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const perDayBase = emp.monthly_salary > 0 ? emp.monthly_salary / daysInMonth : 0;
    const recs = getAttendance().filter(
      (r) => r.employee_id === emp.id && r.date.startsWith(monthPrefix) && r.shift === "morning",
    );
    const byDate = new Map(recs.map((r) => [r.date, r]));
    const days: { date: string; day: number; value: 0 | 1; amount: number }[] = [];
    let presentDays = 0;
    let salary = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${monthPrefix}-${String(d).padStart(2, "0")}`;
      const r = byDate.get(date);
      const present = !!r && (r.status === "present" || r.status === "late");
      const amount = present ? (r?.daily_salary_override ?? perDayBase) : 0;
      if (present) {
        presentDays += 1;
        salary += amount;
      }
      days.push({ date, day: d, value: present ? 1 : 0, amount });
    }
    return { days, presentDays, salary, daysInMonth, perDayBase };
  };

  // ── RESET ────────────────────────────────────────────────────────────────

  const reset = () => {
    stopCountdown();
    stopCamera();
    setStep("scan");
    setIdentified(null);
    setEnrollCandidate(null);
    setGpsStatus("checking");
    setOutsideLabel("");
    checkGps();
    setLoading(false);
    setShowNoMatchPopup(false);
    setNoMatchMode(null);
    setMatchInfo(null);
  };

  const locationEnabled = !!settings.office_location;
  const activeEmployees = getEmployees().filter((e) => e.active);

  // ── MAIN RENDER ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-slate-900 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary flex items-center justify-center">
            <Truck className="size-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-lg">Transport Staff</div>
            <div className="text-white/50 text-xs">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-white/60 hover:text-white hover:bg-white/10 text-xs"
          onClick={() => navigate({ to: "/login" })}
        >
          Admin
        </Button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {/* ── LOCATION BLOCKED ─────────────────────────────────────────────── */}
        {(gpsStatus === "denied" || gpsStatus === "outside") && (
          <div className="w-full max-w-sm space-y-4 text-center">
            <div className="size-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <MapPin className="size-8 text-red-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Location Galat Hai</h3>
              <p className="text-white/60 text-sm mt-1 whitespace-pre-line">
                {gpsStatus === "outside"
                  ? `Aap ${outsideLabel} ke bahar hain. Wahan se attendance mark karein.`
                  : "GPS access nahi mila. Browser settings mein location allow karein."}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={reset}
              className="border-white/20 text-white/70 hover:bg-white/10 bg-transparent"
            >
              Dobara Try Karein
            </Button>
          </div>
        )}

        {/* ── SCAN — main screen ─────────────────────────────────────────────── */}
        {gpsStatus !== "denied" && gpsStatus !== "outside" && step === "scan" && (
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white">Attendance Mark Karein</h2>
              <p className="text-white/50 text-sm mt-1">Face scan se identify ho</p>
              {mounted && locationEnabled && (
                <div className="flex items-center gap-1 justify-center mt-2">
                  <MapPin className="size-3 text-green-400" />
                  <span className="text-xs text-green-400/70">
                    Location check active — {settings.office_location?.label}
                  </span>
                </div>
              )}
            </div>

            {/* Shift toggle — only if evening enabled */}
            {eveningEnabled && (
              <div className="flex gap-2 justify-center">
                {(["morning", "evening"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setShift(s)}
                    className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                      shift === s
                        ? "bg-primary text-white shadow-lg"
                        : "bg-white/10 text-white/60 hover:bg-white/20"
                    }`}
                  >
                    {s === "morning" ? "🌅 Morning" : "🌙 Evening"}
                  </button>
                ))}
              </div>
            )}

            {/* Face Scan button */}
            <button
              onClick={handleFaceScan}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50
                         rounded-2xl p-7 flex flex-col items-center gap-3 transition-all shadow-lg"
            >
              <div className="size-16 rounded-full bg-white/20 flex items-center justify-center">
                <ScanFace className="size-9 text-white" />
              </div>
              <div>
                <div className="text-white font-bold text-xl">Face Scan</div>
                <div className="text-white/70 text-sm mt-0.5">
                  {eveningEnabled
                    ? `${shift === "morning" ? "🌅 Morning" : "🌙 Evening"} attendance`
                    : "🌅 Morning attendance"}
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ── LOCATING ───────────────────────────────────────────────────────── */}
        {gpsStatus !== "denied" && gpsStatus !== "outside" && step === "locating" && (
          <div className="text-center space-y-4">
            <div className="size-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto">
              <MapPin className="size-8 text-yellow-400 animate-pulse" />
            </div>
            <p className="text-white font-semibold">Location check ho raha hai…</p>
            <p className="text-white/50 text-sm">GPS signal le raha hai</p>
          </div>
        )}

        {/* ── FACE CAMERA (identify) ────────────────────────────────────────── */}
        {gpsStatus !== "denied" && gpsStatus !== "outside" && step === "face-camera" && (
          <div className="w-full max-w-sm mx-auto space-y-4">
            <div className="text-center">
              <h3 className="text-white font-bold text-lg">Chehra Camera Mein Rakhein</h3>
              <p className="text-white/50 text-sm mt-1">Oval ke andar apna chehra laayein</p>
            </div>
            <div
              className="relative mx-auto w-full rounded-2xl overflow-hidden bg-black border-2 border-white/20"
              style={{ aspectRatio: "3/4", maxHeight: "55vh" }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover object-center"
                style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="border-2 border-white/50 border-dashed rounded-full"
                  style={{ width: "55%", height: "65%" }}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2 h-8 px-2"
                disabled={loading}
                onClick={flipCamera}
              >
                <SwitchCamera className="size-4 mr-1" />
                {facing === "user" ? "Front" : "Back"}
              </Button>
              {/* Countdown overlay */}
              {!loading && countdown !== null && countdown > 0 && (
                <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
                  <div className="bg-black/60 rounded-full size-14 flex items-center justify-center border-2 border-white/40">
                    <span className="text-white font-bold text-2xl">{countdown}</span>
                  </div>
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <Loader2 className="size-8 text-white animate-spin mx-auto" />
                    <p className="text-white text-sm">Scan ho raha hai…</p>
                    {scanProgress && (
                      <p className="text-white/60 text-xs">
                        Sample {scanProgress.done}/{scanProgress.total}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <Button
              onClick={captureFaceAndIdentify}
              disabled={loading}
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-500 text-base"
            >
              <Camera className="size-5 mr-2" />
              {loading ? "Scan ho raha hai…" : "Abhi Scan Karein"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/40 hover:text-white w-full"
              onClick={reset}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* ── FACE ENROLL CAMERA ────────────────────────────────────────────── */}
        {gpsStatus !== "denied" &&
          gpsStatus !== "outside" &&
          step === "face-enrollcamera" &&
          enrollCandidate && (
            <div className="w-full max-w-sm mx-auto space-y-4">
              <div className="text-center">
                <p className="text-white/50 text-sm">Face Register Kar Rahe Hain</p>
                <h3 className="text-white font-bold text-lg mt-0.5">{enrollCandidate.full_name}</h3>
                <p className="text-white/40 text-xs mt-1">Seedha camera ki taraf dekhein</p>
              </div>
              <div
                className="relative mx-auto w-full rounded-2xl overflow-hidden bg-black border-2 border-green-500/40"
                style={{ aspectRatio: "3/4", maxHeight: "55vh" }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover object-center"
                  style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    className="border-2 border-green-400/60 border-dashed rounded-full"
                    style={{ width: "55%", height: "65%" }}
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 h-8 px-2"
                  disabled={loading}
                  onClick={flipCamera}
                >
                  <SwitchCamera className="size-4 mr-1" />
                  {facing === "user" ? "Front" : "Back"}
                </Button>
                {/* Countdown overlay */}
                {!loading && countdown !== null && countdown > 0 && (
                  <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
                    <div className="bg-black/60 rounded-full size-14 flex items-center justify-center border-2 border-green-400/60">
                      <span className="text-white font-bold text-2xl">{countdown}</span>
                    </div>
                  </div>
                )}
                {loading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Loader2 className="size-8 text-white animate-spin mx-auto" />
                      <p className="text-white text-sm">Register ho raha hai…</p>
                      {scanProgress && (
                        <p className="text-white/60 text-xs">
                          Sample {scanProgress.done}/{scanProgress.total}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Button
                onClick={captureEnrollFace}
                disabled={loading}
                size="lg"
                className="w-full bg-green-600 hover:bg-green-500 text-base"
              >
                <Camera className="size-5 mr-2" />
                {loading ? "Processing…" : "Abhi Register Karein"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/40 hover:text-white w-full"
                onClick={() => {
                  stopCamera();
                  setShowNoMatchPopup(true);
                  setNoMatchMode("enroll-select");
                }}
              >
                ← Wapas
              </Button>
            </div>
          )}

        {/* ── DONE ───────────────────────────────────────────────────────────── */}
        {/* ── CONFIRM — naam ke saath confirmation ────────────────────────── */}
        {gpsStatus !== "denied" && gpsStatus !== "outside" && step === "confirm" && identified && (
          <div className="w-full max-w-sm">
            <Card className="p-7 bg-white/10 border-white/20 text-center space-y-5">
              <div className="size-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
                <ScanFace className="size-8 text-blue-300" />
              </div>
              <div>
                <p className="text-white/50 text-sm">Face match hua</p>
                <h3 className="text-2xl font-bold text-white mt-1">{identified.full_name}</h3>
                <p className="text-white/40 text-sm mt-1">
                  {identified.role} • {shift === "morning" ? "🌅 Morning" : "🌙 Evening"}
                </p>
                {matchInfo && (
                  <p className="text-white/30 text-xs mt-2">
                    Match score {(100 - matchInfo.distance * 100).toFixed(0)}%
                  </p>
                )}
              </div>
              <p className="text-white/60 text-sm">
                Kya yahi aapka naam hai? Galat naam ho to "Nahi" dabayein.
              </p>
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full bg-green-600 hover:bg-green-500"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await markAttendance(identified);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <CheckCircle2 className="size-5 mr-2" />
                  Haan, Main Hoon — Attendance Lagayein
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-white/20 text-white/80 hover:bg-white/10 bg-transparent"
                  disabled={loading}
                  onClick={() => {
                    setIdentified(null);
                    setMatchInfo(null);
                    handleFaceScan();
                  }}
                >
                  Nahi — Dobara Scan Karein
                </Button>
              </div>
            </Card>
          </div>
        )}

        {gpsStatus !== "denied" && gpsStatus !== "outside" && step === "done" && identified && (
          <div className="w-full max-w-sm">
            <Card className="p-8 bg-white/10 border-white/20 text-center space-y-5">
              <div className="size-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-10 text-green-400" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white">Attendance Mark! ✅</h3>
                <p className="text-white mt-2 text-3xl font-extrabold tracking-tight">
                  {identified.full_name}
                </p>
                <p className="text-white/40 text-sm mt-1">
                  {shift === "morning" ? "🌅 Morning" : "🌙 Evening"} &nbsp;•&nbsp;
                  {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>

              {/* Monthly attendance count — click for date-wise detail */}
              {monthCount && (
                <button
                  type="button"
                  onClick={() => setShowMonthDetail(true)}
                  className="w-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all rounded-2xl p-4 space-y-1 border border-white/10 shadow-lg cursor-pointer"
                >
                  <p className="text-white/50 text-xs uppercase tracking-wider">
                    Is Mahine Ki Attendance
                  </p>
                  <div className="flex items-end justify-center gap-1">
                    <span className="text-4xl font-bold text-green-400">{monthCount.present}</span>
                    <span className="text-white/40 text-lg mb-0.5">/ {monthCount.total} din</span>
                  </div>
                  <p className="text-white/50 text-xs font-medium">
                    {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })} —
                    👆 detail dekhne ke liye dabayein
                  </p>
                </button>
              )}

              <Button onClick={reset} className="w-full" size="lg" variant="secondary">
                Dusra Employee
              </Button>
            </Card>
          </div>
        )}
      </div>

      {/* ── MONTH DETAIL POPUP (date-wise 1/0 + salary) ─────────────────────── */}
      {showMonthDetail &&
        identified &&
        (() => {
          const det = buildMonthDetail(identified);
          const chunks: (typeof det.days)[] = [];
          for (let i = 0; i < det.days.length; i += 10) chunks.push(det.days.slice(i, i + 10));
          return (
            <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-3 z-50">
              <div className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-white/10">
                <div className="p-4 border-b border-white/10">
                  <h3 className="text-white font-bold">{identified.full_name}</h3>
                  <p className="text-white/50 text-xs">
                    {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })} —
                    date wise attendance (1 = present, 0 = chhutti)
                  </p>
                </div>

                <div className="p-3 overflow-auto space-y-3">
                  {chunks.map((row, i) => (
                    <div key={i} className="rounded-xl border border-white/10 overflow-hidden">
                      <div className="grid grid-cols-10">
                        {row.map((d) => (
                          <div
                            key={d.date}
                            className="text-center text-[11px] py-1 bg-white/10 text-white/70 border-r border-white/10 last:border-r-0"
                          >
                            {d.day}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-10">
                        {row.map((d) => (
                          <div
                            key={d.date}
                            className={`text-center text-sm font-bold py-2 border-r border-white/10 last:border-r-0 ${
                              d.value === 1
                                ? "bg-green-500/20 text-green-400"
                                : "bg-red-500/10 text-red-400/70"
                            }`}
                          >
                            {d.value}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-4 border-t border-white/10 space-y-2">
                  <div className="flex justify-between text-sm text-white/70">
                    <span>Total Present Din</span>
                    <span className="font-semibold text-green-400">
                      {det.presentDays} / {det.daysInMonth}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-white/70">
                    <span>Per Day</span>
                    <span>₹{Math.round(det.perDayBase).toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-white">
                    <span>Salary (present din ki)</span>
                    <span className="text-green-400">
                      ₹{Math.round(det.salary).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <Button
                    className="w-full mt-2"
                    variant="secondary"
                    onClick={() => setShowMonthDetail(false)}
                  >
                    Band Karein
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ── ADMIN-ABSENT BLOCK POPUP ───────────────────────────────────────── */}
      {blockedEmp && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm p-6 space-y-4 text-center border border-red-500/30 shadow-2xl">
            <div className="size-14 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <ScanFace className="size-7 text-red-400" />
            </div>
            <h3 className="text-3xl font-extrabold text-red-400">CONTACT TO BOSS</h3>
            <p className="text-white/70 text-sm">
              {blockedEmp.full_name} ki aaj ki chutti admin ne mark ki hai. Attendance ab sirf admin
              hi badal sakta hai.
            </p>
            <Button className="w-full" variant="secondary" onClick={() => setBlockedEmp(null)}>
              Theek Hai
            </Button>
          </div>
        </div>
      )}

      {/* ── NO-MATCH POPUP ─────────────────────────────────────────────────── */}
      {showNoMatchPopup && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-white/10">
            {/* Choose action — only "scan again" */}
            {noMatchMode === "choose" && (
              <div className="p-6 space-y-4">
                <div className="text-center space-y-1">
                  <div className="size-12 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-3">
                    <ScanFace className="size-6 text-orange-400" />
                  </div>
                  <h3 className="text-white font-bold text-lg">Face Match Nahi Hua</h3>
                  <p className="text-white/50 text-sm">{noMatchReason || "Dobara scan karein."}</p>
                </div>
                <button
                  onClick={() => {
                    setShowNoMatchPopup(false);
                    setNoMatchMode(null);
                    handleFaceScan();
                  }}
                  className="w-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-xl p-4 flex items-center gap-3 transition-all text-left"
                >
                  <div className="size-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                    <ScanFace className="size-5 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">Dobara Scan Karein</div>
                    <div className="text-white/40 text-xs mt-0.5">
                      Achchi roshni mein seedha camera dekhein
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-white/30 ml-auto" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
