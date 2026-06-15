#!/usr/bin/env node
/**
 * Brain B (ML challenger) + reward function — test suite.
 *
 * Run from repo root:
 *     node scripts/validation/test-dispatch-brain-b.mjs
 *
 * Verifies Brain B implements the DispatchBrain interface, preserves the
 * non-negotiable parity with Brain A (safety overrides, fairness SLA,
 * eligibility), is deterministic and explainable; plus the shared reward
 * function's hard safety floor and term signs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContext, createMlBrain, createMlBrainFromSpec, SEED_ML_MODEL,
  contextToFeatureVector, FEATURE_NAMES, POLICY_IDS,
  computeReward, machineStressProxy,
} from "../../packages/shared/dispatch/index.js";

function twin({ attributes = {}, cabin = {}, motor = {}, energy = {}, security = {}, predicted = {} } = {}) {
  return {
    last_telemetry_at: "2026-05-31T08:00:00Z",
    attributes: { system_mode: "NORMAL", risk_score: 5, system_health_index: 100, ...attributes },
    features: {
      cabin: { properties: { current_floor: 0, load_kg: 120, emergency_stop: false, direction: "IDLE", ...cabin } },
      door: { properties: { state: "CLOSED", door_forced_entry: false } },
      motor: { properties: { temperature_c: 40, vibration_level: 0.02, power_kw: 2, ...motor } },
      energy: { properties: { power_kw: 2, kwh_baseline: 2, ...energy } },
      security: { properties: { alert_level: "NORMAL", unauthorized_access_attempts: 0, ...security } },
      predicted_failures: { properties: { motor_rul_hours: 9500, bearing_health_pct: 98, ...predicted } },
    },
  };
}
function ctxOf(t, signals = {}, now = Date.parse("2026-05-31T08:15:00Z")) {
  return buildContext(t, { now, signals });
}

const brain = createMlBrain(SEED_ML_MODEL);

test("Brain B implements the DispatchBrain interface", () => {
  assert.equal(brain.id, "ml_v1");
  assert.equal(typeof brain.version, "string");
  assert.equal(typeof brain.decide, "function");
});

test("Brain B always returns a valid, eligible policy", () => {
  for (const sig of [
    { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4 },
    { up_calls: [], down_calls: [], pending_count: 0 },
    { up_calls: [2], down_calls: [], pending_count: 1 },
  ]) {
    const d = brain.decide(ctxOf(twin(), sig));
    assert.ok(POLICY_IDS.includes(d.policy_id), `valid policy: ${d.policy_id}`);
    assert.ok(d.confidence >= 0 && d.confidence <= 1);
  }
});

test("Brain B yields to safety overrides (parity with Brain A)", () => {
  const d = brain.decide(ctxOf(twin(), { up_calls: [0, 0], fire_alarm: true, pending_count: 2 }));
  assert.equal(d.policy_id, "FIRE_RECALL");
  assert.equal(d.overridden_by, "FIRE_RECALL");
  assert.equal(d.confidence, 1);
});

test("Brain B honors the fairness SLA (no energy-saving when a call starves)", () => {
  const d = brain.decide(ctxOf(twin({ energy: { power_kw: 3.6, kwh_baseline: 2 } }), {
    up_calls: [1], pending_count: 1, longest_wait_s: 200, baseline_power_kw: 2, tariff_window: "PEAK",
  }, Date.parse("2026-05-31T18:00:00Z")));
  assert.ok(d.guardrails.includes("FAIRNESS_SLA"));
  assert.notEqual(d.policy_id, "ECO_ENERGY");
  assert.notEqual(d.policy_id, "NEAREST_GREEDY");
});

test("Brain B respects SECURITY_RESTRICTED eligibility", () => {
  const normal = brain.decide(ctxOf(twin(), { up_calls: [1], down_calls: [2], pending_count: 2 }));
  assert.ok(!normal.eligible_policies.includes("SECURITY_RESTRICTED"));
});

test("Brain B is deterministic and explainable", () => {
  const c = ctxOf(twin({ motor: { temperature_c: 88, vibration_level: 0.3 }, predicted: { motor_rul_hours: 1200 } }),
    { up_calls: [1], down_calls: [1], pending_count: 2 });
  const a = brain.decide(c);
  const b = brain.decide(c);
  assert.equal(a.policy_id, b.policy_id);
  assert.equal(a.confidence, b.confidence);
  assert.ok(Array.isArray(a.score_table) && a.score_table.length === POLICY_IDS.length);
  assert.equal(typeof a.reason, "string");
});

test("createMlBrainFromSpec rejects a malformed spec", () => {
  assert.throws(() => createMlBrainFromSpec({ id: "x" }));
});

test("contextToFeatureVector emits every named feature in [0,1]", () => {
  const fv = contextToFeatureVector(ctxOf(twin(), { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4 }));
  for (const name of FEATURE_NAMES) {
    assert.ok(name in fv, `missing feature ${name}`);
    assert.ok(fv[name] >= 0 && fv[name] <= 1, `${name}=${fv[name]} out of range`);
  }
});

// ---- Reward function ----
test("reward: a safety violation is a hard −Infinity floor", () => {
  const { reward, safe } = computeReward({ avg_wait_s: 1, energy_kwh: 0, safety_violation: true });
  assert.equal(reward, -Infinity);
  assert.equal(safe, false);
});

test("reward: lower wait/energy/stress -> higher reward; throughput helps", () => {
  const good = computeReward({ avg_wait_s: 10, energy_kwh: 1, machine_stress: 0.1, trips: 20, fairness_penalty: 0 });
  const bad = computeReward({ avg_wait_s: 120, energy_kwh: 8, machine_stress: 0.9, trips: 2, fairness_penalty: 1 });
  assert.ok(good.reward > bad.reward);
  assert.ok(good.terms.throughput > 0);
  assert.ok(good.terms.wait < 0);
});

test("machineStressProxy is monotonic and bounded", () => {
  const cool = machineStressProxy({ motor_temp_c: 40, vibration: 0.01, duty_fraction: 0 });
  const hot = machineStressProxy({ motor_temp_c: 93, vibration: 0.4, duty_fraction: 1 });
  assert.ok(hot > cool);
  assert.ok(cool >= 0 && hot <= 1);
});
