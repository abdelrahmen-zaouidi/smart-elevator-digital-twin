#!/usr/bin/env node
/**
 * Brain B training-data generator (simulator-driven, offline).
 *
 * Sweeps many synthetic building scenarios (traffic mixes, tariff windows,
 * machine-health states, security states), runs each through the SHARED feature
 * builder + Brain A, and emits one JSONL row per scenario:
 *
 *     { "features": {...}, "label": "UP_PEAK", "reward": <proxy>, "context": {...} }
 *
 * `label` is Brain A's choice (imitation target for Phase 1). `reward` is a
 * proxy from the shared reward function so Phase 2 can move to outcome-based
 * learning. Real logged decisions/outcomes are preferred as they accrue; the
 * sim-to-real gap is a documented thesis limitation.
 *
 * Usage:
 *   node scripts/dispatch/generate-training-data.mjs --n 4000 --seed 7 \
 *        --out scripts/dispatch/data/training.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildContext, selectDispatchPolicy, contextToFeatureVector,
  computeReward, machineStressProxy,
} from "../../packages/shared/dispatch/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const N = parseInt(arg("n", "4000"), 10);
const SEED = parseInt(arg("seed", "7"), 10);
const OUT = path.resolve(arg("out", path.join(__dirname, "data", "training.jsonl")));

// Small deterministic PRNG (mulberry32) for reproducible datasets.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const rf = (lo, hi) => lo + rnd() * (hi - lo);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Build a synthetic twin + signals spanning the regimes the policies care about.
function syntheticScenario() {
  const hour = ri(0, 23);
  const regime = pick(["morning", "evening", "midday", "night", "eco", "degraded", "security", "random"]);

  let up = ri(0, 4), down = ri(0, 4);
  let motorTemp = rf(35, 50), vib = rf(0.01, 0.06), rul = ri(6000, 9800), bearing = ri(85, 100);
  let alert = "NORMAL", unauth = 0, power = rf(1.8, 2.4), load = rf(50, 400);

  if (regime === "morning") { up = ri(3, 6); down = ri(0, 1); }
  if (regime === "evening") { down = ri(3, 6); up = ri(0, 1); }
  if (regime === "midday") { up = ri(1, 3); down = ri(1, 3); }
  if (regime === "night") { up = ri(0, 1); down = ri(0, 1); }
  if (regime === "eco") { power = rf(3.0, 4.0); up = ri(0, 1); down = ri(0, 1); }
  if (regime === "degraded") { motorTemp = rf(80, 93); vib = rf(0.22, 0.4); rul = ri(800, 2500); bearing = ri(45, 70); }
  if (regime === "security") { alert = pick(["HIGH", "CRITICAL"]); unauth = ri(1, 4); }

  const upCalls = Array.from({ length: up }, () => (regime === "morning" ? 0 : ri(0, 3)));
  const downCalls = Array.from({ length: down }, () => ri(0, 3));
  const pending = up + down;
  const longestWait = pending > 0 ? rf(2, 70) : 0;
  const demand = pick([0, 1, 2, 3]);

  const twin = {
    last_telemetry_at: new Date().toISOString(),
    attributes: { system_mode: "NORMAL", risk_score: 5, system_health_index: 100 },
    features: {
      cabin: { properties: { current_floor: ri(0, 3), load_kg: load, emergency_stop: false, direction: "IDLE" } },
      door: { properties: { state: "CLOSED", door_forced_entry: false } },
      motor: { properties: { temperature_c: motorTemp, vibration_level: vib, power_kw: power } },
      energy: { properties: { power_kw: power, kwh_baseline: 2.0, kwh_today: rf(1, 11) } },
      security: { properties: { alert_level: alert, unauthorized_access_attempts: unauth } },
      predicted_failures: { properties: { motor_rul_hours: rul, bearing_health_pct: bearing } },
    },
  };
  const signals = {
    hour, up_calls: upCalls, down_calls: downCalls, pending_count: pending,
    longest_wait_s: longestWait, predicted_demand_floor: demand, baseline_power_kw: 2.0,
  };
  return { twin, signals, motorTemp, vib };
}

const stream = fs.createWriteStream(OUT, { encoding: "utf8" });
let written = 0;
const labelCounts = {};

for (let i = 0; i < N; i++) {
  const { twin, signals, motorTemp, vib } = syntheticScenario();
  const ctx = buildContext(twin, { signals });
  const decision = selectDispatchPolicy(ctx);
  // Skip safety-override scenarios — those are not policy decisions.
  if (decision.overridden_by) continue;

  const features = contextToFeatureVector(ctx);
  const stress = machineStressProxy({ motor_temp_c: motorTemp, vibration: vib, duty_fraction: ctx.traffic.pending_count / 8 });
  const { reward } = computeReward({
    avg_wait_s: ctx.traffic.longest_wait_s * 0.6,
    energy_kwh: ctx.energy.power_kw * 0.05,
    machine_stress: stress,
    trips: ctx.traffic.pending_count,
    fairness_penalty: Math.max(0, (ctx.traffic.longest_wait_s - 90) / 90),
  });

  stream.write(JSON.stringify({ features, label: decision.policy_id, reward }) + "\n");
  labelCounts[decision.policy_id] = (labelCounts[decision.policy_id] || 0) + 1;
  written++;
}
stream.end();

console.log(`Wrote ${written} rows -> ${OUT}`);
console.log("Label distribution:", labelCounts);
