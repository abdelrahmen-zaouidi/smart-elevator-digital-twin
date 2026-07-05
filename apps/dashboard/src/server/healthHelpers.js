/**
 * Pure helpers for GET /api/system/health. Extracted from the route so they
 * can be unit-tested without importing `pg`/`node:net` (the route's probes).
 * No side effects, no I/O — just the two decision functions.
 */

/**
 * Derive bridge health from the Ditto probe result. The bridge is the only
 * writer of telemetry into the twin, so a fresh twin implies a live bridge.
 * A stale twin is ambiguous (bridge down OR device offline) -> "degraded",
 * never "down".
 * @param {{status:string, thing?:object}} ditto  result of the Ditto probe
 * @param {number} offlineAfterMs                 MICROCONTROLLER_OFFLINE_AFTER_MS
 * @param {number} nowMs                          injected clock (defaults Date.now)
 */
export function deriveBridge(ditto, offlineAfterMs, nowMs = Date.now()) {
  if (ditto.status !== "ok" || !ditto.thing) {
    return { status: "degraded", latency_ms: null, detail: "cannot assess: Ditto unreachable (bridge writes through Ditto)" };
  }
  const props = ditto.thing?.features?.microcontroller?.properties || {};
  const lastSeen = Date.parse(props.last_telemetry_at || "") || Date.parse(props.last_status_at || "") || 0;
  if (!lastSeen) {
    return { status: "degraded", latency_ms: null, detail: "no telemetry timestamps in twin yet (heuristic: fresh twin = live bridge)" };
  }
  const ageMs = nowMs - lastSeen;
  if (ageMs <= offlineAfterMs * 2) {
    return { status: "ok", latency_ms: null, detail: `twin fresh (${Math.round(ageMs / 1000)}s old) — bridge merging` };
  }
  return {
    status: "degraded",
    latency_ms: null,
    detail: `no telemetry for ${Math.round(ageMs / 1000)}s — device offline or bridge down (heuristic)`,
  };
}

/**
 * Roll per-dependency statuses into an overall verdict. The platform is only
 * "down" when both the twin and ingestion are gone; otherwise "degraded".
 * @param {Record<string,{status:string}>} checks
 */
export function overallStatus(checks) {
  const values = Object.values(checks).map((c) => c.status);
  if (values.every((s) => s === "ok")) return "ok";
  if (checks.ditto?.status === "down" && checks.mqtt?.status === "down") return "down";
  return "degraded";
}
