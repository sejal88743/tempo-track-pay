import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fingerprint, ScanFace, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getEmployees, upsertAttendance, newId, type Employee } from "@/lib/store";
import {
  identifyByFingerprint,
  loadModels,
  captureDescriptor,
  matchDescriptor,
} from "@/lib/face-recognition";

export function QuickAttendance({
  date,
  shift,
  onMarked,
}: {
  date: string;
  shift: "morning" | "evening";
  onMarked: (emp: Employee, method: "fingerprint" | "face") => void;
}) {
  const [busy, setBusy] = useState<"" | "fingerprint" | "face">("");
  const [showCam, setShowCam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const markFor = (emp: Employee, method: "fingerprint" | "face") => {
    upsertAttendance({
      id: newId(),
      employee_id: emp.id,
      date,
      shift,
      status: "present",
      in_time: new Date().toISOString(),
      method,
    });
    toast.success(`✓ ${emp.full_name} ki attendance lagi (${method})`);
    onMarked(emp, method);
  };

  const tryFingerprint = async () => {
    const emps = getEmployees().filter((e) => e.active);
    const idMap = new Map<string, Employee>();
    const all: string[] = [];
    for (const e of emps)
      for (const c of e.credential_ids ?? []) {
        all.push(c);
        idMap.set(c, e);
      }
    if (!all.length) {
      toast.error("Kisi worker ka fingerprint enrolled nahi");
      return;
    }
    setBusy("fingerprint");
    try {
      const matched = await identifyByFingerprint(all);
      if (!matched) {
        toast.error("Fingerprint match nahi hua");
        return;
      }
      const emp = idMap.get(matched);
      if (!emp) {
        toast.error("Worker map nahi mila");
        return;
      }
      markFor(emp, "fingerprint");
    } finally {
      setBusy("");
    }
  };

  const startFace = async () => {
    setBusy("face");
    try {
      await loadModels();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setShowCam(true);
      // wait next paint
      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          // wait 1.5s for camera to stabilize
          await new Promise((r) => setTimeout(r, 1500));
          const desc = await captureDescriptor(videoRef.current);
          stream.getTracks().forEach((t) => t.stop());
          setShowCam(false);
          if (!desc) {
            toast.error("Face detect nahi hua");
            setBusy("");
            return;
          }
          const emps = getEmployees().filter((e) => e.active && e.face_descriptor);
          const m = matchDescriptor(
            desc,
            emps.map((e) => ({ id: e.id, descriptor: e.face_descriptor! })),
          );
          if (!m) {
            toast.error("Koi worker match nahi hua");
            setBusy("");
            return;
          }
          const emp = emps.find((e) => e.id === m.id)!;
          markFor(emp, "face");
          setBusy("");
        }
      }, 100);
    } catch (e) {
      toast.error("Camera error: " + (e as Error).message);
      setBusy("");
      setShowCam(false);
    }
  };

  return (
    <Card className="p-3 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/30">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
        <div>
          <div className="font-semibold text-sm">Quick Mark — Auto Identify</div>
          <div className="text-xs text-muted-foreground">
            Worker select kiye bina fingerprint ya face se attendance
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={tryFingerprint} disabled={!!busy} size="sm">
            {busy === "fingerprint" ? (
              <Loader2 className="size-4 animate-spin mr-1" />
            ) : (
              <Fingerprint className="size-4 mr-1" />
            )}
            Fingerprint
          </Button>
          <Button onClick={startFace} disabled={!!busy} size="sm" variant="secondary">
            {busy === "face" ? (
              <Loader2 className="size-4 animate-spin mr-1" />
            ) : (
              <ScanFace className="size-4 mr-1" />
            )}
            Face Scan
          </Button>
        </div>
      </div>
      {showCam && (
        <div className="mt-2 aspect-video bg-black rounded overflow-hidden max-w-sm mx-auto">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
      )}
    </Card>
  );
}
