/**
 * Browser-side client for the RFID access-control API.
 *
 * Mirrors the pattern of commandClient.js: the browser never writes Ditto or
 * Postgres directly. It calls the dashboard's /api/access-control/* routes,
 * which hold the Ditto identity and the DB pool. Every function returns a plain
 * result envelope and never throws.
 */

import { env } from "../config/env.js";
import { fetchJson } from "./httpClient.js";

const BASE = "/api/access-control";

async function request(path, options = {}) {
  try {
    // fetchJson applies a timeout and idempotency-aware retry/backoff: GET reads
    // and PUT/DELETE tag mutations are replayed on transient failures; POSTs
    // (createTag, recordAccessEvent) are not, to avoid duplicate writes.
    const { ok, status, data } = await fetchJson(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!ok) {
      return { ok: false, error: data?.error || `HTTP ${status}`, ...data };
    }
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: `NETWORK: ${error.message}` };
  }
}

const thingQuery = (thingId) => `thing_id=${encodeURIComponent(thingId || env.THING_ID)}`;

export function listTags(thingId = env.THING_ID) {
  return request(`/tags?${thingQuery(thingId)}`, { method: "GET" });
}

export function createTag(tag, thingId = env.THING_ID) {
  return request(`/tags`, {
    method: "POST",
    body: JSON.stringify({ ...tag, thing_id: thingId }),
  });
}

export function updateTag(tag, thingId = env.THING_ID) {
  return request(`/tags`, {
    method: "PUT",
    body: JSON.stringify({ ...tag, thing_id: thingId }),
  });
}

export function setTagEnabled(uid, enabled, thingId = env.THING_ID) {
  return updateTag({ uid, enabled }, thingId);
}

export function deleteTag(uid, thingId = env.THING_ID) {
  return request(`/tags?uid=${encodeURIComponent(uid)}&${thingQuery(thingId)}`, {
    method: "DELETE",
  });
}

export function listAccessLogs({ limit = 100, decision, thingId = env.THING_ID } = {}) {
  const params = [thingQuery(thingId), `limit=${limit}`];
  if (decision) params.push(`decision=${encodeURIComponent(decision)}`);
  return request(`/logs?${params.join("&")}`, { method: "GET" });
}

/**
 * Record a real access event (used to replace the old fake/local RFID inject).
 * decision: GRANTED | DENIED | UNKNOWN | REVOKED
 */
export function recordAccessEvent(event, thingId = env.THING_ID) {
  return request(`/logs`, {
    method: "POST",
    body: JSON.stringify({ source: "dashboard", ...event, thing_id: thingId }),
  });
}
