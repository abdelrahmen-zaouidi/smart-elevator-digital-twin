/**
 * GET /api/system/health — read-only aggregate health of every platform
 * dependency the dashboard relies on. Powers the SystemHealthStrip in the
 * top bar and gives operators/demos one endpoint to check.
 *
 * Probes (parallel, individually caught, 2 s hard timeout each; NEVER writes):
 *   ditto    — GET the Thing's microcontroller feature via Ditto REST.
 *   bridge   — HEURISTIC: the bridge is the only writer of telemetry into the
 *              twin, so fresh last_telemetry_at/last_status_at implies a live
 *              bridge. A stale twin can mean bridge down OR device offline —
 *              reported as "degraded", never "down", and the detail says so.
 *   postgres — SELECT 1 via the existing server pool (src/server/db.js ping()).
 *   mqtt     — TCP reachability of the broker's host-published listener.
 *              Deliberately unauthenticated socket connect only: proves the
 *              listener is up without granting this route a broker identity.
 *   n8n      — GET the n8n /healthz endpoint.
 *
 * Responses are cached 5 s (module scope, hot-reload safe) so a polling UI
 * cannot stampede the dependencies.
 */
import { NextResponse } from "next/server";
import net from "node:net";
import { ping } from "../../../../src/server/db.js";
import { deriveBridge, overallStatus } from "../../../../src/server/healthHelpers.js";
import { log } from "../../../../src/server/log.js";
import { recordHealth } from "../../../../src/server/metrics.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 5000;

const DITTO_URL = (
  process.env.DITTO_URL ||
  process.env.DITTO_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_DITTO_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");
const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const THING_ID =
  process.env.NEXT_PUBLIC_THING_ID ||
  process.env.PRIMARY_THING_ID ||
  process.env.THING_ID ||
  "building:floor1:elevator";
const OFFLINE_AFTER_MS = Number.parseInt(process.env.MICROCONTROLLER_OFFLINE_AFTER_MS || "15000", 10);

// The dashboard runs on the HOST, so docker-internal names like "mosquitto"
// don't resolve here — default to the published listener on localhost and let
// MQTT_HEALTH_HOST/MQTT_HEALTH_PORT override for unusual setups.
const MQTT_HOST = process.env.MQTT_HEALTH_HOST || "127.0.0.1";
const MQTT_PORT = Number.parseInt(process.env.MQTT_HEALTH_PORT || "1883", 10);

const N8N_HEALTH_URL = process.env.N8N_HEALTH_URL || "http://localhost:5678/healthz";

const DITTO_AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");

const timed = async (probe) => {
  const start = Date.now();
  try {
    const result = await probe();
    return { latency_ms: Date.now() - start, ...result };
  } catch (error) {
    return {
      status: "down",
      latency_ms: Date.now() - start,
      detail: error?.name === "TimeoutError" ? `timeout after ${PROBE_TIMEOUT_MS}ms` : (error?.message || "probe failed"),
    };
  }
};

async function probeDitto() {
  const url = `${DITTO_URL}/api/2/things/${encodeURIComponent(THING_ID)}?fields=features/microcontroller`;
  const res = await fetch(url, {
    headers: { Authorization: DITTO_AUTH },
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { status: "down", detail: `HTTP ${res.status} from Ditto`, thing: null };
  }
  const thing = await res.json().catch(() => null);
  return { status: "ok", detail: `thing ${THING_ID} readable`, thing };
}

async function probePostgres() {
  const result = await ping();
  return result.ok
    ? { status: "ok", detail: "SELECT 1 ok" }
    : { status: "down", detail: result.error || "ping failed" };
}

function probeMqtt() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: MQTT_HOST, port: MQTT_PORT });
    const fail = (message) => { socket.destroy(); reject(new Error(message)); };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => fail(`TCP timeout to ${MQTT_HOST}:${MQTT_PORT}`));
    socket.once("error", (error) => fail(`${error.code || error.message} to ${MQTT_HOST}:${MQTT_PORT}`));
    socket.once("connect", () => {
      socket.destroy();
      resolve({ status: "ok", detail: `listener reachable at ${MQTT_HOST}:${MQTT_PORT} (TCP only — auth not exercised)` });
    });
  });
}

async function probeN8n() {
  const res = await fetch(N8N_HEALTH_URL, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (res.ok) return { status: "ok", detail: `HTTP ${res.status} from ${N8N_HEALTH_URL}` };
  return { status: "degraded", detail: `HTTP ${res.status} from ${N8N_HEALTH_URL}` };
}

export async function GET() {
  const g = globalThis;
  if (g._systemHealthCache && Date.now() - g._systemHealthCache.at < CACHE_TTL_MS) {
    return NextResponse.json(g._systemHealthCache.payload);
  }

  const [ditto, postgres, mqtt, n8n] = await Promise.all([
    timed(probeDitto),
    timed(probePostgres),
    timed(probeMqtt),
    timed(probeN8n),
  ]);
  const bridge = deriveBridge(ditto, OFFLINE_AFTER_MS);
  delete ditto.thing; // internal detail, not part of the response contract

  const checks = { ditto, bridge, mqtt, postgres, n8n };
  const payload = { status: overallStatus(checks), checks, ts: new Date().toISOString() };
  recordHealth(payload);

  // Log only when degraded/down (fires at most once per cache TTL), naming the
  // failing dependencies — probe failures are otherwise only in the response.
  if (payload.status !== "ok") {
    const failing = Object.entries(checks)
      .filter(([, c]) => c.status !== "ok")
      .map(([name, c]) => `${name}:${c.status}`);
    log.warn("platform health degraded", { event: "health_degraded", status: payload.status, failing });
  }

  g._systemHealthCache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
