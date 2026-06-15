/**
 * Shared RFID access-control domain model.
 *
 * Safe to import from BOTH server (API routes, bridge) and client (React
 * components): it has no Node or browser dependencies. The Ditto feature
 * `accessControl` is the source of truth for the tag registry; this module
 * defines the canonical shapes and validation used everywhere so the dashboard,
 * the API routes, and the bridge cannot drift.
 */

// Number of physical floors (F0..F3) — mirrors firmware NUM_FLOORS / dashboard.
export const ACCESS_NUM_FLOORS = 4;

// Roles map to the command-priority tiers used by the safety gate. Higher
// priority number = preempts lower. emergency/security is handled by the gate
// itself (EMERGENCY_STOP/LOCKDOWN), so the tag roles cover admin..visitor.
export const ROLES = ["ADMIN", "TECHNICIAN", "AGENT", "RESIDENT", "VISITOR"];

export const ROLE_PRIORITY = Object.freeze({
  ADMIN: 80,
  TECHNICIAN: 60,
  AGENT: 40,
  RESIDENT: 20,
  VISITOR: 10,
});

export const ACCESS_DECISIONS = ["GRANTED", "DENIED", "UNKNOWN", "REVOKED"];

/** Normalize a raw UID into the canonical uppercase hex key (no separators). */
export function normalizeUid(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 32);
}

/** True when a uid is a usable Ditto map key / hex UID. */
export function isValidUid(raw) {
  const uid = normalizeUid(raw);
  return uid.length >= 4 && uid.length <= 32;
}

export function normalizeRole(raw) {
  const role = String(raw || "").toUpperCase();
  return ROLES.includes(role) ? role : "VISITOR";
}

/**
 * Normalize the allowed-floors field. Accepts "ALL", an array of floor numbers,
 * or a comma string. Returns "ALL" or a sorted, de-duplicated int array within
 * [0, ACCESS_NUM_FLOORS).
 */
export function normalizeFloors(raw) {
  if (raw === "ALL" || raw == null || raw === "") return "ALL";
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  const set = new Set();
  for (const item of list) {
    const n = Number.parseInt(item, 10);
    if (Number.isInteger(n) && n >= 0 && n < ACCESS_NUM_FLOORS) set.add(n);
  }
  if (set.size === 0) return "ALL";
  return Array.from(set).sort((a, b) => a - b);
}

/** Whether a (normalized) tag may use a given floor. */
export function tagAllowsFloor(tag, floor) {
  if (!tag || tag.enabled === false) return false;
  if (tag.floors === "ALL" || tag.floors == null) return true;
  return Array.isArray(tag.floors) && tag.floors.includes(Number(floor));
}

/**
 * Build a fully-normalized authorized-tag record from an arbitrary input
 * object. `existing` (if provided) preserves created_at and untouched fields on
 * edit. Throws Error on invalid uid.
 */
export function normalizeTag(input = {}, existing = null, nowIso = new Date().toISOString()) {
  const uid = normalizeUid(input.uid ?? existing?.uid);
  if (!isValidUid(uid)) {
    throw new Error("Invalid tag UID — expected 4..32 hex characters");
  }
  const label =
    input.label != null
      ? String(input.label).slice(0, 64)
      : existing?.label || `Tag ${uid}`;
  const role = input.role != null ? normalizeRole(input.role) : normalizeRole(existing?.role);
  const enabled =
    input.enabled != null ? Boolean(input.enabled) : existing?.enabled ?? true;
  const floors =
    input.floors !== undefined ? normalizeFloors(input.floors) : existing?.floors ?? "ALL";
  const note = input.note != null ? String(input.note).slice(0, 240) : existing?.note || "";

  return {
    uid,
    label,
    role,
    enabled,
    floors,
    note,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  };
}

/** Normalize the authorizedTags map read back from Ditto. */
export function normalizeTagMap(rawMap) {
  const out = {};
  if (!rawMap || typeof rawMap !== "object") return out;
  for (const [key, value] of Object.entries(rawMap)) {
    const uid = normalizeUid(value?.uid || key);
    if (!isValidUid(uid)) continue;
    try {
      out[uid] = normalizeTag({ ...value, uid }, value, value?.updated_at || value?.created_at);
    } catch {
      /* skip malformed entries */
    }
  }
  return out;
}

/** Build a normalized access-log entry. */
export function normalizeAccessLogEntry(input = {}, nowIso = new Date().toISOString()) {
  const decision = ACCESS_DECISIONS.includes(String(input.decision).toUpperCase())
    ? String(input.decision).toUpperCase()
    : "UNKNOWN";
  return {
    ts: input.ts || nowIso,
    uid: normalizeUid(input.uid) || "UNKNOWN",
    label: input.label != null ? String(input.label).slice(0, 64) : "",
    role: input.role ? String(input.role).toUpperCase().slice(0, 24) : "",
    decision,
    reason: input.reason != null ? String(input.reason).slice(0, 200) : "",
    elevator_id: input.elevator_id != null ? String(input.elevator_id).slice(0, 64) : "",
    source: input.source != null ? String(input.source).slice(0, 32) : "dashboard",
  };
}
