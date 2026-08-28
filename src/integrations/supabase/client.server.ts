/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  db,
  broadcastDataChange,
  getDataRevision,
  subscribeToDataChanges,
} from "../../../server/db";

export { broadcastDataChange, getDataRevision, subscribeToDataChanges };

const mutationPattern = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i;

function notifyMutation(sql: string) {
  if (mutationPattern.test(sql)) broadcastDataChange({ table: "__all__" });
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await db.query(sql, params);
    notifyMutation(sql);
    return (result?.rows ?? []) as T[];
  } catch (error) {
    console.warn("[db query error]", (error as Error).message);
    return [];
  }
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    const result = await db.query(sql, params);
    notifyMutation(sql);
    return (result?.rows?.[0] as T) ?? null;
  } catch (error) {
    console.warn("[db queryOne error]", (error as Error).message);
    return null;
  }
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  try {
    await db.query(sql, params);
    notifyMutation(sql);
  } catch (error) {
    console.warn("[db execute error]", (error as Error).message);
  }
}

export const supabaseAdmin = null;
