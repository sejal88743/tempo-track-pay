/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

let _admin: ReturnType<typeof createClient> | null = null;

function getAdmin() {
  if (!_admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.");
    }
    _admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, {
  get(_t, prop) {
    return (getAdmin() as any)[prop];
  },
});

async function execSql(sql: string, params: unknown[] = []): Promise<any[]> {
  const admin = getAdmin() as any;
  const { data, error } = await admin.rpc("exec_sql", { sql, params });
  if (error) throw new Error(error.message);
  return (data as any[]) ?? [];
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await execSql(sql, params)) as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await execSql(sql, params);
  return (rows[0] as T) ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await execSql(sql, params);
}
