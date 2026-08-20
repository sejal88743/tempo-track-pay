// Auth middleware — Supabase replaced with cookie-based session auth.
// Use requireAdmin() or requireWorker() from src/lib/session.server.ts instead.
// This file is kept to avoid breaking any stray imports.
import { createMiddleware } from "@tanstack/react-start";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    throw new Error("requireSupabaseAuth is not available. Use session.server.ts instead.");
    return next({ context: {} });
  },
);
