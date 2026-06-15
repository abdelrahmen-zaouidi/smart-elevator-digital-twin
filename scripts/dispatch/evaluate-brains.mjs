#!/usr/bin/env node
/**
 * Champion–challenger evaluator (offline).
 *
 * Replays Brain A (active) and Brain B (challenger) over a sweep of synthetic
 * scenarios, scores both with the shared reward function via the offline outcome
 * proxy, and prints the promotion-gate report. Advisory only — a human flips
 * DISPATCH_ACTIVE_BRAIN to promote.
 *
 * Usage:
 *   node scripts/dispatch/evaluate-brains.mjs --n 2000 --seed 11 \
 *        --model packages/shared/dispatch/models/ml_v1.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildContext, createScorerBrain, createMlBrain, createMlBrainFromSpec, SEED_ML_MODEL,
  evaluateBrains, evaluatePromotion,
} from "../../packages/shared/dispatch/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const N = parseInt(arg("n", "2000"), 10);
const SEED = parseInt(arg("seed", "11"), 10);
const MODEL_PATH = path.resolve(arg("model", path.join(__dirname, "..", "..", "dashboard", "src", "lib", "dispatch", "models", "ml_v1.json")));

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
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Build evaluation scenarios as context vectors (same regimes as the trainer).
function scenarioContext() {
  const hour = ri(0, 23);
  const regime = pick(["morning", "evening", "midday", "night", "eco", "degraded", "security", "random"]);
  let up = ri(0, 4), down = ri(0, 4), motorTemp = rf(35, 50), vib = rf(0.01, 0.06);
  let rul = ri(6000, 9800), bearing = ri(85, 100), alert = "NORMAL", unauth = 0, power = rf(1.8, 2.4);
  if (regime === "morning") { up = ri(3, 6); down = ri(0, 1); }
  if (regime === "evening") { down = ri(3, 6); up = ri(0, 1); }
  if (regime === "midday") { up = ri(1, 3); down = ri(1, 3); }
  if (regime === "night") { up = ri(0, 1); down = ri(0, 1); }
  if (regime === "eco") { power = rf(3, 4); up = ri(0, 1); down = ri(0, 1); }
  if (regime === "degraded") { motorTemp = rf(80, 93); vib = rf(0.22, 0.4); rul = ri(800, 2500); bearing = ri(45, 70); }
  if (regime === "security") { alert = pick(["HIGH", "CRITICAL"]); unauth = ri(1, 4); }
  const pending = up + down;
  const twin = {
    last_telemetry_at: new Date().toISOString(),
    attributes: { system_mode: "NORMAL", risk_score: 5, system_health_index: 100 },
    features: {
      cabin: { properties: { current_floor: ri(0, 3), load_kg: rf(50, 400), direction: "IDLE" } },
      door: { properties: { state: "CLOSED" } },
      motor: { properties: { temperature_c: motorTemp, vibration_level: vib, power_kw: power } },
      energy: { properties: { power_kw: power, kwh_baseline: 2, kwh_today: rf(1, 11) } },
      security: { properties: { alert_level: alert, unauthorized_access_attempts: unauth } },
      predicted_failures: { properties: { motor_rul_hours: rul, bearing_health_pct: bearing } },
    },
  };
  return buildContext(twin, {
    signals: {
      hour, up_calls: Array.from({ length: up }, () => (regime === "morning" ? 0 : ri(0, 3))),
      down_calls: Array.from({ length: down }, () => ri(0, 3)), pending_count: pending,
      longest_wait_s: pending > 0 ? rf(2, 110) : 0, predicted_demand_floor: pick([0, 1, 2, 3]),
      baseline_power_kw: 2,
    },
  });
}

const scenarios = Array.from({ length: N }, scenarioContext);

let model = SEED_ML_MODEL, modelLabel = "seed";
try {
  if (fs.existsSync(MODEL_PATH)) { model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")); modelLabel = path.basename(MODEL_PATH); }
} catch (e) { console.warn("model load failed, using seed:", e.message); }

const active = createScorerBrain();
const challenger = model === SEED_ML_MODEL ? createMlBrain(model) : createMlBrainFromSpec(model);

const summary = evaluateBrains(scenarios, active, challenger);
const report = evaluatePromotion(summary);

console.log(`\nChampion–Challenger Evaluation (n=${summary.n}, challenger model=${modelLabel})`);
console.log("=".repeat(64));
console.log(`Active brain      : ${active.id}`);
console.log(`Challenger brain  : ${challenger.id} (${challenger.version})`);
console.log(`Agreement rate    : ${(summary.agreement * 100).toFixed(1)}%`);
console.log(`Mean reward       : active ${summary.mean_reward_active}  challenger ${summary.mean_reward_challenger}  Δ ${summary.reward_delta}`);
console.log(`Fairness regress. : ${summary.fairness_regressions}/${summary.n}`);
console.log(`Safety violations : ${summary.safety_violations_challenger}`);
console.log("-".repeat(64));
console.log("Promotion gates:");
for (const r of report.results) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.gate.padEnd(24)} ${r.detail}`);
console.log("-".repeat(64));
console.log(`PROMOTION DECISION: ${report.pass ? "ELIGIBLE (human approval still required)" : "NOT ELIGIBLE — keep Brain A active"}`);
console.log(`To promote: set DISPATCH_ACTIVE_BRAIN=${challenger.id} and restart the dispatch engine. Rollback: set it back to scorer_v1.\n`);

process.exit(report.pass ? 0 : 0);   // advisory: never fail CI
