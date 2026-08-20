import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { query, queryOne, execute } from "@/integrations/supabase/client.server";
import { randomBytes } from "crypto";

const COOKIE = "tsa_session";
const MAX_AGE = 60 * 60 * 12; // 12h

export type SessionRow = {
  token: string;
  role: "admin" | "worker";
  subject_id: string | null;
  display_name: string | null;
  expires_at: string;
};

export async function createSession(input: {
  role: "admin" | "worker";
  subject_id?: string | null;
  display_name?: string | null;
}) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + MAX_AGE * 1000);
  await execute(
    `INSERT INTO sessions (token, role, subject_id, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      token,
      input.role,
      input.subject_id ?? null,
      input.display_name ?? null,
      expires.toISOString(),
    ],
  );
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: MAX_AGE,
  });
  return token;
}

export async function getSession(): Promise<SessionRow | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const row = await queryOne<SessionRow>(
    `SELECT token, role, subject_id, display_name, expires_at
     FROM sessions WHERE token = $1`,
    [token],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await execute(`DELETE FROM sessions WHERE token = $1`, [token]);
    return null;
  }
  return row;
}

export async function destroySession() {
  const token = getCookie(COOKIE);
  if (token) await execute(`DELETE FROM sessions WHERE token = $1`, [token]);
  deleteCookie(COOKIE, { path: "/" });
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("UNAUTHORIZED");
  return s;
}

export async function requireWorker() {
  const s = await getSession();
  if (!s || s.role !== "worker" || !s.subject_id) throw new Error("UNAUTHORIZED");
  return s;
}
