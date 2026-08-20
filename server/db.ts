/* eslint-disable @typescript-eslint/no-explicit-any */
import pg from "pg";

const { Pool } = pg;

let pool: any;

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  } else {
    pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
    };
  }
} catch {
  console.warn("DB not connected — mock active");
  pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
  };
}

const db = pool;

export { pool, db };
