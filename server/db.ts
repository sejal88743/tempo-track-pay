import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Connect the Replit PostgreSQL database first.");
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("[postgres-pool]", error);
});

export const db = pool;

type ChangeListener = (change: {
  table?: string;
  eventType?: "INSERT" | "UPDATE" | "DELETE";
  row?: Record<string, unknown> | null;
}) => void;

const listeners = new Set<ChangeListener>();
let revision = 0;

export function getDataRevision() {
  return revision;
}

export function subscribeToDataChanges(listener: ChangeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastDataChange(change: {
  table?: string;
  eventType?: "INSERT" | "UPDATE" | "DELETE";
  row?: Record<string, unknown> | null;
} = {}) {
  revision += 1;
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (error) {
      console.error("[sync-listener]", error);
    }
  }
}
