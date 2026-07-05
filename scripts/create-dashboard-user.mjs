#!/usr/bin/env node
/*
 * Create or update a dashboard user (Auth.js credentials, migration 010).
 * Passwords are bcrypt-hashed here and never stored/committed in plaintext.
 *
 * Usage (from repo root, with the DB reachable):
 *   node scripts/create-dashboard-user.mjs <username> <role> [password]
 *     role: viewer | operator | maintainer | admin
 *   If password is omitted it is read from the DASHBOARD_USER_PASSWORD env var,
 *   or a random one is generated and printed once.
 *
 * DB connection reuses the same env as the dashboard/n8n:
 *   POSTGRES_HOST (default 127.0.0.1), POSTGRES_PORT, POSTGRES_DB,
 *   POSTGRES_USER, POSTGRES_PASSWORD.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const ROLES = ["viewer", "operator", "maintainer", "admin"];

const [username, role, passwordArg] = process.argv.slice(2);
if (!username || !role) {
  console.error("usage: node scripts/create-dashboard-user.mjs <username> <role> [password]");
  console.error("  role:", ROLES.join(" | "));
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`invalid role '${role}'. one of: ${ROLES.join(", ")}`);
  process.exit(1);
}

let password = passwordArg || process.env.DASHBOARD_USER_PASSWORD;
let generated = false;
if (!password) {
  password = randomBytes(9).toString("base64url");
  generated = true;
}

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || "127.0.0.1",
  port: Number.parseInt(process.env.POSTGRES_PORT || "5432", 10),
  database: process.env.POSTGRES_DB || "smart_building",
  user: process.env.POSTGRES_USER || "admin",
  password: process.env.POSTGRES_PASSWORD || "change_me_local_only",
});

const hash = await bcrypt.hash(String(password), 12);

try {
  const { rows } = await pool.query(
    `INSERT INTO dashboard_users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                          role = EXCLUDED.role,
                                          disabled = false
     RETURNING id, username, role`,
    [username, hash, role],
  );
  const u = rows[0];
  console.log(`OK: user '${u.username}' (id ${u.id}) role '${u.role}' upserted.`);
  if (generated) console.log(`Generated password (store it now, shown once): ${password}`);
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
