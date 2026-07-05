/**
 * Server-side dashboard user store (backs the Auth.js credentials provider and
 * the seed script). Reads the dashboard_users table (migration 010) and
 * verifies bcrypt password hashes. NEVER import from client code.
 */
import bcrypt from "bcryptjs";
import { queryRows } from "./db.js";
import { normalizeRole } from "./authRoles.js";

/**
 * Verify a username/password against dashboard_users.
 * @returns {Promise<{id, username, role}|null>} the user on success, else null.
 */
export async function verifyCredentials(username, password) {
  if (!username || !password) return null;
  let rows;
  try {
    rows = await queryRows(
      "SELECT id, username, password_hash, role, disabled FROM dashboard_users WHERE username = $1",
      [String(username)],
    );
  } catch {
    // Table missing (migration not applied) or DB down -> no DB-backed auth.
    return null;
  }
  const user = rows[0];
  if (!user || user.disabled) return null;

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return null;

  // Best-effort last-login stamp; never blocks auth.
  queryRows("UPDATE dashboard_users SET last_login_at = now() WHERE id = $1", [user.id]).catch(() => {});

  return { id: String(user.id), username: user.username, role: normalizeRole(user.role) };
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}
