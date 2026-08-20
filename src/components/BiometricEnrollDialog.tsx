import { useRef, useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, SwitchCamera } from "lucide-react";
import { toast } from "sonner";
import { type Employee, upsertEmployee } from "@/lib/store";
import { loadModels, captureStableDescriptor } from "@/lib/face-recognition";

type Facing = "user" | "environment";

export function BiometricEnrollDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: Employee | null;
  mode?: string; // kept for compat, ignored
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
  }, []);

  useEffect(() => {
    if (!open || !employee) return;
    let cancelled = false;
    (async () => {
      try {
        await loadModels();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamReady(true);
        }
      } catch (e) {
        toast.error("Camera nahi mila: " + (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, employee, facing, stop]);

  const doFace = async () => {
    if (!employee || !videoRef.current) return;
    setBusy(true);
    setProgress({ done: 0, total: 3 });
    try {
      const desc = await captureStableDescriptor(videoRef.current, 3, (done, total) =>
        setProgress({ done, total }),
      );
      if (!desc) {
        toast.error("Face detect nahi hua. Achchi roshni mein seedha camera ki taraf dekhein.");
        return;
      }
      upsertEmployee({ ...employee, face_descriptor: Array.from(desc) });
      toast.success(`✓ ${employee.full_name} ka face register ho gaya`);
      onOpenChange(false);
    } catch (e) {
      toast.error("Capture failed: " + (e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Face Register — {employee?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div
            className="relative rounded-xl overflow-hidden bg-black"
            style={{ aspectRatio: "4/3" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
            />
            {!streamReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-8 text-white animate-spin" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="border-2 border-white/50 border-dashed rounded-full"
                style={{ width: "55%", height: "70%" }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2 h-8 px-2"
              disabled={busy}
              onClick={() => {
                stop();
                setFacing((f) => (f === "user" ? "environment" : "user"));
              }}
            >
              <SwitchCamera className="size-4 mr-1" />
              {facing === "user" ? "Front" : "Back"}
            </Button>
            {progress && (
              <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                <span className="bg-black/70 text-white text-xs px-3 py-1 rounded-full">
                  Sample {progress.done}/{progress.total}
                </span>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Oval ke andar seedha chehra laayein — 3 samples liye jaate hain
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={doFace} disabled={busy || !streamReady}>
            {busy ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Camera className="size-4 mr-1" />
            )}
            Face Capture Karein
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
