import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function todayDDMM_IST() {
  // Date.now() is always UTC ms — just add IST offset (5h 30m)
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}`;
}

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  const { getSession } = await import("./session.server");
  const s = await getSession();
  if (!s) return null;
  return { role: s.role, subject_id: s.subject_id, display_name: s.display_name };
});

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("@/integrations/supabase/client.server");
    const { createSession } = await import("./session.server");
    const row = await queryOne<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'admin_secret_word'`,
    );
    const secret = ((row?.value as string) || "MANOJ").toUpperCase();
    const expected = todayDDMM_IST() + secret;
    if (data.password.toUpperCase() !== expected) {
      throw new Error("Galat password. Aaj ka password: DDMM + secret word.");
    }
    await createSession({ role: "admin", display_name: "Admin" });
    return { ok: true };
  });

export const workerLogin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        employee_code: z.string().min(1).max(64),
        password: z.string().min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { queryOne } = await import("@/integrations/supabase/client.server");
    const { createSession } = await import("./session.server");
    const bcrypt = (await import("bcryptjs")).default;
    const emp = await queryOne<{ id: string; full_name: string; active: boolean }>(
      `SELECT id, full_name, active FROM employees WHERE employee_code = $1`,
      [data.employee_code.trim()],
    );
    if (!emp || !emp.active) throw new Error("Worker not found ya inactive hai.");
    const cred = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM worker_credentials WHERE employee_id = $1`,
      [emp.id],
    );
    if (!cred) throw new Error("Password set nahi hua. Admin se contact karein.");
    const ok = await bcrypt.compare(data.password, cred.password_hash);
    if (!ok) throw new Error("Galat password.");
    await createSession({ role: "worker", subject_id: emp.id, display_name: emp.full_name });
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { destroySession } = await import("./session.server");
  await destroySession();
  return { ok: true };
});

export const todayAdminFormulaHint = createServerFn({ method: "GET" }).handler(async () => {
  return { formula: "DDMM + SECRET (e.g. 0706MANOJ)", today_prefix: todayDDMM_IST() };
});
