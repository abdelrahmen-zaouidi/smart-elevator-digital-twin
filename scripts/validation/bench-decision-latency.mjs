#!/usr/bin/env node
/**
 * Deterministic decision-path microbenchmarks (paper GAPS M4 + M7) and the
 * in-process "cost of safety".
 *
 * WHAT THIS MEASURES (and what it does NOT):
 *   - The CPU time of the deterministic safety gate `validateCommand(...)` and
 *     of the active Brain A dispatch decision, in this process, with no I/O.
 *   - The added in-process computation of the safety-gated admission path
 *     versus a direct dashboard->MQTT serialization ("cost of safety").
 *
 *   It does NOT measure end-to-end command latency, MQTT round-trip, or Ditto
 *   synchronisation (those cross the network/DB and are GAPS M1/M2/M3/M6).
 *   It is NOT the test-suite duration reported by the node:test runner.
 *
 * Run from repo root:
 *   node scripts/validation/bench-decision-latency.mjs
 *   node scripts/validation/bench-decision-latency.mjs --json evidence/perf/decision-latency.json
 */

import os from "node:os";
import fs from "node:fs";

import {
  validateCommand,
  _resetCooldownLedgerForTests,
} from "../../packages/shared/commandSafetyGate.js";
import {
  decideFromTwin,
  buildContext,
  createScorerBrain,
  planDispatchUpdate,
} from "../../packages/shared/dispatch/index.js";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const N = 20000;       // timed samples per class
const WARMUP = 5000;   // untimed warmup iterations (JIT)
const jsonArg = (() => {
  const i = process.argv.indexOf("--json");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// -----------------------------------------------------------------------------
// Fixtures (mirror the validation-suite fixtures so inputs are representative)
// -----------------------------------------------------------------------------
const NOW_MS = Date.parse("2026-05-13T20:00:00Z");
const FRESH_TS = "2026-05-13T19:59:55Z"; // 5 s old, within MAX_TWIN_AGE

function freshTwin(overrides = {}) {
  return {
    last_telemetry_at: FRESH_TS,
    attributes: { system_mode: "NORMAL", risk_score: 10, system_health_index: 100,
      ...(overrides.attributes || {}) },
    features: {
      cabin: { properties: { current_floor: 0, target_floor: 0, direction: "IDLE",
        emergency_stop: false, load_kg: 100, ...(overrides.cabin || {}) } },
      door: { properties: { state: "CLOSED", door_forced_entry: false,
        ...(overrides.door || {}) } },
      motor: { properties: { temperature_c: 40, vibration_level: 0.02, power_kw: 2.0,
        current_draw_a: 5 } },
      energy: { properties: { kwh_today: 3, kwh_baseline: 2, power_kw: 2.0 } },
      security: { properties: { alert_level: "NORMAL", active_security_incident: false,
        unauthorized_access_attempts: 0 } },
      predicted_failures: { properties: { motor_rul_hours: 9500, bearing_health_pct: 98 } },
    },
  };
}
const TWIN_OK = freshTwin();
const TWIN_ESTOP = freshTwin({ cabin: { emergency_stop: true } });
const GATE_CTX = { now: NOW_MS, max_load_kg: 800 };

// Command classes: one accepted, three distinct rejection paths.
const CMD_ACCEPTED = { command: "MOVE_TO_FLOOR", target_floor: 3, source: "dashboard",
  source_agent: "operator-1", reason: "passenger request" };
const CMD_UNKNOWN = { command: "DROP_CABIN", source: "dashboard",
  source_agent: "op", reason: "x", confirmation: true };
const CMD_UNSAFE = { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
  source_agent: "operator-1", reason: "passenger request" };
const CMD_UNCONFIRMED = { command: "EMERGENCY_STOP", source: "dashboard",
  source_agent: "operator-1", reason: "test" };

// Dispatch fixtures
const DISP_NOW = Date.parse("2026-05-31T08:00:00Z");
const DISP_SIGNALS = { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4,
  predicted_demand_floor: 3 };
const DISP_CTX = buildContext(TWIN_OK, { now: DISP_NOW, signals: DISP_SIGNALS });
const SCORER = createScorerBrain();

// -----------------------------------------------------------------------------
// Statistics + timing helpers
// -----------------------------------------------------------------------------
function stats(samplesUs) {
  const s = Float64Array.from(samplesUs).sort();
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return {
    n,
    mean_us: mean, median_us: q(0.5), p95_us: q(0.95), p99_us: q(0.99),
    min_us: s[0], max_us: s[n - 1], stddev_us: Math.sqrt(variance),
  };
}

/** Per-call timing with process.hrtime.bigint(); `before` runs untimed. */
function timeEach({ n = N, warmup = WARMUP, before, call }) {
  for (let i = 0; i < warmup; i++) { if (before) before(i); call(i); }
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (before) before(i);
    const t0 = process.hrtime.bigint();
    call(i);
    const t1 = process.hrtime.bigint();
    samples[i] = Number(t1 - t0) / 1000; // ns -> microseconds
  }
  return { stats: stats(samples), samples };
}

/** Batch timing for sub-microsecond ops: mean per call over many blocks. */
function timeBatchedMean({ blocks = 100, per = 2000, call }) {
  for (let i = 0; i < per; i++) call(i); // warmup
  let best = Infinity, sum = 0;
  for (let b = 0; b < blocks; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < per; i++) call(i);
    const t1 = process.hrtime.bigint();
    const perCall = Number(t1 - t0) / 1000 / per; // us/call
    sum += perCall;
    if (perCall < best) best = perCall;
  }
  return { mean_us: sum / blocks, min_us: best };
}

