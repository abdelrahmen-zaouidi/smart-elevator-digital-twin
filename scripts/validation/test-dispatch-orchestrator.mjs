#!/usr/bin/env node
/**
 * Dispatch Orchestrator — test suite.
 *
 * Uses node:test (built into Node >=18). Run from repo root:
 *     node scripts/validation/test-dispatch-orchestrator.mjs
 *
 * Verifies the engine glue: twin -> context -> decision -> SET_DISPATCH_POLICY
 * command -> read-only gate preview, plus the loop semantics (previous read
 * back from the twin, no command on safety override, no command when unchanged,
 * gate rejection surfaced) and that the produced command is gate-admissible.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planDispatchUpdate,
  extractPreviousDecision,
} from "../../packages/shared/dispatch/orchestrator.js";
import { validateCommand, _resetCooldownLedgerForTests } from "../../packages/shared/commandSafetyGate.js";

const FRESH_TS = "2026-05-31T07:59:55Z";

function twin({ attributes = {}, cabin = {}, motor = {}, energy = {}, security = {}, predicted = {}, control } = {}) {
  const t = {
    last_telemetry_at: FRESH_TS,
    attributes: { system_mode: "NORMAL", risk_score: 5, system_health_index: 100, ...attributes },
    features: {
      cabin: { properties: { current_floor: 0, target_floor: 0, direction: "IDLE", load_kg: 120, emergency_stop: false, ...cabin } },
      door: { properties: { state: "CLOSED", door_forced_entry: false } },
      motor: { properties: { temperature_c: 40, vibration_level: 0.02, power_kw: 2.0, current_draw_a: 5, ...motor } },
      energy: { properties: { kwh_today: 3, kwh_baseline: 2, power_kw: 2.0, ...energy } },
      security: { properties: { alert_level: "NORMAL", unauthorized_access_attempts: 0, ...security } },
      predicted_failures: { properties: { motor_rul_hours: 9500, bearing_health_pct: 98, ...predicted } },
    },
  };
  if (control) t.features.control = { properties: { dispatch_policy: control } };
  return t;
}

const MORNING = Date.parse("2026-05-31T08:00:00Z");

function morningSignals() {
  return { up_calls: [0, 0, 0], down_calls: [3], pending_count: 4, predicted_demand_floor: 3 };
}

test("fresh start: produces an UP_PEAK command that the gate admits", () => {
  _resetCooldownLedgerForTests();
  const plan = planDispatchUpdate(twin(), { now: MORNING, signals: morningSignals() });
  assert.equal(plan.decision.policy_id, "UP_PEAK");
  assert.equal(plan.changed, true);
  assert.equal(plan.command.command, "SET_DISPATCH_POLICY");
  assert.equal(plan.command.policy_id, "UP_PEAK");
  assert.equal(plan.gate_preview.accepted, true);
  assert.equal(plan.should_dispatch, true);

  // And the very same command must pass the authoritative gate.
  const gate = validateCommand(plan.command, twin(), { now: MORNING, max_load_kg: 800 });
  assert.equal(gate.decision, "ACCEPTED");
});

test("command metadata carries hysteresis + confidence for persistence", () => {
  _resetCooldownLedgerForTests();
  const plan = planDispatchUpdate(twin(), { now: MORNING, signals: morningSignals() });
  const m = plan.command.metadata;
  assert.equal(m.brain_id, "scorer_v1");
  assert.equal(typeof m.confidence, "number");
  assert.ok(m.min_dwell_until, "min_dwell_until present");
  assert.equal(m.selected_at, plan.decision.selected_at);
});

test("previous is reconstructed from the twin control feature", () => {
  const prev = extractPreviousDecision(twin({
    control: { active_policy: "ECO_ENERGY", selected_at: "2026-05-31T07:50:00Z", min_dwell_until: "2026-05-31T07:53:00Z" },
  }));
  assert.equal(prev.policy_id, "ECO_ENERGY");
  assert.equal(prev.min_dwell_until, "2026-05-31T07:53:00Z");
});

test("unchanged policy within dwell -> no command emitted", () => {
  _resetCooldownLedgerForTests();
  // Twin already on UP_PEAK with an active dwell window; same morning context.
  const t = twin({
    control: {
      active_policy: "UP_PEAK",
      selected_at: "2026-05-31T07:59:00Z",
      min_dwell_until: "2026-05-31T08:02:00Z",
    },
  });
  const plan = planDispatchUpdate(t, { now: MORNING, signals: morningSignals() });
  assert.equal(plan.decision.policy_id, "UP_PEAK");
  assert.equal(plan.changed, false);
  assert.equal(plan.should_dispatch, false);
  assert.match(plan.skip_reason, /unchanged/);
});

test("safety override (fire) -> no policy command, surfaced for visibility", () => {
  _resetCooldownLedgerForTests();
  const plan = planDispatchUpdate(twin(), { now: MORNING, signals: { ...morningSignals(), fire_alarm: true } });
  assert.equal(plan.decision.policy_id, "FIRE_RECALL");
  assert.equal(plan.decision.overridden_by, "FIRE_RECALL");
  assert.equal(plan.command, null);
  assert.equal(plan.should_dispatch, false);
  assert.match(plan.skip_reason, /override/);
});

test("override is skipped even when emergency stop is latched", () => {
  _resetCooldownLedgerForTests();
  const plan = planDispatchUpdate(twin({ cabin: { emergency_stop: true } }), { now: MORNING, signals: morningSignals() });
  assert.equal(plan.command, null);
  assert.equal(plan.decision.overridden_by, "EMERGENCY_STOP");
});

test("gate rejection is surfaced (LOCKDOWN blocks a policy change)", () => {
  _resetCooldownLedgerForTests();
  // Force a policy change attempt while the twin reports LOCKDOWN. The scorer
  // would itself see lockdown as an override, so to isolate the GATE path we
  // pass an explicit previous + suppress the override by testing a non-lockdown
  // safety state the gate forbids: MAINTENANCE mode.
  const t = twin({ attributes: { system_mode: "MAINTENANCE" } });
  const plan = planDispatchUpdate(t, {
    now: MORNING,
    signals: morningSignals(),
    previous: { policy_id: "SCAN_COLLECTIVE", overridden_by: null },
  });
  // Decision still computes a policy, but the gate preview must reject it.
  assert.equal(plan.changed, true);
  assert.equal(plan.gate_preview.accepted, false);
  assert.equal(plan.should_dispatch, false);
  assert.match(plan.skip_reason, /gate/);
});

test("standby (shadow) brains are recorded but never applied", () => {
  _resetCooldownLedgerForTests();
  // A fake Brain B that always wants ECO_ENERGY.
  const fakeMl = { id: "ml_v1", decide: () => ({ policy_id: "ECO_ENERGY", confidence: 0.9 }) };
  const plan = planDispatchUpdate(twin(), {
    now: MORNING, signals: morningSignals(), shadowBrains: [fakeMl],
  });
  // Active decision is still UP_PEAK; the shadow opinion is recorded alongside.
  assert.equal(plan.decision.policy_id, "UP_PEAK");
  assert.equal(plan.shadow.length, 1);
  assert.equal(plan.shadow[0].brain, "ml_v1");
  assert.equal(plan.shadow[0].decision.policy_id, "ECO_ENERGY");
});

test("a throwing shadow brain cannot break the active decision", () => {
  _resetCooldownLedgerForTests();
  const brokenMl = { id: "ml_v1", decide: () => { throw new Error("model offline"); } };
  const plan = planDispatchUpdate(twin(), {
    now: MORNING, signals: morningSignals(), shadowBrains: [brokenMl],
  });
  assert.equal(plan.decision.policy_id, "UP_PEAK");
  assert.equal(plan.should_dispatch, true);
  assert.match(plan.shadow[0].error, /offline/);
});
