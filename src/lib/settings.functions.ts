import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

type SettingsMap = {
  admin_secret_word: string;
  sheets_sync: { enabled: boolean; spreadsheet_id: string | null; auto_minutes: number };
};

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  const rows = await query<{ key: string; value: unknown }>(`SELECT key, value FROM settings`);
  const map: Partial<SettingsMap> = {};
  for (const r of rows) (map as Record<string, unknown>)[r.key] = r.value;
  return {
    admin_secret_word: (map.admin_secret_word as string) ?? "MANOJ",
    sheets_sync: (map.sheets_sync as SettingsMap["sheets_sync"]) ?? {
      enabled: false,
      spreadsheet_id: null,
      auto_minutes: 5,
    },
  };
});

export const setSetting = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ key: z.string().min(1).max(100), value: z.unknown() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [data.key, JSON.stringify(data.value)],
    );
    return { ok: true };
  });

export const updateAdminSecret = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        secret: z
          .string()
          .min(2)
          .max(30)
          .regex(/^[A-Za-z0-9]+$/, "Only letters and numbers"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ('admin_secret_word', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(data.secret.toUpperCase())],
    );
    return { ok: true };
  });

export const getDashboardCounts = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { queryOne } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);
  const [emps, tempos, att, advPending, leavePending] = await Promise.all([
    queryOne<{ total: string; active: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE active) AS active FROM employees`,
    ),
    queryOne<{ active: string }>(`SELECT COUNT(*) FILTER (WHERE active) AS active FROM tempos`),
    queryOne<{ present: string; absent: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('present','late')) AS present,
         COUNT(*) FILTER (WHERE status = 'absent') AS absent
       FROM attendance WHERE attendance_date = $1 AND shift = 'morning'`,
      [today],
    ),
    queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM advances WHERE status = 'pending'`),
    queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM leaves WHERE status = 'pending'`),
  ]);
  return {
    totalEmployees: parseInt(emps?.active ?? "0", 10),
    activeTempos: parseInt(tempos?.active ?? "0", 10),
    presentToday: parseInt(att?.present ?? "0", 10),
    absentToday: parseInt(att?.absent ?? "0", 10),
    pendingAdvances: parseInt(advPending?.count ?? "0", 10),
    pendingLeaves: parseInt(leavePending?.count ?? "0", 10),
  };
});
