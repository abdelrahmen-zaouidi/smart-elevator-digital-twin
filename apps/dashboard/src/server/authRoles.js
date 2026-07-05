/**
 * Role model + RBAC decisions for the dashboard. Pure functions (no I/O) so
 * the command route's authorization is unit-testable in isolation.
 *
 * Roles (ascending capability):
 *   viewer      - read-only; may NOT issue commands
 *   operator    - may issue operator commands (safety gate risk cap applies)
 *   maintainer  - operator + access-control mutations
 *   admin       - everything + user management
 */
export const ROLES = ["viewer", "operator", "maintainer", "admin"];

const RANK = { viewer: 0, operator: 1, maintainer: 2, admin: 3 };

export function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  return ROLES.includes(r) ? r : "viewer";
}

/** Can this role issue commands through the safety gate? */
export function canIssueCommands(role) {
  return RANK[normalizeRole(role)] >= RANK.operator;
}

/** Can this role mutate access-control (RFID tags)? */
export function canMutateAccessControl(role) {
  return RANK[normalizeRole(role)] >= RANK.maintainer;
}

/** Map a dashboard role to the safety gate's actor source. The gate already
 *  distinguishes operator (risk cap 85) from autonomous (70); every human role
 *  maps to the operator actor, so RBAC gates ACCESS to the route while the gate
 *  keeps its deterministic authority over admission. */
export function gateSourceForRole(role) {
  return canIssueCommands(role) ? "dashboard" : "denied";
}
