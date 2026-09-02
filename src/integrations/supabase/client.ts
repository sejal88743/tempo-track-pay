import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  (typeof process !== "undefined" && process.env.SUPABASE_URL) ||
  "https://jqiuuysndrholnfmcdob.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (typeof process !== "undefined" && process.env.SUPABASE_PUBLISHABLE_KEY) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxaXV1eXNuZHJob2xuZm1jZG9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3OTc2OTUsImV4cCI6MjA5NjM3MzY5NX0.kNa4lC-mRITEBk4VTm6z3TQUdh18u3ce4tVfqCEiyA0";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
