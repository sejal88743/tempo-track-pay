// Real browser Supabase client (publishable key). This app has no Supabase
// auth — RLS on public tables is open — so we just talk to the Data API + Realtime.
import { createClient } from "@supabase/supabase-js";

const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://jqiuuysndrholnfmcdob.supabase.co";
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxaXV1eXNuZHJob2xuZm1jZG9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3OTc2OTUsImV4cCI6MjA5NjM3MzY5NX0.kNa4lC-mRITEBk4VTm6z3TQUdh18u3ce4tVfqCEiyA0";

// Only construct on the client — SSR does not need it and localStorage would 500.
export const sb =
  typeof window === "undefined"
    ? (null as unknown as ReturnType<typeof createClient>)
    : createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });

// Stable per-device identifier (never leaves this browser).
const DEVICE_KEY = "tsa_device_id";
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
