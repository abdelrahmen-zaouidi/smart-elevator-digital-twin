/**
 * Dispatch Engine runner — Brain A's live loop (the "engine node").
 *
 * A standalone Node process (sibling of services/ditto-bridge/bridge.js). On an interval it:
 *   1. GETs the twin from Eclipse Ditto (the source of truth);
 *   2. calls the pure orchestrator planDispatchUpdate() — Brain A decision +
 *      shadow brains + a read-only gate preview;
 *   3. when the policy changed and the preview is admissible, POSTs the
 *      SET_DISPATCH_POLICY command to the dashboard's /api/commands endpoint.
 *
 * The authoritative safety gate, audit, command-log persistence and Ditto write
 * all live in /api/commands — this runner reuses them rather than duplicating a
 * second write path. It therefore needs the Next.js dashboard running, exactly
 * as bridge.js needs the MQTT broker.
 *
 * All decision logic is in packages/shared/dispatch/* and is unit-tested. This
 * file is intentionally thin I/O glue: it must never crash the loop on an error.
 *
 * Usage:
 *   node services/dispatch/dispatchEngine.mjs            # loop
 *   node services/dispatch/dispatchEngine.mjs --once     # single tick, exit
 *   node services/dispatch/dispatchEngine.mjs --dry-run  # decide + log, no POST
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planDispatchUpdate } from "../../packages/shared/dispatch/orchestrator.js";
import {
  createScorerBrain, createMlBrain, createMlBrainFromSpec, SEED_ML_MODEL,
} from "../../packages/shared/dispatch/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// Minimal .env loader (mirrors bridge.js so the two share configuration).
// -----------------------------------------------------------------------------
function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.resolve(__dirname, "../../.env"));
loadEnvFile(path.resolve(__dirname, "../../.env.local"), { override: true });

const DITTO_URL = (process.env.DITTO_URL || process.env.NEXT_PUBLIC_DITTO_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const DITTO_AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");
const THING_ID = process.env.THING_ID || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const COMMANDS_API_URL = process.env.DISPATCH_COMMANDS_URL || `${DASHBOARD_URL}/api/commands`;
const LOG_API_URL = process.env.DISPATCH_LOG_URL || `${DASHBOARD_URL}/api/dispatch/log`;
const DECISION_LOGGING = String(process.env.DISPATCH_DECISION_LOGGING || "true").toLowerCase() === "true";
const SIGNALS_URL = process.env.DISPATCH_SIGNALS_URL || null;     // optional hall-call/tariff feed
const INTERVAL_MS = Number.parseInt(process.env.DISPATCH_INTERVAL_MS || "15000", 10);
const HTTP_TIMEOUT_MS = Number.parseInt(process.env.DISPATCH_HTTP_TIMEOUT_MS || "8000", 10);

const ARGS = new Set(process.argv.slice(2));
const ONCE = ARGS.has("--once");
const DRY_RUN = ARGS.has("--dry-run");

// Champion / challenger configuration. DISPATCH_ACTIVE_BRAIN flips which brain
// is BINDING (the promotion flag); DISPATCH_SHADOW_BRAINS lists the others that
// run in shadow (recorded, never applied). Default: scorer_v1 active, ml_v1 shadow.
const ACTIVE_BRAIN_ID = process.env.DISPATCH_ACTIVE_BRAIN || "scorer_v1";
const SHADOW_BRAIN_IDS = (process.env.DISPATCH_SHADOW_BRAINS || "ml_v1")
  .split(",").map((s) => s.trim()).filter(Boolean).filter((id) => id !== ACTIVE_BRAIN_ID);
const ML_MODEL_PATH = process.env.DISPATCH_ML_MODEL_PATH
  || path.resolve(__dirname, "../../packages/shared/dispatch/models/ml_v1.json");

const log = (...a) => console.log(new Date().toISOString(), "[dispatch-engine]", ...a);

function loadMlModel() {
  try {
    if (fs.existsSync(ML_MODEL_PATH)) {
      return JSON.parse(fs.readFileSync(ML_MODEL_PATH, "utf8"));
    }
  } catch (e) {
    log("ML model load failed, using seed:", e.message);
  }
  return SEED_ML_MODEL;
}

function makeBrain(id) {
  if (id === "scorer_v1") return createScorerBrain();
  if (id === "ml_v1" || id.startsWith("ml")) {
    const model = loadMlModel();
    return model === SEED_ML_MODEL ? createMlBrain(model) : createMlBrainFromSpec(model);
  }
  log(`unknown brain '${id}', falling back to scorer_v1`);
  return createScorerBrain();
}

const ACTIVE_BRAIN = makeBrain(ACTIVE_BRAIN_ID);
const SHADOW_BRAINS = SHADOW_BRAIN_IDS.map(makeBrain);

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the twin and stamp last_telemetry_at so the gate's fresh-twin check can
// run (same convention as /api/commands loadTwinSnapshot).
async function loadTwin() {
  const url = `${DITTO_URL}/api/2/things/${encodeURIComponent(THING_ID)}`;
  try {
    const { ok, status, body } = await fetchJson(url, {
      headers: { Authorization: DITTO_AUTH, Accept: "application/json" },
    });
    if (!ok || !body) return { twin: null, reachable: false, status };
    body.last_telemetry_at = body._modified || new Date().toISOString();
    return { twin: body, reachable: true };
  } catch (e) {
    // A Ditto outage MUST degrade to a skipped tick, not a crashed loop.
    return { twin: null, reachable: false, error: e.message };
  }
}

// Optional external signals (hall-call tables, tariff window, kWh budget). The
// engine runs fine without them — it just decides at lower confidence.
async function loadSignals() {
  if (!SIGNALS_URL) return {};
  try {
    const { ok, body } = await fetchJson(SIGNALS_URL, { headers: { Accept: "application/json" } });
    return ok && body && typeof body === "object" ? body : {};
  } catch (e) {
    log("signals fetch failed:", e.message);
    return {};
  }
}

async function tick() {
  const { twin, reachable, status } = await loadTwin();
  if (!reachable) {
    log("Ditto unreachable, skipping tick", status ? `(HTTP ${status})` : "");
    return;
  }
  const signals = await loadSignals();
  const plan = planDispatchUpdate(twin, {
    now: Date.now(),
    signals,
    thing_id: THING_ID,
    ditto_reachable: true,
    brain: ACTIVE_BRAIN,
    shadowBrains: SHADOW_BRAINS,
  });

  const d = plan.decision;
  const shadowStr = plan.shadow.length
    ? " | shadow: " + plan.shadow.map((s) => `${s.brain}=${s.decision?.policy_id || s.error}`).join(",")
    : "";
  log(`active=${d.policy_id} conf=${d.confidence ?? "-"} changed=${plan.changed} dispatch=${plan.should_dispatch}${shadowStr}`);
  if (d.reason) log("reason:", d.reason);

  let commandId = null;
  if (plan.should_dispatch && !DRY_RUN) {
    const { ok, status: postStatus, body } = await fetchJson(COMMANDS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan.command),
    });
    if (ok && body?.decision === "ACCEPTED") {
      commandId = body.command_id || null;
      log(`dispatched -> ${plan.command.policy_id} (command_id ${commandId})`);
    } else {
      log(`dispatch rejected (HTTP ${postStatus}):`, body?.rejection_reasons || body?.error || "unknown");
    }
  } else if (plan.should_dispatch && DRY_RUN) {
    log("[dry-run] would POST:", plan.command.policy_id, JSON.stringify(plan.command.dispatch_params));
  } else if (plan.skip_reason) {
    log("no-op:", plan.skip_reason);
  }

  // Best-effort decision logging for audit + Brain B training. Never fatal.
  await logDecision(plan, commandId);
}

async function logDecision(plan, commandId) {
  if (!DECISION_LOGGING || DRY_RUN) return;
  try {
    await fetchJson(LOG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thing_id: THING_ID,
        decision: plan.decision,
        shadow: plan.shadow,
        changed: plan.changed,
        should_dispatch: plan.should_dispatch,
        command_id: commandId,
      }),
    });
  } catch (e) {
    log("decision log failed:", e.message);
  }
}

async function main() {
  log(`starting — active=${ACTIVE_BRAIN.id} shadow=[${SHADOW_BRAINS.map((b) => b.id).join(",") || "none"}] Ditto=${DITTO_URL} thing=${THING_ID} interval=${INTERVAL_MS}ms${DRY_RUN ? " [DRY-RUN]" : ""}`);
  const runGuarded = async () => {
    try { await tick(); } catch (e) { log("tick error:", e.message); }
  };
  await runGuarded();
  if (ONCE) return;
  setInterval(runGuarded, INTERVAL_MS);
}

main();
