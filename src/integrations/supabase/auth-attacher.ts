// Auth attacher — Supabase replaced with cookie-based session auth.
// Sessions are set server-side as httpOnly cookies; no client-side token attachment needed.
// This file is kept to avoid breaking any stray imports.
import { createMiddleware } from "@tanstack/react-start";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    return next({ headers: {} });
  },
);
