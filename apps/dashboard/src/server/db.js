/**
 * Server-side PostgreSQL pool.
 * NEVER import this file from client-side code (pages, components, hooks).
 * Only API route handlers (app/api/**) should import this.
 *
 * Host config difference:
 *   - Dashboard runs on the Windows host → use POSTGRES_HOST=127.0.0.1
 *   - n8n/bridge run inside Docker      → use POSTGRES_HOST=postgres
 * Set POSTGRES_HOST in dashboard/.env.local for local development.
 */
import { Pool } from "pg";

// Guard against duplicate pools across Next.js hot reloads in development.
const g = globalThis;

if (!g._elevatorPgPool) {
  g._elevatorPgPool = new Pool({
    host:     process.env.POSTGRES_HOST     || "127.0.0.1",
    port:     parseInt(process.env.POSTGRES_PORT || "5432", 10),
    database: process.env.POSTGRES_DB       || "smart_building",
    user:     process.env.POSTGRES_USER     || "admin",
    password: process.env.POSTGRES_PASSWORD || "change_me_local_only",
    max:                5,
    idleTimeoutMillis:  30_000,
    connectionTimeoutMillis: 5_000,
  });

  g._elevatorPgPool.on("error", (err) => {
    console.error("[db] idle client error", err.message);
  });
}

const pool = g._elevatorPgPool;

/**
 * Run a parameterized query and return the raw pg Result.
 * Throws on connection or query errors.
 */
export async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query({ text: sql, values: params, query_timeout: 8000 });
  } finally {
    client.release();
  }
}

/**
 * Run a parameterized query and return only the rows array.
 */
export async function queryRows(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Ping the database. Returns { ok: true, latency_ms } or { ok: false, error }.
 */
export async function ping() {
  const start = Date.now();
  try {
    await query("SELECT 1");
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
