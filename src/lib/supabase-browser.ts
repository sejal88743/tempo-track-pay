import { supabase } from "@/integrations/supabase/client";

// The real Supabase client connected to the user's Supabase project
export const sb = supabase;

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
