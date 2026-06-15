#!/usr/bin/env node
/**
 * Evaluation & promotion-gate test suite.
 *
 * Run from repo root:
 *     node scripts/validation/test-dispatch-evaluation.mjs
 *
 * Verifies the offline outcome proxy rewards regime-appropriate policies, that
 * evaluateBrains reports sane metrics, and that the promotion gates correctly
 * gate on data volume, reward margin, fairness regression and safety.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContext, createScorerBrain,
  simulateOutcome, evaluateBrains, evaluatePromotion, DEFAULT_PROMOTION_GATES,
} from "../../packages/shared/dispatch/index.js";

function ctx(signals, twinOverrides = {}, now = Date.parse("2026-05-31T08:15:00Z")) {
  const twin = {
    last_telemetry_at: "2026-05-31T08:00:00Z",
    attributes: { system_mode: "NORMAL" },
    features: {
      cabin: { properties: { current_floor: 0, load_kg: 120, direction: "IDLE" } },
      motor: { properties: { temperature_c: 40, vibration_level: 0.02, power_kw: 2 } },
      energy: { properties: { power_kw: 2, kwh_baseline: 2 } },
      security: { properties: { alert_level: "NORMAL" } },
      predicted_failures: { properties: { motor_rul_hours: 9500, bearing_health_pct: 98 } },
      ...twinOverrides,
    },
  };
  return buildContext(twin, { now, signals });
}

test("simulateOutcome: matching up-peak cuts wait vs a mismatched policy", () => {
  const c = ctx({ up_calls: [0, 0, 0], down_calls: [1], pending_count: 4, predicted_demand_floor: 3 });
  const matched = simulateOutcome(c, "UP_PEAK");
  const eco = simulateOutcome(c, "ECO_ENERGY");
  assert.ok(matched.avg_wait_s < eco.avg_wait_s);
});

test("simulateOutcome: HEALTH_LIMP lowers stress on a degrading machine", () => {
  const c = ctx({ up_calls: [1], down_calls: [1], pending_count: 2 },
    { motor: { properties: { temperature_c: 88, vibration_level: 0.3, power_kw: 3 } } });
  const limp = simulateOutcome(c, "HEALTH_LIMP");
  const scan = simulateOutcome(c, "SCAN_COLLECTIVE");
  assert.ok(limp.machine_stress < scan.machine_stress);
});

test("simulateOutcome: energy-saving while a call starves incurs fairness penalty", () => {
  const c = ctx({ up_calls: [1], pending_count: 1, longest_wait_s: 200 });
  const eco = simulateOutcome(c, "ECO_ENERGY");
  const scan = simulateOutcome(c, "SCAN_COLLECTIVE");
  assert.ok(eco.fairness_penalty > scan.fairness_penalty);
});

test("evaluateBrains: identical brains agree 100% with zero reward delta", () => {
  const scenarios = Array.from({ length: 50 }, (_, i) =>
    ctx({ up_calls: [0, 0], down_calls: [i % 4], pending_count: 2 + (i % 3) }));
  const a = createScorerBrain();
  const summary = evaluateBrains(scenarios, a, a);
  assert.equal(summary.agreement, 1);
  assert.equal(summary.reward_delta, 0);
  assert.equal(summary.safety_violations_challenger, 0);
});

test("evaluatePromotion: too few scenarios fails the data-volume gate", () => {
  const summary = { n: 10, agreement: 1, mean_reward_active: 0, mean_reward_challenger: 1, reward_delta: 1, fairness_regressions: 0, safety_violations_challenger: 0 };
  const report = evaluatePromotion(summary);
  assert.equal(report.pass, false);
  assert.ok(report.results.find((r) => r.gate === "MIN_SCENARIOS" && !r.pass));
});

test("evaluatePromotion: passes only when every gate passes", () => {
  const good = { n: 1000, agreement: 0.7, mean_reward_active: -1, mean_reward_challenger: -0.5, reward_delta: 0.5, fairness_regressions: 5, safety_violations_challenger: 0 };
  assert.equal(evaluatePromotion(good).pass, true);
  // One safety violation must block promotion outright.
  const unsafe = { ...good, safety_violations_challenger: 1 };
  assert.equal(evaluatePromotion(unsafe).pass, false);
  // A negative reward delta must block promotion.
  const worse = { ...good, reward_delta: -0.1 };
  assert.equal(evaluatePromotion(worse).pass, false);
});

test("evaluatePromotion: fairness regression rate gate", () => {
  const summary = { n: 1000, reward_delta: 0.5, fairness_regressions: 200, safety_violations_challenger: 0 };
  const report = evaluatePromotion(summary);
  assert.ok(report.results.find((r) => r.gate === "FAIRNESS_NO_REGRESSION" && !r.pass));
  assert.equal(report.pass, false);
});

test("DEFAULT_PROMOTION_GATES are conservative", () => {
  assert.ok(DEFAULT_PROMOTION_GATES.MIN_SCENARIOS >= 100);
  assert.equal(DEFAULT_PROMOTION_GATES.ZERO_SAFETY_VIOLATIONS, true);
});