// -----------------------------------------------------------------------------
// Benchmarks
// -----------------------------------------------------------------------------
const results = {};
let keepSamples = null;

// M4 — safety gate decision time, per command class
const gateAccepted = timeEach({
  before: () => _resetCooldownLedgerForTests(),
  call: () => validateCommand(CMD_ACCEPTED, TWIN_OK, GATE_CTX),
});
results.gate_accepted = gateAccepted.stats;
keepSamples = gateAccepted.samples; // distribution for the latency plot

results.gate_rejected_unknown = timeEach({
  call: () => validateCommand(CMD_UNKNOWN, TWIN_OK, GATE_CTX),
}).stats;
results.gate_rejected_unsafe = timeEach({
  call: () => validateCommand(CMD_UNSAFE, TWIN_ESTOP, GATE_CTX),
}).stats;
results.gate_rejected_unconfirmed = timeEach({
  call: () => validateCommand(CMD_UNCONFIRMED, TWIN_OK, GATE_CTX),
}).stats;

// M7 — dispatch decision time
const dispScorer = timeEach({
  call: () => SCORER.decide(DISP_CTX, { now: DISP_NOW }),
});
results.dispatch_scorer_only = dispScorer.stats;        // pure Brain A (context prebuilt)
results.dispatch_from_twin = timeEach({                 // Brain A incl. context build
  call: () => decideFromTwin(TWIN_OK, { now: DISP_NOW, signals: DISP_SIGNALS }),
}).stats;
results.dispatch_full_loop = timeEach({                 // context + decide + gate preview + command
  before: () => _resetCooldownLedgerForTests(),
  call: () => planDispatchUpdate(TWIN_OK, { now: DISP_NOW, signals: DISP_SIGNALS }),
}).stats;

// Cost of safety: gated admission vs. direct dashboard->MQTT serialization
const directBaseline = timeBatchedMean({
  call: () => JSON.stringify({ command: CMD_ACCEPTED.command,
    target_floor: CMD_ACCEPTED.target_floor }),
});
results.direct_publish_baseline = directBaseline;
results.cost_of_safety_us = {
  gated_median_us: results.gate_accepted.median_us,
  direct_mean_us: directBaseline.mean_us,
  added_median_us: results.gate_accepted.median_us - directBaseline.mean_us,
};

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------
const env = {
  generated_at: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.release()}`,
  cpu: os.cpus()[0]?.model?.trim(),
  cpu_count: os.cpus().length,
  samples_per_class: N,
  warmup: WARMUP,
};

function fmt(s) {
  return `n=${s.n}  median=${s.median_us.toFixed(3)}us  mean=${s.mean_us.toFixed(3)}us  ` +
    `p95=${s.p95_us.toFixed(3)}us  p99=${s.p99_us.toFixed(3)}us  ` +
    `min=${s.min_us.toFixed(3)}us  max=${s.max_us.toFixed(3)}us  sd=${s.stddev_us.toFixed(3)}us`;
}

console.log("# Deterministic decision-path microbenchmarks (GAPS M4 + M7, cost of safety)");
console.log(`# ${env.generated_at}`);
console.log(`# node ${env.node} | ${env.platform} | ${env.cpu} x${env.cpu_count}`);
console.log(`# ${N} timed samples/class after ${WARMUP} warmup; per-call process.hrtime.bigint()`);
console.log("# NOTE: in-process CPU time only -- NOT end-to-end/MQTT/Ditto latency, NOT test-suite duration.");
console.log("");
console.log("## Safety gate decision time (M4)");
console.log(`accepted   MOVE_TO_FLOOR : ${fmt(results.gate_accepted)}`);
console.log(`rejected   unknown cmd   : ${fmt(results.gate_rejected_unknown)}`);
console.log(`rejected   unsafe (estop): ${fmt(results.gate_rejected_unsafe)}`);
console.log(`rejected   unconfirmed   : ${fmt(results.gate_rejected_unconfirmed)}`);
console.log("");
console.log("## Dispatch decision time (M7)");
console.log(`Brain A scorer only      : ${fmt(results.dispatch_scorer_only)}`);
console.log(`Brain A from twin        : ${fmt(results.dispatch_from_twin)}`);
console.log(`full orchestrator loop   : ${fmt(results.dispatch_full_loop)}`);
console.log("");
console.log("## Cost of safety (in-process admission overhead)");
console.log(`direct publish baseline  : mean=${directBaseline.mean_us.toFixed(3)}us  min=${directBaseline.min_us.toFixed(3)}us`);
console.log(`gated admission (median) : ${results.gate_accepted.median_us.toFixed(3)}us`);
console.log(`added by safety gate     : ${results.cost_of_safety_us.added_median_us.toFixed(3)}us (median)`);

if (jsonArg) {
  fs.mkdirSync(jsonArg.replace(/[^/\\]+$/, "") || ".", { recursive: true });
  const out = { env, results,
    gate_accepted_samples_us: Array.from(keepSamples) };
  fs.writeFileSync(jsonArg, JSON.stringify(out, null, 2));
  console.log(`\n# wrote ${jsonArg} (incl. ${keepSamples.length} raw gate-accepted samples)`);
}
