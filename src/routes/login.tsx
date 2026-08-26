import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Truck, ShieldCheck, Users } from "lucide-react";
import { getSettings, setAdminLoggedIn, todayDDMM_IST, isAdminLoggedIn } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Admin Login — Transport Staff" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [showAdminForm, setShowAdminForm] = useState(false);

  // Redirect already-logged-in admins — useEffect avoids SSR/client hydration mismatch
  useEffect(() => {
    if (isAdminLoggedIn()) navigate({ to: "/dashboard" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const settings = getSettings();
      const secret = (settings.admin_secret || "MANOJ").toUpperCase();
      const expected = todayDDMM_IST() + secret;
      if (pw.trim().toUpperCase() !== expected) {
        toast.error(`Galat password. Formula: DDMM + SECRET`);
        return;
      }
      setAdminLoggedIn(true);
      toast.success("Welcome, Admin!");
      navigate({ to: "/dashboard" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Top-right admin button */}
      <div className="flex justify-end p-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-white/40 hover:text-white hover:bg-white/10 text-xs px-3 py-1.5"
          onClick={() => setShowAdminForm(true)}
        >
          <ShieldCheck className="size-3.5 mr-1" />
          Admin Login
        </Button>
      </div>

      {/* Center — Worker Attendance */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 mb-10">
          <div className="size-20 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <Truck className="size-10 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">Transport Staff</h1>
            <p className="text-white/50 text-sm mt-1">Attendance Management</p>
          </div>
        </div>

        <button
          onClick={() => navigate({ to: "/worker" })}
          className="w-full max-w-xs bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-2xl p-8 flex flex-col items-center gap-3 transition-all shadow-xl"
        >
          <div className="size-16 rounded-full bg-white/20 flex items-center justify-center">
            <Users className="size-9 text-white" />
          </div>
          <div className="text-center">
            <div className="text-white font-bold text-xl">Worker Attendance</div>
            <div className="text-white/70 text-sm mt-1">Face scan se attendance mark karein</div>
          </div>
        </button>
      </div>

      {/* Admin login modal */}
      {showAdminForm && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdminForm(false);
          }}
        >
          <Card className="w-full max-w-sm p-7 shadow-2xl border-0 bg-slate-800">
            <div className="flex flex-col items-center gap-2 mb-6">
              <div className="size-12 rounded-xl bg-primary/20 flex items-center justify-center">
                <ShieldCheck className="size-6 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-white">Admin Login</h2>
            </div>

            <form onSubmit={onLogin} className="space-y-4">
              <div>
                <Label className="text-white/70 text-sm">Admin Password</Label>
                <Input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Password darj karein"
                  className="mt-1 bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-primary"
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                <ShieldCheck className="size-4 mr-2" />
                {loading ? "Verifying…" : "Login"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-white/40 hover:text-white"
                onClick={() => setShowAdminForm(false)}
              >
                Cancel
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
