import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { isAdminLoggedIn, useCloudSync, useSyncStatus, forceCloudSync } from "@/lib/store";
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Truck,
  Wallet,
  CalendarOff,
  BadgeIndianRupee,
  BarChart3,
  Settings as Cog,
  LogOut,
  Menu,
  X,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin")({
  // No SSR auth check — avoids hydration mismatch; client useEffect handles redirect
  component: AdminLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employees", label: "Employees", icon: Users },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/salary", label: "Salary", icon: Wallet },
  { to: "/leaves", label: "Leaves", icon: CalendarOff },
  { to: "/advances", label: "Advances", icon: BadgeIndianRupee },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Cog },
] as const;

function AdminLayout() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const syncInfo = useSyncStatus();

  // Client-side auth guard — avoids SSR/client hydration mismatch
  useEffect(() => {
    if (!isAdminLoggedIn()) {
      navigate({ to: "/login" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncNow = async () => {
    setIsManualSyncing(true);
    try {
      const res = await forceCloudSync();
      if (res.success) {
        toast.success(`✅ Live Data Synced (${res.lastSyncedAt || "Now"})`);
      } else {
        toast.error("Sync error, retrying in background...");
      }
    } catch {
      toast.error("Sync error");
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Auto attendance rules: Sunday rule + 7 PM auto-absent (har 5 min check)
  useEffect(() => {
    let stop = false;
    const run = async () => {
      if (stop) return;
      const m = await import("@/lib/auto-attendance");
      m.runAutoAttendanceRules();
    };
    const t0 = setTimeout(run, 2500);
    const iv = setInterval(run, 5 * 60 * 1000);
    return () => {
      stop = true;
      clearTimeout(t0);
      clearInterval(iv);
    };
  }, []);

  const currentPage = NAV.find((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + "/"));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Top Header (mobile + desktop) ── */}
      <header className="sticky top-0 z-40 h-11 bg-sidebar text-sidebar-foreground flex items-center px-2 border-b border-sidebar-border shrink-0">
        {/* Hamburger (mobile) */}
        <button
          className="md:hidden p-1.5 rounded hover:bg-sidebar-accent"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Open navigation menu"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 px-2">
          <div className="size-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
            <Truck className="size-3.5" />
          </div>
          <span className="text-sm font-semibold hidden sm:block">Transport Staff</span>
          {currentPage && (
            <span className="text-xs text-sidebar-foreground/50 md:hidden">
              / {currentPage.label}
            </span>
          )}
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex flex-1 items-center gap-0.5 ml-2">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to || loc.pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/70"
                }`}
              >
                <Icon className="size-3.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Right actions & Live Sync Status */}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Live Sync Badge & Button */}
          <button
            onClick={handleSyncNow}
            disabled={isManualSyncing}
            title={
              syncInfo.status === "connected"
                ? `🟢 Live Cloud Connected (Synced at ${syncInfo.lastSyncedAt || "just now"}) — Click to refresh`
                : syncInfo.status === "syncing" || isManualSyncing
                  ? "Syncing latest data..."
                  : "🔴 Offline / Reconnecting — Click to retry"
            }
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-border transition-colors border border-sidebar-border"
          >
            {isManualSyncing || syncInfo.status === "syncing" ? (
              <RefreshCw className="size-3 animate-spin text-amber-400" />
            ) : syncInfo.status === "connected" ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : (
              <WifiOff className="size-3 text-rose-400" />
            )}
            <span className="hidden sm:inline font-mono">
              {isManualSyncing || syncInfo.status === "syncing"
                ? "Syncing..."
                : syncInfo.status === "connected"
                  ? "Live"
                  : "Offline"}
            </span>
            <RefreshCw className={`size-3 ${isManualSyncing ? "animate-spin" : "opacity-60"}`} />
          </button>

          <Link
            to="/worker"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30 font-medium"
          >
            <ClipboardCheck className="size-3.5" /> Worker
          </Link>
          <button
            onClick={() => navigate({ to: "/logout" })}
            className="p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground"
            title="Logout"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {/* ── Mobile Slide-out Menu ── */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" onClick={() => setMenuOpen(false)}>
          <div
            className="w-56 bg-sidebar text-sidebar-foreground flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-3 border-b border-sidebar-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
                  <Truck className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Transport Staff</div>
                  <div className="text-xs opacity-50">Admin Panel</div>
                </div>
              </div>
              <button
                onClick={handleSyncNow}
                className="p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/70"
                title="Sync now"
              >
                <RefreshCw className={`size-4 ${isManualSyncing ? "animate-spin" : ""}`} />
              </button>
            </div>
            <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
              {NAV.map((n) => {
                const Icon = n.icon;
                const active = loc.pathname === n.to || loc.pathname.startsWith(n.to + "/");
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="p-2 border-t border-sidebar-border space-y-1">
              <div className="px-3 py-1.5 text-[11px] text-sidebar-foreground/60 flex items-center justify-between">
                <span>Sync Status:</span>
                <span className="text-emerald-400 font-semibold">
                  {syncInfo.status === "connected" ? "Live Connected" : syncInfo.status}
                </span>
              </div>
              <Link
                to="/worker"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-primary/10 text-primary hover:bg-primary/20"
              >
                <ClipboardCheck className="size-4" /> Worker Portal
              </Link>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate({ to: "/logout" });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-sidebar-accent text-sidebar-accent-foreground hover:opacity-90"
              >
                <LogOut className="size-4" /> Logout
              </button>
            </div>
          </div>
          {/* Backdrop */}
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-x-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Navigation ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-sidebar-border">
        <div className="grid grid-cols-5 h-14">
          {NAV.slice(0, 5).map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to || loc.pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className={`size-5 ${active ? "text-primary" : ""}`} />
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className="grid grid-cols-4 h-12 border-t border-sidebar-border/50">
          {NAV.slice(5).map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to || loc.pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className={`size-4.5 ${active ? "text-primary" : ""}`} />
                {n.label}
              </Link>
            );
          })}
          <Link
            to="/worker"
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-primary"
          >
            <ClipboardCheck className="size-4.5" />
            Worker
          </Link>
        </div>
      </nav>
    </div>
  );
}
