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
  const result = await db.query(sql, params);
  notifyMutation(sql);
  return result.rows as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(sql, params);
  notifyMutation(sql);
  return (result.rows[0] as T) ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await db.query(sql, params);
  notifyMutation(sql);
}

export const supabaseAdmin = null;
