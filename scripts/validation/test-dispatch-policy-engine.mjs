#!/usr/bin/env node
/**
 * AI-Adaptive Dispatch Policy Engine — Brain A acceptance suite.
 *
 * Uses node:test (built into Node >=18). No external framework.
 * Run from repo root:
 *     node scripts/validation/test-dispatch-policy-engine.mjs
 *
 * Covers the 10 acceptance scenarios from the feature spec
 * (docs/features/adaptive-dispatch-ai-prompt.md §4) plus the engine invariants:
 * override pre-emption, fairness-SLA disqualification, hysteresis, confidence
 * floor, and decision reconstructability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContext,
  selectDispatchPolicy,
  decideFromTwin,
  createScorerBrain,
  resolveTariffWindow,
  POLICY_IDS,
} from "../../packages/shared/dispatch/index.js";

// -----------------------------------------------------------------------------
// Twin fixture builder — minimal Ditto-shaped state with deep overrides.
// -----------------------------------------------------------------------------
function twin({ attributes = {}, cabin = {}, door = {}, motor = {}, energy = {}, security = {}, performance = {}, predicted = {} } = {}) {
  return {
    last_telemetry_at: "2026-05-31T08:00:00Z",
    attributes: { system_mode: "NORMAL", risk_score: 5, system_health_index: 100, ...attributes },
    features: {
      cabin: { properties: { current_floor: 0, target_floor: 0, direction: "IDLE", load_kg: 120, emergency_stop: false, ...cabin } },
      door: { properties: { state: "OPEN", door_forced_entry: false, ...door } },
      motor: { properties: { temperature_c: 40, vibration_level: 0.02, hours_operated: 1000, power_kw: 2.0, current_draw_a: 5, ...motor } },
      energy: { properties: { kwh_today: 3, kwh_baseline: 2, power_kw: 2.0, ...energy } },
      security: { properties: { alert_level: "NORMAL", unauthorized_access_attempts: 0, audio_distress_active: false, ...security } },
      performance: { properties: { avg_wait_s: 8, ...performance } },
      predicted_failures: { properties: { motor_rul_hours: 9500, bearing_health_pct: 98, rope_tension_pct: 99, ...predicted } },
    },
  };
}

// Convenience: build context + decide with explicit signals/time.
function decide(twinState, signals = {}, opts = {}) {
  const now = opts.now ?? Date.parse("2026-05-31T08:30:00Z");
  const ctx = buildContext(twinState, { now, signals });
  return selectDispatchPolicy(ctx, { now, previous: opts.previous, config: opts.config });
}

// =============================================================================
// Scenario 1 — Morning arrival rush -> UP_PEAK
// =============================================================================
test("S1: morning up-calls from lobby -> UP_PEAK", () => {
  const d = decide(twin(), {
    up_calls: [0, 0, 0], down_calls: [3], predicted_demand_floor: 3, pending_count: 4,
  }, { now: Date.parse("2026-05-31T08:15:00Z") });
  assert.equal(d.policy_id, "UP_PEAK");
  assert.equal(d.params.direction_bias, 1);
  assert.equal(d.params.park_floor, 0);
  assert.equal(d.overridden_by, null);
});

// =============================================================================
// Scenario 2 — Evening egress -> DOWN_PEAK
// =============================================================================
test("S2: evening down-calls toward ground -> DOWN_PEAK", () => {
  const d = decide(twin({ cabin: { current_floor: 3 } }), {
    up_calls: [0], down_calls: [3, 2, 2], predicted_demand_floor: 0, pending_count: 4,
  }, { now: Date.parse("2026-05-31T16:45:00Z") });
  assert.equal(d.policy_id, "DOWN_PEAK");
  assert.equal(d.params.direction_bias, -1);
});

// =============================================================================
// Scenario 3 — Peak tariff + low demand -> ECO_ENERGY
// =============================================================================
test("S3: peak tariff, elevated power, sparse demand -> ECO_ENERGY", () => {
  const d = decide(twin({ energy: { power_kw: 3.2, kwh_baseline: 2.0 } }), {
    up_calls: [1], down_calls: [], pending_count: 1, predicted_demand_floor: 1,
    baseline_power_kw: 2.0, tariff_window: "PEAK", longest_wait_s: 10,
  }, { now: Date.parse("2026-05-31T18:00:00Z") });
  assert.equal(d.policy_id, "ECO_ENERGY");
  assert.equal(d.params.accel_profile, "GENTLE");
  assert.equal(d.params.deep_idle, true);
});

// =============================================================================
// Scenario 4 — Machine degrading -> HEALTH_LIMP (even in moderate traffic)
// =============================================================================
test("S4: high temp + vibration + low RUL -> HEALTH_LIMP", () => {
  const d = decide(twin({
    motor: { temperature_c: 88, vibration_level: 0.30 },
    predicted: { motor_rul_hours: 1500, bearing_health_pct: 55 },
  }), {
    up_calls: [0, 1], down_calls: [2], pending_count: 3, predicted_demand_floor: 2,
  });
  assert.equal(d.policy_id, "HEALTH_LIMP");
  assert.equal(d.params.accel_profile, "GENTLE");
  assert.equal(d.params.force_fan, true);
});

// =============================================================================
// Scenario 5 — Sparse night traffic -> NEAREST_GREEDY
// =============================================================================
test("S5: sparse off-peak traffic -> NEAREST_GREEDY", () => {
  const d = decide(twin(), {
    up_calls: [2], down_calls: [], pending_count: 1, predicted_demand_floor: 2, longest_wait_s: 5,
  }, { now: Date.parse("2026-05-31T02:30:00Z") });
  assert.equal(d.policy_id, "NEAREST_GREEDY");
  assert.equal(d.params.deep_idle, true);
});

// =============================================================================
// Scenario 6 — Balanced midday interfloor -> BALANCED_INTERFLOOR
// =============================================================================
test("S6: balanced midday traffic -> BALANCED_INTERFLOOR", () => {
  const d = decide(twin(), {
    up_calls: [1, 2], down_calls: [2, 1], pending_count: 4, predicted_demand_floor: 2, longest_wait_s: 12,
  }, { now: Date.parse("2026-05-31T13:00:00Z") });
  assert.equal(d.policy_id, "BALANCED_INTERFLOOR");
});

// =============================================================================
// Scenario 7 — Elevated security -> SECURITY_RESTRICTED
// =============================================================================
test("S7: elevated security alert -> SECURITY_RESTRICTED", () => {
  const d = decide(twin({ security: { alert_level: "HIGH", unauthorized_access_attempts: 2 } }), {
    up_calls: [1], down_calls: [2], pending_count: 2,
  });
  assert.equal(d.policy_id, "SECURITY_RESTRICTED");
  assert.equal(d.params.restrict_floors, true);
});

test("S7b: SECURITY_RESTRICTED is ineligible under normal security", () => {
  const d = decide(twin(), { up_calls: [1], down_calls: [2], pending_count: 2 });
  assert.ok(!d.eligible_policies.includes("SECURITY_RESTRICTED"));
});

// =============================================================================
// Scenario 8 — Fire alarm pre-empts everything -> FIRE_RECALL override
// =============================================================================
test("S8: fire alarm overrides an up-peak context", () => {
  const d = decide(twin(), {
    up_calls: [0, 0], down_calls: [], pending_count: 2, fire_alarm: true,
  }, { now: Date.parse("2026-05-31T08:15:00Z") });
  assert.equal(d.policy_id, "FIRE_RECALL");
  assert.equal(d.overridden_by, "FIRE_RECALL");
  assert.equal(d.confidence, 1);
});

// =============================================================================
// Scenario 9 — Overload blocks dispatch -> OVERLOAD_HOLD override
// =============================================================================
test("S9: overload pre-empts with OVERLOAD_HOLD", () => {
  const d = decide(twin({ cabin: { load_kg: 920 } }), {
    up_calls: [0], down_calls: [3], pending_count: 2,
  });
  assert.equal(d.policy_id, "OVERLOAD_HOLD");
  assert.equal(d.overridden_by, "OVERLOAD_HOLD");
});

test("S9b: override precedence — fire beats overload", () => {
  const d = decide(twin({ cabin: { load_kg: 920 } }), { fire_alarm: true });
  assert.equal(d.policy_id, "FIRE_RECALL");
});

// =============================================================================
// Scenario 10 — Conflicting signals: peak tariff says Eco, but a call breached
// the SLA -> fairness guardrail wins, Eco disqualified.
// =============================================================================
test("S10: SLA breach disqualifies ECO_ENERGY despite peak tariff", () => {
  const d = decide(twin({ energy: { power_kw: 3.5, kwh_baseline: 2.0 } }), {
    up_calls: [1], down_calls: [], pending_count: 1, baseline_power_kw: 2.0,
    tariff_window: "PEAK", longest_wait_s: 200,   // way past the 90s SLA
  }, { now: Date.parse("2026-05-31T18:00:00Z") });
  assert.ok(d.guardrails.includes("FAIRNESS_SLA"));
  assert.notEqual(d.policy_id, "ECO_ENERGY");
  assert.notEqual(d.policy_id, "NEAREST_GREEDY");
  assert.ok(!d.eligible_policies.includes("ECO_ENERGY"));
});

// =============================================================================
// Engine invariants
// =============================================================================
test("INV: every decision is reconstructable (score table + factors)", () => {
  const d = decide(twin(), { up_calls: [0], down_calls: [3], pending_count: 2 });
  assert.ok(Array.isArray(d.score_table) && d.score_table.length === POLICY_IDS.length);
  assert.ok(d.factors && d.factors.traffic && d.factors.health);
  assert.equal(typeof d.reason, "string");
  assert.ok(d.reason.length > 0);
  assert.ok(d.confidence >= 0 && d.confidence <= 1);
});

test("INV: hysteresis holds the incumbent within the dwell window", () => {
  const now = Date.parse("2026-05-31T08:15:00Z");
  // First decision: clear up-peak.
  const first = decide(twin(), { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4, predicted_demand_floor: 3 }, { now });
  assert.equal(first.policy_id, "UP_PEAK");

  // 30s later traffic flips to down-peak, but we are still inside min dwell.
  const later = now + 30 * 1000;
  const held = decide(
    twin({ cabin: { current_floor: 3 } }),
    { up_calls: [0], down_calls: [3, 2, 2], pending_count: 4, predicted_demand_floor: 0 },
    { now: later, previous: first },
  );
  assert.equal(held.policy_id, "UP_PEAK");
  assert.ok(held.guardrails.includes("MIN_DWELL"));
});

test("INV: switch is allowed after dwell expires with sufficient margin", () => {
  const now = Date.parse("2026-05-31T08:15:00Z");
  const first = decide(twin(), { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4, predicted_demand_floor: 3 }, { now });
  // 10 minutes later — past the 180s default dwell — with strong down-peak.
  const later = now + 600 * 1000;
  const switched = decide(
    twin({ cabin: { current_floor: 3 } }),
    { up_calls: [], down_calls: [3, 2, 2, 1], pending_count: 4, predicted_demand_floor: 0 },
    { now: later, previous: first },
  );
  assert.equal(switched.policy_id, "DOWN_PEAK");
});

test("INV: createScorerBrain implements the DispatchBrain interface", () => {
  const brain = createScorerBrain();
  assert.equal(typeof brain.id, "string");
  assert.equal(typeof brain.version, "string");
  assert.equal(typeof brain.decide, "function");
  const ctx = buildContext(twin(), { now: Date.parse("2026-05-31T13:00:00Z") });
  const d = brain.decide(ctx, { now: ctx.now_ms });
  assert.ok(POLICY_IDS.includes(d.policy_id) || d.overridden_by);
});

test("INV: decideFromTwin builds context and decides in one call", () => {
  const d = decideFromTwin(twin(), {
    now: Date.parse("2026-05-31T13:00:00Z"),
    signals: { up_calls: [1, 2], down_calls: [2, 1], pending_count: 4 },
  });
  assert.ok(d.policy_id);
  assert.ok(d.factors);
});

test("INV: flat-rate default resolves every hour to SHOULDER", () => {
  // The deployment is configured flat (no time-of-use), so the clock alone
  // never sets PEAK/OFFPEAK — only actual consumption drives ECO_ENERGY.
  assert.equal(resolveTariffWindow(18), "SHOULDER");
  assert.equal(resolveTariffWindow(3), "SHOULDER");
  assert.equal(resolveTariffWindow(14), "SHOULDER");
});

test("INV: tariff schedule mechanism still works with an explicit TOU config + override", () => {
  const tou = { TARIFF_PEAK_HOURS: [18], TARIFF_OFFPEAK_HOURS: [3] };
  assert.equal(resolveTariffWindow(18, tou), "PEAK");
  assert.equal(resolveTariffWindow(3, tou), "OFFPEAK");
  assert.equal(resolveTariffWindow(14, tou), "SHOULDER");
  assert.equal(resolveTariffWindow(14, undefined, "PEAK"), "PEAK");
});

test("INV: default/quiet context falls back to a sensible balanced policy", () => {
  // No calls, healthy machine, shoulder tariff -> SCAN_COLLECTIVE baseline.
  const d = decide(twin(), {}, { now: Date.parse("2026-05-31T14:00:00Z") });
  assert.ok(["SCAN_COLLECTIVE", "BALANCED_INTERFLOOR"].includes(d.policy_id));
});
